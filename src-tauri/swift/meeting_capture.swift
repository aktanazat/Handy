import AppKit
import ApplicationServices
import AudioToolbox
import CoreAudio
import CoreGraphics
import CoreMedia
import Dispatch
import Foundation
import ScreenCaptureKit

private enum BridgeResult: Int32 {
    case ok = 0
    case invalidArgument = 1
    case unsupported = 2
    case permissionDenied = 3
    case sourceUnavailable = 4
    case routeUnavailable = 5
    case streamFailure = 6
}

private enum FailureCategory: Int32 {
    case permission = 1
    case source = 2
    case route = 3
    case stream = 4
}

private enum FailureCode: Int32 {
    case unsupportedOS = 1
    case screenRecordingDenied = 2
    case missingEntitlement = 3
    case noDisplay = 4
    case noMatchingApplication = 5
    case selectedApplicationExited = 6
    case audioFormatChanged = 7
    case audioBufferNotContiguous = 8
    case invalidTimestamp = 9
    case streamStoppedUnexpectedly = 10
    case bridgeArgumentInvalid = 11
    case clockUnavailable = 12
    case timestampDiscontinuity = 13
}

private let requestedSampleRate: UInt32 = 48_000
private let requestedChannelCount: UInt32 = 2
private let maximumBundleIDs = 64
private let maximumBundleIDCharacters = 255
private let maximumEvidenceTitleCharacters = 160
private let maximumEvidenceHostCharacters = 253
private let accessibilityReadTimeoutSeconds: Float = 0.05

private let packetTimestampReset: UInt32 = 1
private let packetSourceRestarted: UInt32 = 1 << 2
private let packetFormatChanged: UInt32 = 1 << 3

public typealias PacketCallback = @convention(c) (
    UnsafeMutableRawPointer?,
    UnsafePointer<Float>?,
    UInt,
    UInt32,
    UInt32,
    Int64,
    Int32,
    UInt64,
    UInt64,
    UInt64,
    UInt32
) -> Void

public typealias StatusCallback = @convention(c) (
    UnsafeMutableRawPointer?,
    Int32,
    Int32,
    UInt64,
    UInt64,
    Int64,
    Int32,
    UInt64,
    UInt32
) -> Void

public typealias SuggestionCallback = @convention(c) (
    UnsafeMutableRawPointer?,
    UnsafePointer<CChar>?,
    UnsafePointer<CChar>?,
    UnsafePointer<CChar>?,
    UInt32,
    UInt64
) -> Void

private final class Completion: @unchecked Sendable {
    private let semaphore = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var result: Int32 = BridgeResult.streamFailure.rawValue

    func resolve(_ result: Int32) {
        lock.lock()
        self.result = result
        lock.unlock()
        semaphore.signal()
    }

    func wait() -> Int32 {
        semaphore.wait()
        lock.lock()
        defer { lock.unlock() }
        return result
    }
}
private struct RawTimestamp: Equatable, Sendable {
    let value: Int64
    let timescale: Int32
}

private struct PacketFormat: Equatable {
    let sampleRateHz: UInt32
    let channels: UInt32
}

private struct StreamClockBridge: Sendable {
    let nativeAnchor: RawTimestamp
    let hostMonotonicAnchorNs: UInt64
    let sessionOffsetNs: UInt64
    let formatEpoch: UInt64
}

private final class StartCompletion: @unchecked Sendable {
    private let semaphore = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var result: Int32 = BridgeResult.streamFailure.rawValue
    private var bridge: StreamClockBridge?

    func resolve(_ result: Int32, bridge: StreamClockBridge?) {
        lock.lock()
        self.result = result
        self.bridge = bridge
        lock.unlock()
        semaphore.signal()
    }

    func wait() -> (Int32, StreamClockBridge?) {
        semaphore.wait()
        lock.lock()
        defer { lock.unlock() }
        return (result, bridge)
    }
}

private func monotonicNowNs() -> UInt64 {
    DispatchTime.now().uptimeNanoseconds
}

private func nativeTimestampNs(_ time: CMTime) -> UInt64? {
    guard time.isValid, !time.isIndefinite, time.value >= 0, time.timescale > 0 else {
        return nil
    }

    let nanoseconds = CMTimeConvertScale(time, timescale: 1_000_000_000, method: .roundTowardZero)
    guard nanoseconds.isValid, !nanoseconds.isIndefinite, nanoseconds.value >= 0 else {
        return nil
    }
    return UInt64(nanoseconds.value)
}

private func hostClockNowNs() -> UInt64? {
    nativeTimestampNs(CMClockGetTime(CMClockGetHostTimeClock()))
}

private func rawTimestamp(_ time: CMTime) -> RawTimestamp? {
    guard time.isValid, !time.isIndefinite, time.timescale > 0 else {
        return nil
    }
    return RawTimestamp(value: time.value, timescale: time.timescale)
}

private func boundedBundleIDs(
    _ rawBundleIDs: UnsafeRawPointer?,
    count: UInt
) -> [String]? {
    guard count <= UInt(maximumBundleIDs) else {
        return nil
    }
    guard count == 0 || rawBundleIDs != nil else {
        return nil
    }

    let pointers = rawBundleIDs?.assumingMemoryBound(to: UnsafePointer<CChar>?.self)
    var result: [String] = []
    result.reserveCapacity(Int(count))

    for index in 0..<Int(count) {
        guard let pointer = pointers?[index],
              let bundleID = String(validatingUTF8: pointer),
              !bundleID.isEmpty,
              bundleID.count <= maximumBundleIDCharacters
        else {
            return nil
        }
        result.append(bundleID.lowercased())
    }

    return Array(Set(result)).sorted()
}

private func classifyStreamError(_ error: Error) -> (FailureCategory, Int32, Int32) {
    let nsError = error as NSError
    let code = Int32(clamping: nsError.code)

    if nsError.domain == SCStreamErrorDomain {
        switch nsError.code {
        case -3801:
            return (.permission, FailureCode.screenRecordingDenied.rawValue, BridgeResult.permissionDenied.rawValue)
        case -3803:
            return (.permission, FailureCode.missingEntitlement.rawValue, BridgeResult.permissionDenied.rawValue)
        case -3806:
            return (.route, FailureCode.noMatchingApplication.rawValue, BridgeResult.routeUnavailable.rawValue)
        case -3813, -3814, -3815:
            return (.source, FailureCode.noDisplay.rawValue, BridgeResult.sourceUnavailable.rawValue)
        default:
            return (.stream, code, BridgeResult.streamFailure.rawValue)
        }
    }

    return (.stream, code, BridgeResult.streamFailure.rawValue)
}

private func withOptionalCString<T>(_ value: String?, _ body: (UnsafePointer<CChar>?) -> T) -> T {
    guard let value else {
        return body(nil)
    }
    return value.withCString(body)
}

@available(macOS 14.0, *)
private final class CaptureBridge: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let packetCallback: PacketCallback
    private let statusCallback: StatusCallback
    private let callbackContext: UnsafeMutableRawPointer?
    private let requestedBundleIDs: Set<String>
    private let ownBundleID: String
    private let ownProcessID: pid_t
    private let outputQueue = DispatchQueue(
        label: "computer.sona.meeting.system-audio-output",
        qos: .userInitiated
    )
    private let outputQueueKey = DispatchSpecificKey<UInt8>()
    private let controlQueue = DispatchQueue(label: "computer.sona.meeting.system-audio-control")

    private var stream: SCStream?
    private var filter: SCContentFilter?
    private var configuration: SCStreamConfiguration?
    private var selectedRouteProcessIDs: Set<pid_t> = []
    private var routeObserver: NSObjectProtocol?
    private var isCapturing = false

    // Accessed exclusively from outputQueue.
    private var sourceEpoch: UInt64 = 0
    private var formatEpoch: UInt64 = 1
    private var lastPresentationTimestamp: CMTime?
    private var activeFormat: PacketFormat?
    private var pendingSourceRestart = false
    private var callbacksEnabled = false
    init(
        requestedBundleIDs: [String],
        epoch: UInt64,
        packetCallback: @escaping PacketCallback,
        statusCallback: @escaping StatusCallback,
        callbackContext: UnsafeMutableRawPointer?
    ) {
        self.packetCallback = packetCallback
        self.statusCallback = statusCallback
        self.callbackContext = callbackContext
        self.requestedBundleIDs = Set(requestedBundleIDs)
        self.ownBundleID = (Bundle.main.bundleIdentifier ?? "").lowercased()
        self.ownProcessID = ProcessInfo.processInfo.processIdentifier
        super.init()

        outputQueue.setSpecific(key: outputQueueKey, value: 1)
        outputQueue.sync {
            callbacksEnabled = true
            sourceEpoch = epoch
            formatEpoch = 1
            lastPresentationTimestamp = nil
            activeFormat = nil
            pendingSourceRestart = false
        }

    }

    deinit {
        removeRouteObserver()
    }

    func startSynchronously(sessionHostAnchorNs: UInt64) -> (Int32, StreamClockBridge?) {
        let completion = StartCompletion()
        prepareAndStart(sessionHostAnchorNs: sessionHostAnchorNs) { result, bridge in
            completion.resolve(result, bridge: bridge)
        }
        return completion.wait()
    }

    func pauseSynchronously() -> Int32 {
        removeRouteObserver()
        guard let stream, isCapturing else {
            return BridgeResult.ok.rawValue
        }

        let completion = Completion()
        stream.stopCapture { [weak self] error in
            self?.controlQueue.async {
                guard let self else {
                    completion.resolve(BridgeResult.streamFailure.rawValue)
                    return
                }
                if let error {
                    let (category, failureCode, result) = classifyStreamError(error)
                    self.reportFailure(category, failureCode)
                    completion.resolve(result)
                    return
                }
                self.isCapturing = false
                self.drainOutputQueue()
                completion.resolve(BridgeResult.ok.rawValue)
            }
        }
        return completion.wait()
    }

    func resumeSynchronously(
        epoch: UInt64,
        sessionHostAnchorNs: UInt64
    ) -> (Int32, StreamClockBridge?) {
        guard let stream, !isCapturing else {
            return (BridgeResult.streamFailure.rawValue, nil)
        }

        outputQueue.sync {
            sourceEpoch = epoch
            formatEpoch &+= 1
            lastPresentationTimestamp = nil
            activeFormat = nil
            pendingSourceRestart = true
        }

        let completion = StartCompletion()
        stream.startCapture { [weak self] error in
            self?.controlQueue.async {
                guard let self else {
                    completion.resolve(BridgeResult.streamFailure.rawValue, bridge: nil)
                    return
                }
                if let error {
                    let (category, failureCode, result) = classifyStreamError(error)
                    self.reportFailure(category, failureCode)
                    completion.resolve(result, bridge: nil)
                    return
                }
                guard let bridge = self.clockBridge(sessionHostAnchorNs: sessionHostAnchorNs) else {
                    self.reportFailure(.stream, FailureCode.clockUnavailable.rawValue)
                    completion.resolve(BridgeResult.streamFailure.rawValue, bridge: nil)
                    return
                }
                self.isCapturing = true
                self.installRouteObserver()
                completion.resolve(BridgeResult.ok.rawValue, bridge: bridge)
            }
        }
        return completion.wait()
    }

    func stopSynchronously() -> Int32 {
        removeRouteObserver()

        let result: Int32
        if let stream, isCapturing {
            let completion = Completion()
            stream.stopCapture { [weak self] error in
                self?.controlQueue.async {
                    guard let self else {
                        completion.resolve(BridgeResult.streamFailure.rawValue)
                        return
                    }
                    if let error {
                        let (category, failureCode, result) = classifyStreamError(error)
                        self.reportFailure(category, failureCode)
                        completion.resolve(result)
                        return
                    }
                    self.isCapturing = false
                    self.drainOutputQueue()
                    completion.resolve(BridgeResult.ok.rawValue)
                }
            }
            result = completion.wait()
        } else {
            result = BridgeResult.ok.rawValue
        }

        tearDownStream()
        return result
    }

    func abortSynchronously() -> Int32 {
        stopSynchronously()
    }

    func tearDownStream() {
        removeRouteObserver()
        disableCallbacksAndDrain()
        if let stream {
            do {
                try stream.removeStreamOutput(self, type: .audio)
            } catch {
                let (category, failureCode, _) = classifyStreamError(error)
                reportFailure(category, failureCode)
            }
        }
        stream = nil
        filter = nil
        configuration = nil
        selectedRouteProcessIDs.removeAll()
        isCapturing = false
        drainOutputQueue()
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .audio, callbacksEnabled else {
            return
        }

        guard let hostMonotonicAnchorNs = hostClockNowNs() else {
            reportFailure(.stream, FailureCode.clockUnavailable.rawValue)
            return
        }
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        guard let timestamp = rawTimestamp(presentationTime) else {
            reportFailure(
                .route,
                FailureCode.invalidTimestamp.rawValue,
                hostMonotonicAnchorNs: hostMonotonicAnchorNs
            )
            return
        }

        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
              let streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)
        else {
            reportFailure(
                .route,
                FailureCode.audioFormatChanged.rawValue,
                timestamp: timestamp,
                hostMonotonicAnchorNs: hostMonotonicAnchorNs
            )
            return
        }

        let format = streamDescription.pointee
        let formatFlags = format.mFormatFlags
        let sampleRate = format.mSampleRate
        let channels = format.mChannelsPerFrame
        let bytesPerFrame = UInt32(MemoryLayout<Float>.size)
            .multipliedReportingOverflow(by: channels)
        guard sampleRate.isFinite,
              sampleRate > 0,
              sampleRate <= Double(UInt32.max),
              sampleRate.rounded(.towardZero) == sampleRate,
              channels > 0,
              !bytesPerFrame.overflow,
              format.mFormatID == kAudioFormatLinearPCM,
              format.mBitsPerChannel == 32,
              format.mFramesPerPacket == 1,
              format.mBytesPerFrame == bytesPerFrame.partialValue,
              format.mBytesPerPacket == bytesPerFrame.partialValue,
              (formatFlags & kAudioFormatFlagIsFloat) != 0,
              (formatFlags & kAudioFormatFlagIsNonInterleaved) == 0
        else {
            sourceEpoch &+= 1
            formatEpoch &+= 1
            activeFormat = nil
            reportFailure(
                .route,
                FailureCode.audioFormatChanged.rawValue,
                timestamp: timestamp,
                hostMonotonicAnchorNs: hostMonotonicAnchorNs
            )
            return
        }

        let packetFormat = PacketFormat(
            sampleRateHz: UInt32(sampleRate),
            channels: channels
        )
        var flags: UInt32 = 0
        if let activeFormat, activeFormat != packetFormat {
            sourceEpoch &+= 1
            formatEpoch &+= 1
            flags |= packetFormatChanged | packetSourceRestarted
            reportFailure(
                .route,
                FailureCode.audioFormatChanged.rawValue,
                timestamp: timestamp,
                hostMonotonicAnchorNs: hostMonotonicAnchorNs
            )
        }
        activeFormat = packetFormat
        if let lastPresentationTimestamp,
           (lastPresentationTimestamp.timescale != presentationTime.timescale
                || CMTimeCompare(presentationTime, lastPresentationTimestamp) <= 0)
        {
            sourceEpoch &+= 1
            flags |= packetTimestampReset | packetSourceRestarted
            reportFailure(
                .route,
                FailureCode.timestampDiscontinuity.rawValue,
                timestamp: timestamp,
                hostMonotonicAnchorNs: hostMonotonicAnchorNs
            )
        }
        if pendingSourceRestart {
            flags |= packetSourceRestarted
            pendingSourceRestart = false
        }
        lastPresentationTimestamp = presentationTime

        let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
        guard frameCount > 0,
              let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer)
        else {
            return
        }

        let expectedByteCount = frameCount.multipliedReportingOverflow(by: Int(format.mBytesPerFrame))
        guard !expectedByteCount.overflow,
              CMBlockBufferIsRangeContiguous(blockBuffer, atOffset: 0, length: 0)
        else {
            reportFailure(
                .route,
                FailureCode.audioBufferNotContiguous.rawValue,
                timestamp: timestamp,
                hostMonotonicAnchorNs: hostMonotonicAnchorNs,
                frames: UInt32(clamping: frameCount)
            )
            return
        }

        var contiguousLength = 0
        var totalLength = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(
            blockBuffer,
            atOffset: 0,
            lengthAtOffsetOut: &contiguousLength,
            totalLengthOut: &totalLength,
            dataPointerOut: &dataPointer
        )
        guard status == kCMBlockBufferNoErr,
              contiguousLength == totalLength,
              totalLength == expectedByteCount.partialValue,
              let dataPointer
        else {
            reportFailure(
                .route,
                FailureCode.audioBufferNotContiguous.rawValue,
                timestamp: timestamp,
                hostMonotonicAnchorNs: hostMonotonicAnchorNs,
                frames: UInt32(clamping: frameCount)
            )
            return
        }

        packetCallback(
            callbackContext,
            UnsafeRawPointer(dataPointer).assumingMemoryBound(to: Float.self),
            UInt(frameCount),
            packetFormat.sampleRateHz,
            packetFormat.channels,
            timestamp.value,
            timestamp.timescale,
            hostMonotonicAnchorNs,
            sourceEpoch,
            formatEpoch,
            flags
        )
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        let nsError = error as NSError
        if nsError.domain == SCStreamErrorDomain && nsError.code == -3817 {
            return
        }
        let (category, failureCode, _) = classifyStreamError(error)
        reportFailure(category, failureCode)
    }

    private func prepareAndStart(
        sessionHostAnchorNs: UInt64,
        completion: @escaping @Sendable (Int32, StreamClockBridge?) -> Void
    ) {
        guard CGPreflightScreenCaptureAccess() else {
            reportFailure(.permission, FailureCode.screenRecordingDenied.rawValue)
            completion(BridgeResult.permissionDenied.rawValue, nil)
            return
        }

        Task.detached { [weak self] in
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(
                    true,
                    onScreenWindowsOnly: true
                )
                guard let self else {
                    completion(BridgeResult.streamFailure.rawValue, nil)
                    return
                }
                self.configureAndStart(
                    content: content,
                    sessionHostAnchorNs: sessionHostAnchorNs,
                    completion: completion
                )
            } catch {
                guard let self else {
                    completion(BridgeResult.streamFailure.rawValue, nil)
                    return
                }
                let (category, failureCode, result) = classifyStreamError(error)
                self.reportFailure(category, failureCode)
                completion(result, nil)
            }
        }
    }

    private func configureAndStart(
        content: SCShareableContent,
        sessionHostAnchorNs: UInt64,
        completion: @escaping @Sendable (Int32, StreamClockBridge?) -> Void
    ) {
        guard let display = content.displays.first else {
            reportFailure(.source, FailureCode.noDisplay.rawValue)
            completion(BridgeResult.sourceUnavailable.rawValue, nil)
            return
        }

        let candidates = content.applications.filter { application in
            application.processID != ownProcessID && application.bundleIdentifier.lowercased() != ownBundleID
        }
        let applications: [SCRunningApplication]
        let routeProcessIDs: Set<pid_t>

        if requestedBundleIDs.isEmpty {
            guard !candidates.isEmpty else {
                reportFailure(.source, FailureCode.noMatchingApplication.rawValue)
                completion(BridgeResult.sourceUnavailable.rawValue, nil)
                return
            }
            applications = candidates
            routeProcessIDs = []
        } else {
            let matched = candidates.filter { requestedBundleIDs.contains($0.bundleIdentifier.lowercased()) }
            let matchedBundleIDs = Set(matched.map { $0.bundleIdentifier.lowercased() })
            guard matchedBundleIDs == requestedBundleIDs else {
                reportFailure(.route, FailureCode.noMatchingApplication.rawValue)
                completion(BridgeResult.routeUnavailable.rawValue, nil)
                return
            }
            applications = matched
            routeProcessIDs = Set(matched.map(\.processID))
        }

        let filter = SCContentFilter(
            display: display,
            including: applications,
            exceptingWindows: []
        )
        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.excludesCurrentProcessAudio = true
        configuration.sampleRate = Int(requestedSampleRate)
        configuration.channelCount = Int(requestedChannelCount)

        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        do {
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: outputQueue)
        } catch {
            let (category, failureCode, result) = classifyStreamError(error)
            reportFailure(category, failureCode)
            completion(result, nil)
            return
        }

        self.filter = filter
        self.configuration = configuration
        self.stream = stream
        self.selectedRouteProcessIDs = routeProcessIDs

        stream.startCapture { [weak self] error in
            guard let self else {
                completion(BridgeResult.streamFailure.rawValue, nil)
                return
            }
            self.controlQueue.async {
                if let error {
                    let (category, failureCode, result) = classifyStreamError(error)
                    self.reportFailure(category, failureCode)
                    self.tearDownStream()
                    completion(result, nil)
                    return
                }
                guard let bridge = self.clockBridge(sessionHostAnchorNs: sessionHostAnchorNs) else {
                    self.reportFailure(.stream, FailureCode.clockUnavailable.rawValue)
                    self.tearDownStream()
                    completion(BridgeResult.streamFailure.rawValue, nil)
                    return
                }
                self.isCapturing = true
                self.installRouteObserver()
                completion(BridgeResult.ok.rawValue, bridge)
            }
        }
    }

    private func clockBridge(sessionHostAnchorNs: UInt64) -> StreamClockBridge? {
        guard let stream,
              let synchronizationClock = stream.synchronizationClock,
              let nativeAnchor = rawTimestamp(CMClockGetTime(synchronizationClock)),
              let hostMonotonicAnchorNs = hostClockNowNs(),
              hostMonotonicAnchorNs >= sessionHostAnchorNs
        else {
            return nil
        }
        return StreamClockBridge(
            nativeAnchor: nativeAnchor,
            hostMonotonicAnchorNs: hostMonotonicAnchorNs,
            sessionOffsetNs: hostMonotonicAnchorNs - sessionHostAnchorNs,
            formatEpoch: outputFormatEpoch()
        )
    }

    private func installRouteObserver() {
        guard routeObserver == nil, !selectedRouteProcessIDs.isEmpty else {
            return
        }

        routeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didTerminateApplicationNotification,
            object: nil,
            queue: nil
        ) { [weak self] notification in
            guard let self,
                  let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  self.selectedRouteProcessIDs.contains(application.processIdentifier)
            else {
                return
            }
            self.reportFailure(.route, FailureCode.selectedApplicationExited.rawValue)
        }
    }

    private func removeRouteObserver() {
        if let routeObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(routeObserver)
            self.routeObserver = nil
        }
    }

    private func drainOutputQueue() {
        if DispatchQueue.getSpecific(key: outputQueueKey) == nil {
            outputQueue.sync {}
        }
    }

    private func outputFormatEpoch() -> UInt64 {
        if DispatchQueue.getSpecific(key: outputQueueKey) != nil {
            return formatEpoch
        }
        return outputQueue.sync { formatEpoch }
    }

    private func disableCallbacksAndDrain() {
        if DispatchQueue.getSpecific(key: outputQueueKey) != nil {
            callbacksEnabled = false
        } else {
            outputQueue.sync {
                callbacksEnabled = false
            }
        }
    }

    private func reportFailure(
        _ category: FailureCategory,
        _ code: Int32,
        timestamp: RawTimestamp? = nil,
        hostMonotonicAnchorNs: UInt64 = 0,
        frames: UInt32 = 0
    ) {
        if DispatchQueue.getSpecific(key: outputQueueKey) != nil {
            reportFailureOnOutputQueue(category, code, timestamp, hostMonotonicAnchorNs, frames)
        } else {
            outputQueue.sync {
                reportFailureOnOutputQueue(category, code, timestamp, hostMonotonicAnchorNs, frames)
            }
        }
    }

    private func reportFailureOnOutputQueue(
        _ category: FailureCategory,
        _ code: Int32,
        _ timestamp: RawTimestamp?,
        _ hostMonotonicAnchorNs: UInt64,
        _ frames: UInt32
    ) {
        guard callbacksEnabled else {
            return
        }
        statusCallback(
            callbackContext,
            category.rawValue,
            code,
            sourceEpoch,
            formatEpoch,
            timestamp?.value ?? 0,
            timestamp?.timescale ?? 0,
            hostMonotonicAnchorNs,
            frames
        )
    }
}

private struct AccessibilityEvidence {
    let title: String?
    let urlHost: String?
    let axUnavailable: Bool
}

private func boundedTitle(_ value: String) -> String? {
    guard !value.isEmpty else {
        return nil
    }
    return String(value.prefix(maximumEvidenceTitleCharacters))
}

private func boundedHost(_ url: URL) -> String? {
    guard let host = url.host, !host.isEmpty else {
        return nil
    }
    return String(host.lowercased().prefix(maximumEvidenceHostCharacters))
}

private func copiedAXAttribute(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
        return nil
    }
    return value
}

private func accessibilityEvidence(for processID: pid_t) -> AccessibilityEvidence {
    guard AXIsProcessTrusted() else {
        return AccessibilityEvidence(title: nil, urlHost: nil, axUnavailable: true)
    }

    let application = AXUIElementCreateApplication(processID)
    _ = AXUIElementSetMessagingTimeout(application, accessibilityReadTimeoutSeconds)
    guard let focusedWindowValue = copiedAXAttribute(application, kAXFocusedWindowAttribute),
          CFGetTypeID(focusedWindowValue) == AXUIElementGetTypeID()
    else {
        return AccessibilityEvidence(title: nil, urlHost: nil, axUnavailable: false)
    }
    let focusedWindow = unsafeBitCast(focusedWindowValue, to: AXUIElement.self)
    _ = AXUIElementSetMessagingTimeout(focusedWindow, accessibilityReadTimeoutSeconds)
    let title = copiedAXAttribute(focusedWindow, kAXTitleAttribute).flatMap { value in
        (value as? String).flatMap(boundedTitle)
    }
    let urlHost = copiedAXAttribute(focusedWindow, kAXURLAttribute).flatMap { value in
        (value as? URL).flatMap(boundedHost)
    }

    return AccessibilityEvidence(title: title, urlHost: urlHost, axUnavailable: false)
}

private let supportedMeetingBundleIDs: Set<String> = [
    "com.apple.facetime",
    "com.apple.safari",
    "com.cisco.webex",
    "com.cisco.webexmeetingsapp",
    "com.google.chrome",
    "com.google.chrome.canary",
    "com.microsoft.edgemac",
    "com.microsoft.teams",
    "com.microsoft.teams2",
    "com.tinyspeck.slackmacgap",
    "org.mozilla.firefox",
    "us.zoom.xos",
]

private let suggestionAXUnavailableFlag: UInt32 = 1

private final class SuggestionObserver: @unchecked Sendable {
    private let callback: SuggestionCallback
    private let callbackContext: UnsafeMutableRawPointer?
    private let observedBundleIDs: Set<String>
    private let evidenceQueue = DispatchQueue(label: "computer.sona.meeting.suggestion-evidence")
    private var token: NSObjectProtocol?

    // Accessed exclusively from evidenceQueue.
    private var isActive = false

    init(
        configuredBundleIDs: [String],
        callback: @escaping SuggestionCallback,
        callbackContext: UnsafeMutableRawPointer?
    ) {
        self.callback = callback
        self.callbackContext = callbackContext
        self.observedBundleIDs = supportedMeetingBundleIDs.union(configuredBundleIDs)
    }

    deinit {
        stop()
    }

    func start() {
        guard token == nil else {
            return
        }

        evidenceQueue.sync {
            isActive = true
        }
        token = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: nil
        ) { [weak self] notification in
            guard let self,
                  let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  let bundleID = application.bundleIdentifier,
                  self.observedBundleIDs.contains(bundleID.lowercased())
            else {
                return
            }

            self.evidenceQueue.async { [weak self] in
                self?.emit(bundleID: bundleID, processID: application.processIdentifier)
            }
        }
    }

    func stop() {
        evidenceQueue.sync {
            isActive = false
        }
        if let token {
            NSWorkspace.shared.notificationCenter.removeObserver(token)
            self.token = nil
        }
    }

    private func emit(bundleID: String, processID: pid_t) {
        guard isActive else {
            return
        }

        let evidence = accessibilityEvidence(for: processID)
        let flags = evidence.axUnavailable ? suggestionAXUnavailableFlag : 0
        bundleID.withCString { bundleIDPointer in
            withOptionalCString(evidence.title) { titlePointer in
                withOptionalCString(evidence.urlHost) { urlHostPointer in
                    callback(
                        callbackContext,
                        bundleIDPointer,
                        titlePointer,
                        urlHostPointer,
                        flags,
                        monotonicNowNs()
                    )
                }
            }
        }
    }
}

@_cdecl("sona_meeting_capture_probe")
public func sonaMeetingCaptureProbe() -> Int32 {
    guard #available(macOS 14.0, *) else {
        return BridgeResult.unsupported.rawValue
    }
    return CGPreflightScreenCaptureAccess()
        ? BridgeResult.ok.rawValue
        : BridgeResult.permissionDenied.rawValue
}

@_cdecl("sona_meeting_capture_start")
public func sonaMeetingCaptureStart(
    _ applicationBundleIDs: UnsafeRawPointer?,
    _ applicationBundleIDCount: UInt,
    _ epoch: UInt64,
    _ sessionHostAnchorNs: UInt64,
    _ packetCallback: PacketCallback?,
    _ statusCallback: StatusCallback?,
    _ callbackContext: UnsafeMutableRawPointer?,
    _ outNativeAnchorValue: UnsafeMutablePointer<Int64>?,
    _ outNativeAnchorTimescale: UnsafeMutablePointer<Int32>?,
    _ outHostMonotonicAnchorNs: UnsafeMutablePointer<UInt64>?,
    _ outSessionOffsetNs: UnsafeMutablePointer<UInt64>?,
    _ outFormatEpoch: UnsafeMutablePointer<UInt64>?,
    _ outHandle: UnsafeMutablePointer<UnsafeMutableRawPointer?>?
) -> Int32 {
    guard #available(macOS 14.0, *),
          let packetCallback,
          let statusCallback,
          let outNativeAnchorValue,
          let outNativeAnchorTimescale,
          let outHostMonotonicAnchorNs,
          let outSessionOffsetNs,
          let outFormatEpoch,
          let outHandle,
          let bundleIDs = boundedBundleIDs(applicationBundleIDs, count: applicationBundleIDCount)
    else {
        return BridgeResult.invalidArgument.rawValue
    }

    outNativeAnchorValue.pointee = 0
    outNativeAnchorTimescale.pointee = 0
    outHostMonotonicAnchorNs.pointee = 0
    outSessionOffsetNs.pointee = 0
    outFormatEpoch.pointee = 0
    outHandle.pointee = nil
    let bridge = CaptureBridge(
        requestedBundleIDs: bundleIDs,
        epoch: epoch,
        packetCallback: packetCallback,
        statusCallback: statusCallback,
        callbackContext: callbackContext
    )
    let (result, clockBridge) = bridge.startSynchronously(sessionHostAnchorNs: sessionHostAnchorNs)
    guard result == BridgeResult.ok.rawValue, let clockBridge else {
        bridge.tearDownStream()
        return result
    }

    outNativeAnchorValue.pointee = clockBridge.nativeAnchor.value
    outNativeAnchorTimescale.pointee = clockBridge.nativeAnchor.timescale
    outHostMonotonicAnchorNs.pointee = clockBridge.hostMonotonicAnchorNs
    outSessionOffsetNs.pointee = clockBridge.sessionOffsetNs
    outFormatEpoch.pointee = clockBridge.formatEpoch
    outHandle.pointee = Unmanaged.passRetained(bridge).toOpaque()
    return BridgeResult.ok.rawValue
}

@_cdecl("sona_meeting_capture_pause")
public func sonaMeetingCapturePause(_ handle: UnsafeMutableRawPointer?) -> Int32 {
    guard let handle else {
        return BridgeResult.invalidArgument.rawValue
    }
    let bridge = Unmanaged<CaptureBridge>.fromOpaque(handle).takeUnretainedValue()
    return bridge.pauseSynchronously()
}

@_cdecl("sona_meeting_capture_resume")
public func sonaMeetingCaptureResume(
    _ handle: UnsafeMutableRawPointer?,
    _ epoch: UInt64,
    _ sessionHostAnchorNs: UInt64,
    _ outNativeAnchorValue: UnsafeMutablePointer<Int64>?,
    _ outNativeAnchorTimescale: UnsafeMutablePointer<Int32>?,
    _ outHostMonotonicAnchorNs: UnsafeMutablePointer<UInt64>?,
    _ outSessionOffsetNs: UnsafeMutablePointer<UInt64>?,
    _ outFormatEpoch: UnsafeMutablePointer<UInt64>?
) -> Int32 {
    guard let handle,
          let outNativeAnchorValue,
          let outNativeAnchorTimescale,
          let outHostMonotonicAnchorNs,
          let outSessionOffsetNs,
          let outFormatEpoch
    else {
        return BridgeResult.invalidArgument.rawValue
    }

    outNativeAnchorValue.pointee = 0
    outNativeAnchorTimescale.pointee = 0
    outHostMonotonicAnchorNs.pointee = 0
    outSessionOffsetNs.pointee = 0
    outFormatEpoch.pointee = 0
    let bridge = Unmanaged<CaptureBridge>.fromOpaque(handle).takeUnretainedValue()
    let (result, clockBridge) = bridge.resumeSynchronously(
        epoch: epoch,
        sessionHostAnchorNs: sessionHostAnchorNs
    )
    guard result == BridgeResult.ok.rawValue, let clockBridge else {
        return result
    }

    outNativeAnchorValue.pointee = clockBridge.nativeAnchor.value
    outNativeAnchorTimescale.pointee = clockBridge.nativeAnchor.timescale
    outHostMonotonicAnchorNs.pointee = clockBridge.hostMonotonicAnchorNs
    outSessionOffsetNs.pointee = clockBridge.sessionOffsetNs
    outFormatEpoch.pointee = clockBridge.formatEpoch
    return BridgeResult.ok.rawValue
}

@_cdecl("sona_meeting_capture_stop")
public func sonaMeetingCaptureStop(_ handle: UnsafeMutableRawPointer?) -> Int32 {
    guard let handle else {
        return BridgeResult.invalidArgument.rawValue
    }
    let bridge = Unmanaged<CaptureBridge>.fromOpaque(handle).takeUnretainedValue()
    return bridge.stopSynchronously()
}

@_cdecl("sona_meeting_capture_abort")
public func sonaMeetingCaptureAbort(_ handle: UnsafeMutableRawPointer?) -> Int32 {
    guard let handle else {
        return BridgeResult.invalidArgument.rawValue
    }
    let bridge = Unmanaged<CaptureBridge>.fromOpaque(handle).takeUnretainedValue()
    return bridge.abortSynchronously()
}

@_cdecl("sona_meeting_capture_destroy")
public func sonaMeetingCaptureDestroy(_ handle: UnsafeMutableRawPointer?) {
    guard let handle else {
        return
    }
    let bridge = Unmanaged<CaptureBridge>.fromOpaque(handle).takeRetainedValue()
    bridge.tearDownStream()
}

@_cdecl("sona_meeting_suggestions_start")
public func sonaMeetingSuggestionsStart(
    _ configuredBundleIDs: UnsafeRawPointer?,
    _ configuredBundleIDCount: UInt,
    _ callback: SuggestionCallback?,
    _ callbackContext: UnsafeMutableRawPointer?,
    _ outHandle: UnsafeMutablePointer<UnsafeMutableRawPointer?>?
) -> Int32 {
    guard let callback,
          let outHandle,
          let bundleIDs = boundedBundleIDs(configuredBundleIDs, count: configuredBundleIDCount)
    else {
        return BridgeResult.invalidArgument.rawValue
    }

    outHandle.pointee = nil
    let observer = SuggestionObserver(
        configuredBundleIDs: bundleIDs,
        callback: callback,
        callbackContext: callbackContext
    )
    observer.start()
    outHandle.pointee = Unmanaged.passRetained(observer).toOpaque()
    return BridgeResult.ok.rawValue
}

@_cdecl("sona_meeting_suggestions_stop")
public func sonaMeetingSuggestionsStop(_ handle: UnsafeMutableRawPointer?) {
    guard let handle else {
        return
    }
    let observer = Unmanaged<SuggestionObserver>.fromOpaque(handle).takeRetainedValue()
    observer.stop()
}
