import Dispatch
import Foundation
import FoundationModels

@available(macOS 26.0, *)
@Generable
private struct CleanedTranscript: Sendable {
    let cleanedText: String
}

// MARK: - Swift implementation for Apple LLM integration
// This file is compiled via Cargo build script for Apple Silicon targets

private typealias ResponsePointer = UnsafeMutablePointer<AppleLLMResponse>

private func duplicateCString(_ text: String) -> UnsafeMutablePointer<CChar>? {
    return text.withCString { basePointer in
        guard let duplicated = strdup(basePointer) else {
            return nil
        }
        return duplicated
    }
}

private func truncatedText(_ text: String, limit: Int) -> String {
    guard limit > 0 else { return text }
    let words = text.split(
        maxSplits: .max,
        omittingEmptySubsequences: true,
        whereSeparator: { $0.isWhitespace || $0.isNewline }
    )
    if words.count <= limit {
        return text
    }
    return words.prefix(limit).joined(separator: " ")
}

/// The refusal a caller can act on, keyed by the status codes in
/// apple_intelligence_bridge.h. Three of these are different instructions, not
/// three ways of saying "unavailable".
private func unavailableMessage(_ status: Int32) -> String {
    switch status {
    case 1:
        return "Apple Intelligence is switched off in System Settings > Apple Intelligence & Siri."
    case 2:
        return "Apple Intelligence is still downloading its model."
    case 3:
        return "This Mac is not eligible for Apple Intelligence."
    case 4:
        return "Apple Intelligence requires macOS 26 or newer."
    default:
        return "Apple Intelligence is unavailable for an unrecognized reason."
    }
}

/// Status codes are documented once, in apple_intelligence_bridge.h.
@_cdecl("apple_intelligence_status")
public func appleIntelligenceStatus() -> Int32 {
    guard #available(macOS 26.0, *) else {
        return 4
    }

    switch SystemLanguageModel.default.availability {
    case .available:
        return 0
    case .unavailable(.appleIntelligenceNotEnabled):
        return 1
    case .unavailable(.modelNotReady):
        return 2
    case .unavailable(.deviceNotEligible):
        return 3
    case .unavailable:
        return 5
    }
}

@_cdecl("process_text_with_system_prompt_apple")
public func processTextWithSystemPrompt(
    _ systemPrompt: UnsafePointer<CChar>,
    _ userContent: UnsafePointer<CChar>,
    maxTokens: Int32
) -> UnsafeMutablePointer<AppleLLMResponse> {
    let swiftSystemPrompt = String(cString: systemPrompt)
    let swiftUserContent = String(cString: userContent)
    let responsePtr = ResponsePointer.allocate(capacity: 1)
    responsePtr.initialize(to: AppleLLMResponse(response: nil, success: 0, error_message: nil))

    guard #available(macOS 26.0, *) else {
        responsePtr.pointee.error_message = duplicateCString(unavailableMessage(4))
        return responsePtr
    }

    // One availability read, shared with the status entry point, so the refusal
    // names which of the reasons applies instead of flattening them.
    let status = appleIntelligenceStatus()
    guard status == 0 else {
        responsePtr.pointee.error_message = duplicateCString(unavailableMessage(status))
        return responsePtr
    }
    let model = SystemLanguageModel.default

    let tokenLimit = max(0, Int(maxTokens))
    let semaphore = DispatchSemaphore(value: 0)

    // Thread-safe container to pass results from async task back to calling thread
    final class ResultBox: @unchecked Sendable {
        var response: String?
        var error: String?
    }
    let box = ResultBox()

    Task.detached(priority: .userInitiated) {
        defer { semaphore.signal() }
        do {
            let session = LanguageModelSession(
                model: model,
                instructions: swiftSystemPrompt
            )
            var output: String

            do {
                let structured = try await session.respond(
                    to: swiftUserContent,
                    generating: CleanedTranscript.self
                )
                output = structured.content.cleanedText
            } catch {
                let fallbackGeneration = try await session.respond(to: swiftUserContent)
                output = fallbackGeneration.content
            }

            if tokenLimit > 0 {
                output = truncatedText(output, limit: tokenLimit)
            }
            box.response = output
        } catch {
            box.error = error.localizedDescription
        }
    }

    semaphore.wait()

    // Write to responsePtr on the calling thread after task completes
    if let response = box.response {
        responsePtr.pointee.response = duplicateCString(response)
        responsePtr.pointee.success = 1
    } else {
        responsePtr.pointee.error_message = duplicateCString(box.error ?? "Unknown error")
    }

    return responsePtr
}

@_cdecl("free_apple_llm_response")
public func freeAppleLLMResponse(_ response: UnsafeMutablePointer<AppleLLMResponse>?) {
    guard let response = response else { return }

    if let responseStr = response.pointee.response {
        free(UnsafeMutablePointer(mutating: responseStr))
    }

    if let errorStr = response.pointee.error_message {
        free(UnsafeMutablePointer(mutating: errorStr))
    }

    response.deallocate()
}