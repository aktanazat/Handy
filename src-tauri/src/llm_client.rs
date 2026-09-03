use crate::secrets::SecretValue;
use crate::settings::{PostProcessEndpoint, PostProcessProvider};
use log::{debug, error, info};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use zeroize::Zeroizing;

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(transparent)]
pub(crate) struct StructuredOutputSchema(pub(crate) serde_json::Value);

#[derive(Debug, Serialize)]
struct JsonSchema {
    name: String,
    strict: bool,
    schema: StructuredOutputSchema,
}

#[derive(Debug, Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
    json_schema: JsonSchema,
}

#[derive(Debug, Serialize, Clone, Default, PartialEq)]
struct ReasoningConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exclude: Option<bool>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
struct ThinkingParams {
    #[serde(rename = "type")]
    kind: &'static str,
}

/// Request fields used to ask an endpoint to skip reasoning/thinking.
/// Providers disagree on the field name and accepted values, so at most one of
/// these is set per request (see `reasoning_disable_params`).
#[derive(Debug, Serialize, Clone, Default, PartialEq)]
struct ReasoningParams {
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<ReasoningConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<ThinkingParams>,
}

impl ReasoningParams {
    fn is_empty(&self) -> bool {
        self.reasoning_effort.is_none() && self.reasoning.is_none() && self.thinking.is_none()
    }
}

/// Pick the reasoning-disable request fields an endpoint understands.
/// Unknown endpoints get the common OpenAI-style field; if they reject it,
/// the request is retried without it (see `send_chat_completion_with_schema`).
fn reasoning_disable_params(
    provider: &PostProcessProvider,
    endpoint: &PostProcessEndpoint,
) -> ReasoningParams {
    let base_url = endpoint.base_url().to_lowercase();
    if base_url.contains("api.deepseek.com") {
        // DeepSeek rejects reasoning_effort "none" and uses its own field:
        // https://api-docs.deepseek.com/guides/thinking_mode
        ReasoningParams {
            thinking: Some(ThinkingParams { kind: "disabled" }),
            ..Default::default()
        }
    } else if provider.id == "openrouter" {
        // OpenRouter nested object; exclude:true also keeps reasoning text out
        // of the response so it can't pollute structured-output JSON parsing
        ReasoningParams {
            reasoning: Some(ReasoningConfig {
                effort: Some("none".to_string()),
                exclude: Some(true),
            }),
            ..Default::default()
        }
    } else {
        ReasoningParams {
            reasoning_effort: Some("none".to_string()),
            ..Default::default()
        }
    }
}

/// Endpoints (base_url|model) that rejected the reasoning-disable fields with a
/// 4xx. Remembered for the lifetime of the process so every dictation after the
/// first skips the doomed attempt and goes straight to a plain request.
fn reasoning_rejections() -> &'static Mutex<HashSet<String>> {
    static REJECTED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    REJECTED.get_or_init(|| Mutex::new(HashSet::new()))
}

fn endpoint_key(endpoint: &PostProcessEndpoint, model: &str) -> String {
    format!("{}|{}", endpoint.base_url(), model)
}

fn is_known_rejected(key: &str) -> bool {
    reasoning_rejections()
        .lock()
        .map(|set| set.contains(key))
        .unwrap_or(false)
}

fn remember_rejection(key: String) {
    if let Ok(mut set) = reasoning_rejections().lock() {
        set.insert(key);
    }
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
    #[serde(flatten)]
    reasoning: ReasoningParams,
}
pub(crate) struct ChatCompletionInput<'a> {
    pub provider: &'a PostProcessProvider,
    pub endpoint: &'a PostProcessEndpoint,
    pub secret: Option<&'a SecretValue>,
    pub model: &'a str,
    pub user_content: String,
    pub system_prompt: Option<String>,
    pub json_schema: Option<StructuredOutputSchema>,
    pub disable_reasoning: bool,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessageResponse,
}

#[derive(Debug, Deserialize)]
struct ChatMessageResponse {
    content: Option<String>,
}

/// Build headers for API requests based on provider type.
fn build_headers(
    provider: &PostProcessProvider,
    secret: Option<&SecretValue>,
) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();

    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(USER_AGENT, HeaderValue::from_static("Sona/1.0"));
    headers.insert("X-Title", HeaderValue::from_static("Sona"));

    if let Some(secret) = secret {
        if provider.id == "anthropic" {
            headers.insert(
                "x-api-key",
                HeaderValue::from_str(secret.expose())
                    .map_err(|_| "Invalid API key header value".to_string())?,
            );
            headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        } else {
            let bearer = Zeroizing::new(format!("Bearer {}", secret.expose()));
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(bearer.as_str())
                    .map_err(|_| "Invalid authorization header value".to_string())?,
            );
        }
    }

    Ok(headers)
}

/// One bound on every post-processing request. Without it a dictation waits
/// indefinitely on an endpoint that accepts the connection and then never
/// answers, which reqwest does not report on its own: its default is no
/// timeout at all.
///
/// Twenty seconds is chosen for the warm case and deliberately sacrifices the
/// cold one — it does not protect a model that is still loading its weights,
/// because that load does not fit in any bound a dictation can afford. A warm
/// local answer lands in well under a second; a cold 7.7 GB `gemma4:12b-mlx`
/// measured over three minutes on a loaded machine. So the first dictation
/// after a cold start does not wait for the model: it skips post-processing and
/// delivers the raw transcript, with only a log line saying so — nothing in the
/// UI reports the dropped rewrite. That is the intended trade, since unpolished
/// words beat words that arrive minutes late, and `post_process_transcription`
/// already reads the failure as "no rewrite". Raising the bound to cover a cold
/// load would buy nothing except making that first dictation hang for it.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// Create an HTTP client with provider-specific headers. Redirects are disabled
/// so an Authorization header cannot reach a destination outside the frozen
/// endpoint.
fn create_client(
    provider: &PostProcessProvider,
    secret: Option<&SecretValue>,
) -> Result<reqwest::Client, String> {
    let headers = build_headers(provider, secret)?;
    reqwest::Client::builder()
        .default_headers(headers)
        .redirect(Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| report_reqwest_error("Failed to build HTTP client", &e))
}

fn reqwest_error_kinds(error: &reqwest::Error) -> String {
    let mut kinds = Vec::new();

    if error.is_builder() {
        kinds.push("builder");
    }
    if error.is_connect() {
        kinds.push("connect");
    }
    if error.is_request() {
        kinds.push("request");
    }
    if error.is_redirect() {
        kinds.push("redirect");
    }
    if error.is_timeout() {
        kinds.push("timeout");
    }
    if error.is_status() {
        kinds.push("status");
    }
    if error.is_body() {
        kinds.push("body");
    }
    if error.is_decode() {
        kinds.push("decode");
    }
    if error.is_upgrade() {
        kinds.push("upgrade");
    }

    if kinds.is_empty() {
        "unknown".to_string()
    } else {
        kinds.join(", ")
    }
}

fn report_reqwest_error(context: &str, error: &reqwest::Error) -> String {
    let details = format!("{context} (kind: {})", reqwest_error_kinds(error));
    error!("{details}");
    details
}

fn endpoint_matches_provider(
    provider: &PostProcessProvider,
    endpoint: &PostProcessEndpoint,
) -> bool {
    provider
        .endpoint()
        .is_ok_and(|current| current == *endpoint)
}

/// Send a chat completion request to an OpenAI-compatible API
/// Returns Ok(Some(content)) on success, Ok(None) if response has no content,
/// or Err on actual errors (HTTP, parsing, etc.)
pub async fn send_chat_completion(
    provider: &PostProcessProvider,
    endpoint: &PostProcessEndpoint,
    secret: Option<&SecretValue>,
    model: &str,
    prompt: String,
    disable_reasoning: bool,
) -> Result<Option<String>, String> {
    send_chat_completion_with_schema(ChatCompletionInput {
        provider,
        endpoint,
        secret,
        model,
        user_content: prompt,
        system_prompt: None,
        json_schema: None,
        disable_reasoning,
    })
    .await
}

/// Send a chat completion request with structured output support.
/// When json_schema is provided, uses structured outputs mode.
/// system_prompt is used as the system message when provided.
///
/// When disable_reasoning is set, the request carries the reasoning-disable
/// fields the endpoint is expected to understand. Not every OpenAI-compatible
/// endpoint accepts them (DeepSeek, Gemini's compat layer, and some OpenRouter
/// upstreams reject with 400), so a 400/422 answer to such a request triggers
/// one retry without the fields, and the rejection is remembered per
/// (base_url, model) so later requests skip the failing attempt entirely.
pub(crate) async fn send_chat_completion_with_schema(
    input: ChatCompletionInput<'_>,
) -> Result<Option<String>, String> {
    let ChatCompletionInput {
        provider,
        endpoint,
        secret,
        model,
        user_content,
        system_prompt,
        json_schema,
        disable_reasoning,
    } = input;
    if !endpoint_matches_provider(provider, endpoint) {
        return Err("Post-processing destination changed".to_string());
    }
    let url = endpoint.request_url("chat/completions");

    debug!("Sending chat completion request");

    let client = create_client(provider, secret)?;

    // Build messages vector
    let mut messages = Vec::new();

    // Add system prompt if provided
    if let Some(system) = system_prompt {
        messages.push(ChatMessage {
            role: "system".to_string(),
            content: system,
        });
    }

    // Add user message
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: user_content,
    });

    // Build response_format if schema is provided
    let response_format = json_schema.map(|schema| ResponseFormat {
        format_type: "json_schema".to_string(),
        json_schema: JsonSchema {
            name: "transcription_output".to_string(),
            strict: true,
            schema,
        },
    });

    let key = endpoint_key(endpoint, model);
    let reasoning = if disable_reasoning && !is_known_rejected(&key) {
        reasoning_disable_params(provider, endpoint)
    } else {
        ReasoningParams::default()
    };

    let mut request_body = ChatCompletionRequest {
        model: model.to_string(),
        messages,
        stream: false,
        response_format,
        reasoning,
    };

    let mut response = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|error| report_reqwest_error("HTTP request failed", &error))?;
    let mut status = response.status();
    debug!(
        "Chat completion response received with status {} over {:?}",
        status,
        response.version()
    );

    // A 400/422 on a request carrying reasoning-disable fields is almost always
    // the endpoint rejecting those fields — retry once without them.
    if !status.is_success()
        && matches!(status.as_u16(), 400 | 422)
        && !request_body.reasoning.is_empty()
    {
        // Provider bodies are not useful for this retry and may contain
        // submitted text, so never materialize them.
        drop(response);
        info!(
            "Endpoint rejected reasoning-disable fields with status {}; retrying without them",
            status
        );

        request_body.reasoning = ReasoningParams::default();
        response = client
            .post(&url)
            .json(&request_body)
            .send()
            .await
            .map_err(|error| report_reqwest_error("HTTP retry failed", &error))?;
        status = response.status();
        debug!(
            "Chat completion retry response received with status {} over {:?}",
            status,
            response.version()
        );

        if status.is_success() {
            info!(
                "Retry without reasoning fields succeeded; the frozen destination will skip them"
            );
            remember_rejection(key);
        }
    }

    if !status.is_success() {
        return Err(format!("API request failed with status {status}"));
    }

    let completion: ChatCompletionResponse = response
        .json()
        .await
        .map_err(|error| report_reqwest_error("Failed to parse API response", &error))?;

    Ok(completion
        .choices
        .first()
        .and_then(|choice| choice.message.content.clone()))
}

/// Fetch available models from an OpenAI-compatible API.
pub async fn fetch_models(
    provider: &PostProcessProvider,
    endpoint: &PostProcessEndpoint,
    secret: Option<SecretValue>,
) -> Result<Vec<String>, String> {
    if !endpoint_matches_provider(provider, endpoint) {
        return Err("Post-processing destination changed".to_string());
    }
    let url = endpoint.request_url("models");

    debug!("Fetching post-processing models");

    let client = create_client(provider, secret.as_ref())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| report_reqwest_error("Failed to fetch models", &error))?;

    let status = response.status();
    debug!(
        "Model list response received with status {} over {:?}",
        status,
        response.version()
    );
    if !status.is_success() {
        return Err(format!("Model list request failed ({status})"));
    }

    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|error| report_reqwest_error("Failed to parse model list response", &error))?;

    let mut models = Vec::new();

    // Handle OpenAI format: { data: [ { id: "..." }, ... ] }
    if let Some(data) = parsed.get("data").and_then(|data| data.as_array()) {
        for entry in data {
            if let Some(id) = entry.get("id").and_then(|id| id.as_str()) {
                models.push(id.to_string());
            } else if let Some(name) = entry.get("name").and_then(|name| name.as_str()) {
                models.push(name.to_string());
            }
        }
    }
    // Handle array format: [ "model1", "model2", ... ]
    else if let Some(array) = parsed.as_array() {
        for entry in array {
            if let Some(model) = entry.as_str() {
                models.push(model.to_string());
            }
        }
    }

    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn provider(id: &str, base_url: &str) -> PostProcessProvider {
        PostProcessProvider {
            id: id.to_string(),
            label: id.to_string(),
            base_url: base_url.to_string(),
            allow_base_url_edit: true,
            models_endpoint: None,
            supports_structured_output: false,
        }
    }

    fn endpoint(provider: &PostProcessProvider) -> PostProcessEndpoint {
        provider.endpoint().expect("test provider endpoint")
    }

    #[test]
    fn structured_output_schema_preserves_schema_bytes() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": { "text": { "type": "string" } },
        });
        let expected = serde_json::to_vec(&schema).expect("schema serializes");
        let encoded =
            serde_json::to_vec(&StructuredOutputSchema(schema)).expect("typed schema serializes");

        assert_eq!(encoded, expected);
    }

    #[derive(Debug)]
    struct RequestJson(serde_json::Value);

    impl std::ops::Deref for RequestJson {
        type Target = serde_json::Value;

        fn deref(&self) -> &Self::Target {
            &self.0
        }
    }

    fn request_json(reasoning: ReasoningParams) -> RequestJson {
        let request = ChatCompletionRequest {
            model: "test-model".to_string(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: "hi".to_string(),
            }],
            stream: false,
            response_format: None,
            reasoning,
        };
        RequestJson(serde_json::to_value(&request).unwrap())
    }

    async fn serve_one_response(status: &str, body: &str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );

        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request).await.unwrap();
            stream.write_all(response.as_bytes()).await.unwrap();
        });

        format!("http://{address}")
    }

    #[tokio::test]
    async fn failure_diagnostics_exclude_transcript_and_endpoint_canaries() {
        const CANARY: &str = "TRANSCRIPT-CANARY-4EE1";
        let base_url = serve_one_response("400 Bad Request", CANARY).await;
        let error = reqwest::get(format!("{base_url}/private?token={CANARY}"))
            .await
            .expect("request")
            .error_for_status()
            .expect_err("400 response");

        let details = report_reqwest_error("Request failed", &error);
        assert!(details.contains("kind: status"));
        assert!(!details.contains(CANARY));
        assert!(!details.contains(&base_url));

        let decode_url =
            serve_one_response("200 OK", &format!(r#"{{"choices":"{CANARY}"}}"#)).await;
        let decode_error = reqwest::get(decode_url)
            .await
            .expect("request")
            .json::<ChatCompletionResponse>()
            .await
            .expect_err("malformed response");
        let decode_details = report_reqwest_error("Failed to parse API response", &decode_error);
        assert!(decode_details.contains("kind: decode"));
        assert!(!decode_details.contains(CANARY));
    }

    /// A rejected reasoning request is retried even when the server closes its
    /// discarded error body early. The body has no semantic use, so a read
    /// failure must not turn a recoverable 400 into a failed transcription.
    #[tokio::test]
    async fn retries_after_the_discarded_reasoning_rejection_body_fails_to_read() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind retry server");
        let address = listener.local_addr().expect("retry server address");
        let server = tokio::spawn(async move {
            let (mut first, _) = listener.accept().await.expect("first request");
            let mut request = [0_u8; 4096];
            let _ = first.read(&mut request).await.expect("read first request");
            // Claim a longer body, write only part of it, then close. Reqwest
            // receives the 400 headers, but response.text() returns an error.
            first
                .write_all(
                    b"HTTP/1.1 400 Bad Request\r\nContent-Length: 32\r\nConnection: close\r\n\r\nbad",
                )
                .await
                .expect("write truncated rejection");
            first.shutdown().await.expect("close rejection");

            let (mut retry, _) = listener.accept().await.expect("retry request");
            let _ = retry.read(&mut request).await.expect("read retry request");
            let body = br#"{"choices":[{"message":{"content":"retried"}}]}"#;
            retry
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .expect("write retry headers");
            retry.write_all(body).await.expect("write retry body");
        });

        let provider = provider("custom", &format!("http://{address}"));
        let endpoint = endpoint(&provider);
        let result = send_chat_completion(
            &provider,
            &endpoint,
            None,
            "retry-after-truncated-rejection",
            "transcribe this".to_string(),
            true,
        )
        .await;

        assert_eq!(result, Ok(Some("retried".to_string())));
        server.await.expect("retry server completed");
    }

    #[test]
    fn requests_explicitly_disable_streaming() {
        let json = request_json(ReasoningParams::default());
        assert_eq!(json["stream"], false);
    }

    #[test]
    fn default_reasoning_params_serialize_to_no_fields() {
        let json = request_json(ReasoningParams::default());
        assert!(json.get("reasoning_effort").is_none());
        assert!(json.get("reasoning").is_none());
        assert!(json.get("thinking").is_none());
    }

    #[test]
    fn custom_provider_uses_top_level_reasoning_effort() {
        let provider = provider("custom", "http://localhost:11434/v1");
        let params = reasoning_disable_params(&provider, &endpoint(&provider));
        let json = request_json(params);
        assert_eq!(json["reasoning_effort"], "none");
        assert!(json.get("reasoning").is_none());
        assert!(json.get("thinking").is_none());
    }

    #[test]
    fn openrouter_uses_nested_reasoning_object() {
        let provider = provider("openrouter", "https://openrouter.ai/api/v1");
        let params = reasoning_disable_params(&provider, &endpoint(&provider));
        let json = request_json(params);
        assert!(json.get("reasoning_effort").is_none());
        assert_eq!(json["reasoning"]["effort"], "none");
        assert_eq!(json["reasoning"]["exclude"], true);
        assert!(json.get("thinking").is_none());
    }

    #[test]
    fn deepseek_base_url_uses_thinking_disabled() {
        let provider = provider("custom", "https://api.deepseek.com");
        let params = reasoning_disable_params(&provider, &endpoint(&provider));
        let json = request_json(params);
        assert!(json.get("reasoning_effort").is_none());
        assert!(json.get("reasoning").is_none());
        assert_eq!(json["thinking"]["type"], "disabled");
    }

    #[test]
    fn reasoning_params_is_empty_tracks_all_fields() {
        assert!(ReasoningParams::default().is_empty());
        assert!(!ReasoningParams {
            reasoning_effort: Some("none".to_string()),
            ..Default::default()
        }
        .is_empty());
        assert!(!ReasoningParams {
            thinking: Some(ThinkingParams { kind: "disabled" }),
            ..Default::default()
        }
        .is_empty());
    }

    #[test]
    fn rejection_memo_is_keyed_by_endpoint_and_model() {
        let deepseek = provider("custom", "https://api.deepseek.com/");
        let endpoint = endpoint(&deepseek);
        let key = endpoint_key(&endpoint, "deepseek-chat");
        assert_eq!(key, "https://api.deepseek.com|deepseek-chat");
        assert!(!is_known_rejected(&key));
        remember_rejection(key.clone());
        assert!(is_known_rejected(&key));
        // A different model on the same endpoint is tracked separately.
        assert!(!is_known_rejected(&endpoint_key(&endpoint, "other-model")));
    }

    #[tokio::test]
    async fn redirects_do_not_forward_authorization() {
        let target = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind redirect target");
        let target_address = target.local_addr().expect("target address");
        let source = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind redirect source");
        let source_address = source.local_addr().expect("source address");
        let source_server = tokio::spawn(async move {
            let (mut stream, _) = source.accept().await.expect("source request");
            let mut request = [0_u8; 2048];
            let _ = stream
                .read(&mut request)
                .await
                .expect("read source request");
            let response = format!(
                "HTTP/1.1 302 Found\r\nLocation: http://{target_address}/redirected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("write redirect");
        });

        let provider = provider("custom", &format!("http://{source_address}"));
        let endpoint = endpoint(&provider);
        let response = create_client(&provider, None)
            .expect("client")
            .post(endpoint.request_url("chat/completions"))
            .header(
                reqwest::header::AUTHORIZATION,
                "Bearer TRANSCRIPT-CANARY-4EE1",
            )
            .send()
            .await
            .expect("redirect response");

        assert_eq!(response.status().as_u16(), 302);
        assert!(
            tokio::time::timeout(Duration::from_millis(100), target.accept())
                .await
                .is_err()
        );
        source_server.await.expect("source completed");
    }

    #[tokio::test]
    async fn frozen_destination_rejects_changed_provider_before_request() {
        const CANARY: &str = "TRANSCRIPT-CANARY-4EE1";
        let original = provider("custom", "http://127.0.0.1:31001/v1");
        let frozen = endpoint(&original);
        let changed = provider("custom", "http://127.0.0.1:31002/v1");

        let error = send_chat_completion(
            &changed,
            &frozen,
            None,
            "test-model",
            CANARY.to_string(),
            false,
        )
        .await
        .expect_err("changed endpoint must be rejected");

        assert_eq!(error, "Post-processing destination changed");
        assert!(!error.contains(CANARY));
    }

    /// The JSON body of a captured HTTP request; empty until the headers end.
    fn request_body(request: &[u8]) -> &[u8] {
        match request.windows(4).position(|window| window == b"\r\n\r\n") {
            Some(index) => &request[index + 4..],
            None => &[],
        }
    }

    /// Answers one chat completion and hands back the request it received.
    async fn serve_one_completion(content: &str) -> (String, tokio::task::JoinHandle<Vec<u8>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind completion server");
        let address = listener.local_addr().expect("completion server address");
        let body =
            serde_json::json!({ "choices": [{ "message": { "content": content } }] }).to_string();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("completion request");
            let mut request = Vec::new();
            let mut chunk = [0_u8; 1024];
            // Read until the body parses, not just until the first segment: a
            // prompt this size does not arrive in one.
            loop {
                let read = stream.read(&mut chunk).await.expect("read request");
                request.extend_from_slice(&chunk[..read]);
                if read == 0
                    || serde_json::from_slice::<serde_json::Value>(request_body(&request)).is_ok()
                {
                    break;
                }
            }
            stream
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .expect("write completion");
            request
        });
        (format!("http://{address}"), server)
    }

    /// A dictation that ended with `Sona, …` reaches the provider as an
    /// instruction over an input, never as one concatenated prompt: an input
    /// that says "ignore the above" must not be able to direct the edit. The
    /// answer is the whole delivery, which is why it is read back verbatim.
    #[tokio::test]
    async fn a_spoken_instruction_rides_as_instruction_plus_input() {
        let (base_url, server) = serve_one_completion("The plan is ready by Friday?").await;
        let provider = provider("custom", &base_url);
        let endpoint = endpoint(&provider);
        let rendered = crate::prompt_renderer::render_instruction(
            crate::prompt_renderer::InstructionRenderInput {
                instruction: "make that a question.",
                input: "The plan is ready by Friday.",
                language: "en",
                target: &crate::context::TargetMetadata::default(),
            },
        );

        let answer = send_chat_completion_with_schema(ChatCompletionInput {
            provider: &provider,
            endpoint: &endpoint,
            secret: None,
            model: "spoken-instruction",
            user_content: rendered.user_message.clone(),
            system_prompt: Some(rendered.system_message.clone()),
            json_schema: None,
            disable_reasoning: false,
        })
        .await;

        assert_eq!(answer, Ok(Some("The plan is ready by Friday?".to_string())));

        let request = server.await.expect("completion server finished");
        let sent: serde_json::Value =
            serde_json::from_slice(request_body(&request)).expect("the request body is JSON");
        assert_eq!(sent["messages"][0]["role"], "system");
        assert_eq!(sent["messages"][1]["role"], "user");
        let envelope: serde_json::Value = serde_json::from_str(
            sent["messages"][1]["content"]
                .as_str()
                .expect("user content"),
        )
        .expect("the user message is a JSON envelope");
        assert_eq!(envelope["instruction"], "make that a question.");
        assert_eq!(envelope["input"], "The plan is ready by Friday.");
    }

    /// A failed status has to arrive as an error, not as text: every caller
    /// substitutes only what the provider returned, so anything else would
    /// deliver a failure message in place of the user's dictation. This is the
    /// one test that pins that mapping through `send_chat_completion`.
    #[tokio::test]
    async fn a_failed_status_is_an_error_not_text() {
        let base_url = serve_one_response("500 Internal Server Error", "upstream is down").await;
        let provider = provider("custom", &base_url);
        let endpoint = endpoint(&provider);

        let answer = send_chat_completion_with_schema(ChatCompletionInput {
            provider: &provider,
            endpoint: &endpoint,
            secret: None,
            model: "any",
            user_content: "{}".to_string(),
            system_prompt: None,
            json_schema: None,
            disable_reasoning: false,
        })
        .await;

        assert_eq!(
            answer,
            Err("API request failed with status 500 Internal Server Error".to_string())
        );
    }

    /// Proves a keyless local endpoint end to end through this client, because
    /// no fixture can: every other test here serves its own canned bytes, so
    /// none of them can show that a real OpenAI-compatible server accepts what
    /// we send with no `Authorization` header at all.
    ///
    /// Ignored by default — it needs something listening on 11434. Run it with
    /// `cargo test --lib ollama -- --ignored --nocapture`, and set
    /// `SONA_LOCAL_MODEL` if the served model is not the one below.
    ///
    /// The provider fields are the shipped `custom` defaults verbatim
    /// (`settings.rs` `default_post_process_providers`), the credential is
    /// `None` exactly as `provider_allows_unauthenticated_request` makes it for
    /// a loopback `custom` route, `disable_reasoning` is true exactly as
    /// `post_process_transcription` sets it, and the prompt is a real rendered
    /// command-mode pair concatenated the same way. So a pass here is a pass
    /// for the production path, not for a lookalike.
    #[tokio::test]
    #[ignore = "requires a local OpenAI-compatible server on 127.0.0.1:11434"]
    async fn a_keyless_loopback_endpoint_rewrites_a_selection() {
        let provider = PostProcessProvider {
            id: "custom".to_string(),
            label: "Custom".to_string(),
            base_url: "http://localhost:11434/v1".to_string(),
            allow_base_url_edit: true,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: false,
        };
        let endpoint = endpoint(&provider);
        // The whole reason no key is needed: a loopback route is not remote, so
        // neither the consent gate nor the credential lookup applies.
        assert!(!endpoint.is_remote());

        // The dropdown is keyless on the same terms: for a loopback `custom`
        // route `fetch_post_process_models` passes no secret either, so an
        // empty list here would mean typing the model name by hand.
        let listed = fetch_models(&provider, &endpoint, None)
            .await
            .expect("the local endpoint listed its models");
        println!("models: {listed:?}");
        assert!(!listed.is_empty());

        let model = std::env::var("SONA_LOCAL_MODEL").unwrap_or_else(|_| "gemma4:12b-mlx".into());
        let rendered = crate::prompt_renderer::render_instruction(
            crate::prompt_renderer::InstructionRenderInput {
                instruction: "make that a question",
                input: "The plan is ready by Friday.",
                language: "en",
                target: &crate::context::TargetMetadata::default(),
            },
        );
        let prompt = format!("{}\n\n{}", rendered.system_message, rendered.user_message);

        let started = std::time::Instant::now();
        let answer = send_chat_completion(&provider, &endpoint, None, &model, prompt, true).await;
        let elapsed = started.elapsed();

        let text = answer
            .expect("the local endpoint answered")
            .expect("the answer carried content");
        println!("model: {model}");
        println!("latency: {elapsed:?}");
        println!("output: {text}");
        assert!(!text.trim().is_empty());
    }

    /// The check behind `REQUEST_TIMEOUT`. A refused connect already fails
    /// fast, so it proves nothing about the bound; the state that needed one is
    /// an endpoint that accepts the connection, reads the request, and then
    /// never answers — a local model still loading its weights, or a wedged
    /// server. Without the bound this hangs forever, because reqwest's default
    /// is no timeout.
    ///
    /// Ignored by default because passing costs the full 20 seconds. Run it
    /// with `cargo test --lib hangs -- --ignored --nocapture`. The elapsed
    /// assertion is the point: it fails if some other error path short-circuits
    /// instead, which would make the timeout untested while looking green.
    #[tokio::test]
    #[ignore = "waits out the full 20s request timeout"]
    async fn an_endpoint_that_never_answers_times_out() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request).await;
            // Hold the connection open and answer nothing.
            tokio::time::sleep(Duration::from_secs(120)).await;
        });

        let provider = provider("custom", &format!("http://{address}"));
        let endpoint = endpoint(&provider);
        let started = std::time::Instant::now();
        let answer =
            send_chat_completion(&provider, &endpoint, None, "any", "hi".into(), false).await;
        let elapsed = started.elapsed();
        println!("gave up after {elapsed:?}: {answer:?}");

        let error = answer.expect_err("a silent endpoint is an error, not text");
        assert!(error.contains("timeout"), "unexpected failure: {error}");
        assert!(elapsed >= REQUEST_TIMEOUT, "gave up early: {elapsed:?}");
        assert!(
            elapsed < REQUEST_TIMEOUT + Duration::from_secs(5),
            "outlasted the bound: {elapsed:?}"
        );
    }
}
