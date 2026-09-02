import Foundation
import Security

/// The device's own long-lived key material. Minted once, never leaves the Keychain.
struct DeviceIdentity: Codable, Equatable {
    var deviceId: String
    var signingSeedBase64URL: String
    var pairingSecretBase64URL: String

    var signingSeed: Data { Base64URL.decode(signingSeedBase64URL) ?? Data() }
    var pairingSecret: Data { Base64URL.decode(pairingSecretBase64URL) ?? Data() }

    static func mint() -> DeviceIdentity {
        DeviceIdentity(
            deviceId: randomOpaqueId(),
            signingSeedBase64URL: Base64URL.encode(randomBytes(32)),
            pairingSecretBase64URL: Base64URL.encode(randomBytes(32))
        )
    }

    var signingPublicKey: Data { (try? ed25519PublicKey(signingSeed: signingSeed)) ?? Data() }
    var pairingPublicKey: Data { (try? x25519PublicKey(secretKey: pairingSecret)) ?? Data() }
}

/// What the phone needs to write into the vault: where, as whom, under which root.
struct VaultCredentials: Codable, Equatable {
    var endpoint: String
    var vaultId: String
    var vaultRootBase64URL: String

    var vaultRoot: Data { Base64URL.decode(vaultRootBase64URL) ?? Data() }
}

/// A pairing that has been offered to the desktop but not yet accepted back.
struct PendingPairing: Codable, Equatable {
    var endpoint: String
    var vaultId: String
    var offer: PairingOffer
}

struct VaultState: Codable, Equatable {
    var identity: DeviceIdentity
    var pending: PendingPairing?
    var credentials: VaultCredentials?
}

/// One Keychain item holds the whole vault state, so there is one owner of the
/// invariant "identity, pending offer and credentials describe the same device".
enum VaultKeychain {
    private static let service = "com.aktanazat.sona.mobile.vault"
    private static let account = "vault-state-v1"

    static func load() -> VaultState? {
        var query = identityQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return try? JSONDecoder().decode(VaultState.self, from: data)
    }

    /// Load the state, minting an identity on first run so the recorder never waits
    /// on pairing to become usable.
    static func loadOrMint() -> VaultState {
        if let existing = load() { return existing }
        let state = VaultState(identity: .mint(), pending: nil, credentials: nil)
        save(state)
        return state
    }

    static func save(_ state: VaultState) {
        guard let data = try? JSONEncoder().encode(state) else { return }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(identityQuery() as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insert = identityQuery()
            insert.merge(attributes) { current, _ in current }
            SecItemAdd(insert as CFDictionary, nil)
        }
    }

    private static func identityQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
