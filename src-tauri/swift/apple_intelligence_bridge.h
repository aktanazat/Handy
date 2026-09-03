#ifndef apple_intelligence_bridge_h
#define apple_intelligence_bridge_h

// C-compatible function declarations for Swift bridge

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    char* response;
    int success; // 0 for failure, 1 for success
    char* error_message; // Only valid when success = 0
} AppleLLMResponse;

// Why Apple Intelligence can or cannot answer right now. The OS distinguishes
// three unavailability reasons and they call for different user action, so the
// bridge reports the reason rather than a bare yes/no.
//   0 available, 1 switched off in System Settings, 2 model still downloading,
//   3 device not eligible, 4 macOS older than 26, 5 reason unknown to us.
int apple_intelligence_status(void);

// Process text using Apple's on-device LLM with separate system prompt and user content
AppleLLMResponse* process_text_with_system_prompt_apple(const char* system_prompt, const char* user_content, int max_tokens);

// Free memory allocated by the Apple LLM response
void free_apple_llm_response(AppleLLMResponse* response);

#ifdef __cplusplus
}
#endif

#endif /* apple_intelligence_bridge_h */