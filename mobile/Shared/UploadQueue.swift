import Foundation

/// One recording on its way into the vault.
///
/// Every id is minted when the recording is enqueued and never regenerated, so a retry
/// is the same write to the Worker rather than a second object.
struct QueuedRecording: Codable, Equatable, Identifiable {
    var objectId: String
    var revisionId: String
    var uploadId: String
    var recordedAtUtcMs: Int64
    var durationMs: Int64
    var title: String
    var audioByteLength: Int
    var audioSha256: String
    /// The vault whose root the staged ciphertext is bound to, once staged.
    var stagedForVaultId: String?
    var chunkSizes: [Int]
    var chunkDigests: [String]
    var attempts: Int
    var nextAttemptUtcMs: Int64
    var lastError: String?
    /// Set when the Worker refused in a way no retry can change.
    var parked: Bool

    var id: String { objectId }
}

enum UploadQueueError: Error, Equatable {
    case notPaired
    case missingAudio
    case commitIncomplete(state: String)
}

/// The on-disk outbox. Recording writes into it; uploading drains it; nothing else
/// owns a recording's lifetime.
actor UploadQueue {
    private let root: URL
    private let identity: DeviceIdentity
    private var credentials: VaultCredentials?
    private var client: CompanionClient?

    init(root: URL, identity: DeviceIdentity, credentials: VaultCredentials?) {
        self.root = root
        self.identity = identity
        self.credentials = credentials
        try? FileManager.default.createDirectory(
            at: root, withIntermediateDirectories: true
        )
    }

    func setCredentials(_ value: VaultCredentials?) {
        credentials = value
        client = nil
    }

    func items() -> [QueuedRecording] {
        itemDirectories().compactMap(loadItem).sorted { $0.recordedAtUtcMs < $1.recordedAtUtcMs }
    }

    /// Take ownership of a finished capture. The audio file is moved, not copied, so
    /// there is one copy of the bytes from here on.
    func enqueue(
        audio: CapturedAudio,
        recordedAtUtcMs: Int64,
        title: String
    ) throws -> QueuedRecording {
        let objectId = randomOpaqueId()
        let directory = root.appending(path: directoryName(objectId))
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appending(path: "audio.pcm")
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.moveItem(at: audio.url, to: destination)
        let item = QueuedRecording(
            objectId: objectId,
            revisionId: randomOpaqueId(),
            uploadId: randomOpaqueId(),
            recordedAtUtcMs: recordedAtUtcMs,
            durationMs: audio.durationMs,
            title: title,
            audioByteLength: audio.byteLength,
            audioSha256: audio.sha256,
            stagedForVaultId: nil,
            chunkSizes: [],
            chunkDigests: [],
            attempts: 0,
            nextAttemptUtcMs: 0,
            lastError: nil,
            parked: false
        )
        try save(item)
        return item
    }

    /// Try every item that is due, oldest first, one at a time.
    ///
    /// A retryable failure ends the pass: the network or the Worker is unhappy and the
    /// remaining items would fail the same way.
    func drain() async {
        guard let credentials else { return }
        let client: CompanionClient
        do {
            client = try self.client ?? CompanionClient(endpoint: credentials.endpoint)
        } catch {
            return
        }
        self.client = client
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        for item in items() where !item.parked && item.nextAttemptUtcMs <= now {
            do {
                try await upload(item, credentials: credentials, client: client)
            } catch {
                let retryable = (error as? CompanionError)?.isRetryable ?? true
                record(failure: error, on: item, retryable: retryable)
                if retryable { return }
            }
        }
    }

    /// Clear every refusal so the next drain tries again.
    ///
    /// A refusal is only ever final for the reason that produced it; the operator
    /// reopening the app is the signal that the reason may have changed.
    func retryParked() {
        for var item in items() where item.parked {
            item.parked = false
            item.attempts = 0
            item.nextAttemptUtcMs = 0
            try? save(item)
        }
    }

    func discard(objectId: String) {
        try? FileManager.default.removeItem(at: root.appending(path: directoryName(objectId)))
    }

    // MARK: - Upload

    private func upload(
        _ item: QueuedRecording,
        credentials: VaultCredentials,
        client: CompanionClient
    ) async throws {
        let item = try stage(item, credentials: credentials)
        let plan = try plan(item, credentials: credentials)
        let created = try await client.createObjectUpload(
            identity: identity,
            vaultId: credentials.vaultId,
            idempotencyKey: stableIdempotencyKey([
                "device-recording", item.objectId, item.revisionId, "create",
            ]),
            plan: plan
        )
        let accepted = Set(created.acceptedIndexes)
        for index in item.chunkSizes.indices where !accepted.contains(index) {
            let ciphertext = try Data(contentsOf: chunkURL(item, index: index))
            _ = try await client.putChunk(
                identity: identity,
                vaultId: credentials.vaultId,
                idempotencyKey: stableIdempotencyKey([
                    "device-recording", item.objectId, item.revisionId, "chunk-\(index)",
                ]),
                uploadId: item.uploadId,
                index: index,
                ciphertext: ciphertext
            )
        }
        let committed = try await client.commitUpload(
            identity: identity,
            vaultId: credentials.vaultId,
            idempotencyKey: stableIdempotencyKey([
                "device-recording", item.objectId, item.revisionId, "commit",
            ]),
            uploadId: item.uploadId
        )
        guard committed.state == "committed" else {
            throw UploadQueueError.commitIncomplete(state: committed.state)
        }
        discard(objectId: item.objectId)
    }

    /// Encrypt the manifest and every chunk once, to disk.
    ///
    /// Nonces are random, so ciphertext cannot be reproduced: staging it makes a retry
    /// byte-identical, which is what the Worker's chunk digests require.
    private func stage(
        _ item: QueuedRecording, credentials: VaultCredentials
    ) throws -> QueuedRecording {
        var item = item
        if item.stagedForVaultId == credentials.vaultId, !item.chunkDigests.isEmpty {
            return item
        }
        if item.stagedForVaultId != nil {
            /* A re-pairing moved the vault under this recording; its AAD names the old
             * one, so the staged bytes are unusable and the revision starts over. */
            try? removeStagedFiles(item)
            item.revisionId = randomOpaqueId()
            item.uploadId = randomOpaqueId()
        }
        let audioURL = self.audioURL(item)
        guard let handle = try? FileHandle(forReadingFrom: audioURL) else {
            throw UploadQueueError.missingAudio
        }
        defer { try? handle.close() }
        let manifest = DeviceRecordingObject.manifest(
            deviceId: identity.deviceId,
            recordedAtUtcMs: item.recordedAtUtcMs,
            durationMs: item.durationMs,
            title: item.title,
            audioByteLength: item.audioByteLength,
            audioSha256: item.audioSha256
        )
        let chunkCount = DeviceRecordingObject.chunkCount(audioByteLength: item.audioByteLength)
        let manifestPlaintext = try DeviceRecordingObject.encodeManifest(manifest)
        let sealedManifest = try sealObjectRevisionPayload(
            vaultRoot: credentials.vaultRoot,
            context: context(
                item, credentials: credentials,
                index: 0, total: chunkCount, contentKind: .manifest
            ),
            nonce: randomBytes(12),
            plaintext: manifestPlaintext
        )
        try sealedManifest.write(to: manifestURL(item), options: .atomic)
        var sizes: [Int] = []
        var digests: [String] = []
        for index in 0..<chunkCount {
            let range = DeviceRecordingObject.chunkRange(
                index: index, audioByteLength: item.audioByteLength
            )
            try handle.seek(toOffset: UInt64(range.lowerBound))
            let plaintext = try handle.read(upToCount: range.count) ?? Data()
            let sealed = try sealObjectRevisionPayload(
                vaultRoot: credentials.vaultRoot,
                context: context(
                    item, credentials: credentials,
                    index: index, total: chunkCount, contentKind: .chunk
                ),
                nonce: randomBytes(12),
                plaintext: plaintext
            )
            try sealed.write(to: chunkURL(item, index: index), options: .atomic)
            sizes.append(sealed.count)
            digests.append(sha256Base64URL(sealed))
        }
        item.stagedForVaultId = credentials.vaultId
        item.chunkSizes = sizes
        item.chunkDigests = digests
        try save(item)
        return item
    }

    private func plan(
        _ item: QueuedRecording, credentials: VaultCredentials
    ) throws -> ObjectUploadPlan {
        let manifest = try Data(contentsOf: manifestURL(item))
        let manifestDigest = sha256Base64URL(manifest)
        let chunks = item.chunkSizes.indices.map { index in
            ObjectUploadPlan.Chunk(
                index: index,
                size: item.chunkSizes[index],
                sha256: item.chunkDigests[index]
            )
        }
        let totalBytes = item.chunkSizes.reduce(0, +)
        let signature = try signEd25519(
            signingSeed: identity.signingSeed,
            message: canonicalUploadEnvelopeBytes(
                CanonicalUploadEnvelopeInput(
                    vaultId: credentials.vaultId,
                    kind: "object",
                    objectId: item.objectId,
                    revisionId: item.revisionId,
                    baseRevisionId: nil,
                    shareId: nil,
                    manifestDigest: manifestDigest,
                    cryptoVersion: UInt64(SonaProtocol.cryptoVersion),
                    totalBytes: UInt64(totalBytes),
                    chunks: chunks.map {
                        UploadEnvelopeChunk(
                            index: UInt64($0.index), size: UInt64($0.size), sha256: $0.sha256
                        )
                    }
                )
            )
        )
        return ObjectUploadPlan(
            version: SonaProtocol.protocolVersion,
            cryptoVersion: SonaProtocol.cryptoVersion,
            uploadId: item.uploadId,
            objectId: item.objectId,
            revisionId: item.revisionId,
            manifest: Base64URL.encode(manifest),
            manifestSha256: manifestDigest,
            chunks: chunks,
            chunkCount: chunks.count,
            totalBytes: totalBytes,
            writerSignature: Base64URL.encode(signature)
        )
    }

    private func context(
        _ item: QueuedRecording,
        credentials: VaultCredentials,
        index: Int,
        total: Int,
        contentKind: ObjectContentKind
    ) -> ObjectRevisionCryptoContext {
        ObjectRevisionCryptoContext(
            vaultId: credentials.vaultId,
            objectId: item.objectId,
            revisionId: item.revisionId,
            index: UInt64(index),
            total: UInt64(total),
            contentKind: contentKind,
            sourceFormat: DeviceRecordingObject.sourceFormat
        )
    }

    // MARK: - Persistence

    private func record(failure: Error, on item: QueuedRecording, retryable: Bool) {
        guard var stored = loadItem(root.appending(path: directoryName(item.objectId))) else {
            return
        }
        stored.attempts += 1
        stored.lastError = String(describing: failure)
        stored.parked = !retryable
        /* Bounded backoff: a flapping network must not turn the outbox into a spin. */
        let delaySeconds = min(60 * (1 << min(stored.attempts - 1, 4)), 900)
        stored.nextAttemptUtcMs =
            Int64(Date().timeIntervalSince1970 * 1000) + Int64(delaySeconds) * 1000
        try? save(stored)
    }

    private func itemDirectories() -> [URL] {
        (try? FileManager.default.contentsOfDirectory(
            at: root, includingPropertiesForKeys: nil
        )) ?? []
    }

    private func loadItem(_ directory: URL) -> QueuedRecording? {
        guard let bytes = try? Data(contentsOf: directory.appending(path: "item.json")) else {
            return nil
        }
        return try? JSONDecoder().decode(QueuedRecording.self, from: bytes)
    }

    private func save(_ item: QueuedRecording) throws {
        let directory = root.appending(path: directoryName(item.objectId))
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(item).write(
            to: directory.appending(path: "item.json"), options: .atomic
        )
    }

    private func removeStagedFiles(_ item: QueuedRecording) throws {
        let directory = root.appending(path: directoryName(item.objectId))
        for name in try FileManager.default.contentsOfDirectory(atPath: directory.path)
        where name.hasPrefix("chunk-") || name == "manifest.bin" {
            try FileManager.default.removeItem(at: directory.appending(path: name))
        }
    }

    /// Object ids are base64url, which is already a safe directory name.
    private func directoryName(_ objectId: String) -> String { objectId }

    private func audioURL(_ item: QueuedRecording) -> URL {
        root.appending(path: directoryName(item.objectId)).appending(path: "audio.pcm")
    }

    private func manifestURL(_ item: QueuedRecording) -> URL {
        root.appending(path: directoryName(item.objectId)).appending(path: "manifest.bin")
    }

    private func chunkURL(_ item: QueuedRecording, index: Int) -> URL {
        root.appending(path: directoryName(item.objectId))
            .appending(path: String(format: "chunk-%06d.bin", index))
    }
}
