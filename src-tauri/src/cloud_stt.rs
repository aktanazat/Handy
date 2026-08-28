use base64::{engine::general_purpose::STANDARD, Engine as _};
use cpal::Sample;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::{collections::VecDeque, fmt, time::Duration};
use tokio::net::TcpStream;
use tokio::time::{sleep_until, Instant};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{
        client::IntoClientRequest,
        http::{
            header::{HeaderName, HeaderValue, AUTHORIZATION},
            StatusCode,
        },
        Error as WebSocketError, Message,
    },
    MaybeTlsStream, WebSocketStream,
};
use zeroize::Zeroizing;

pub const CLOUD_SAMPLE_RATE_HZ: usize = 16_000;
const MAX_QUEUED_AUDIO_FRAMES: usize = 8;
const DEEPGRAM_KEEPALIVE: Duration = Duration::from_secs(8);
const ELEVENLABS_KEEPALIVE: Duration = Duration::from_secs(10);

const DEEPGRAM_ENDPOINT: &str = "wss://api.deepgram.com/v1/listen";
const ELEVENLABS_ENDPOINT: &str = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

type CloudWebSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudProvider {
    DeepgramNova3,
    ElevenLabsScribeV2,
}

/// Immutable run parameters. Credentials never belong here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloudRunConfig {
    provider: CloudProvider,
    language: Option<String>,
    keyterms: Box<[String]>,
    diarization: bool,
}

impl CloudRunConfig {
    pub fn new(
        provider: CloudProvider,
        language: Option<String>,
        keyterms: Vec<String>,
        diarization: bool,
    ) -> Self {
        Self {
            provider,
            language,
            keyterms: keyterms.into_boxed_slice(),
            diarization,
        }
    }

    pub const fn provider(&self) -> CloudProvider {
        self.provider
    }

    pub fn language(&self) -> Option<&str> {
        self.language.as_deref()
    }

    pub fn keyterms(&self) -> &[String] {
        &self.keyterms
    }

    pub const fn diarization(&self) -> bool {
        self.diarization
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloudWord {
    pub text: String,
    pub start: Duration,
    pub end: Duration,
    pub speaker: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloudEvent {
    Interim { text: String, words: Vec<CloudWord> },
    Final { text: String, words: Vec<CloudWord> },
    ProviderError(CloudError),
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudError {
    Authentication,
    Quota,
    Network,
    Protocol,
    Disconnected,
    Backpressure,
    AudioFrameTooLarge,
    Finalized,
}

impl fmt::Display for CloudError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Authentication => "cloud transcription authentication failed",
            Self::Quota => "cloud transcription quota was exceeded",
            Self::Network => "cloud transcription network operation failed",
            Self::Protocol => "cloud transcription protocol was invalid",
            Self::Disconnected => "cloud transcription disconnected before completion",
            Self::Backpressure => "cloud transcription audio queue is full",
            Self::AudioFrameTooLarge => "cloud transcription audio frame is too large",
            Self::Finalized => "cloud transcription session is finalizing",
        })
    }
}

impl std::error::Error for CloudError {}

/// A connected direct provider session. It owns the WebSocket and stores no API key.
pub enum CloudSession {
    DeepgramNova3(SessionInner),
    ElevenLabsScribeV2(SessionInner),
}

pub struct SessionInner {
    config: CloudRunConfig,
    socket: CloudWebSocket,
    outbound: VecDeque<Message>,
    keepalive_after: Duration,
    next_keepalive: Instant,
    finalizing: bool,
    closed: bool,
}

enum ReceiveAction {
    Keepalive,
    Message(Option<Result<Message, WebSocketError>>),
}

impl CloudSession {
    pub async fn connect(
        config: CloudRunConfig,
        api_key: Zeroizing<String>,
    ) -> Result<Self, CloudError> {
        let endpoint = endpoint_for(&config, provider_endpoint(config.provider()));
        Self::connect_to(config, api_key, &endpoint).await
    }

    #[cfg(test)]
    async fn connect_at(
        config: CloudRunConfig,
        api_key: Zeroizing<String>,
        endpoint: &str,
    ) -> Result<Self, CloudError> {
        let endpoint = endpoint_for(&config, endpoint);
        Self::connect_to(config, api_key, &endpoint).await
    }

    async fn connect_to(
        config: CloudRunConfig,
        api_key: Zeroizing<String>,
        endpoint: &str,
    ) -> Result<Self, CloudError> {
        let provider = config.provider();
        let request = provider_request(&config, &api_key, endpoint)?;
        let (socket, _) = connect_async_with_config(request, None, false)
            .await
            .map_err(map_websocket_error)?;
        let keepalive_after = keepalive_after(provider);
        let inner = SessionInner {
            config,
            socket,
            outbound: VecDeque::with_capacity(MAX_QUEUED_AUDIO_FRAMES),
            keepalive_after,
            next_keepalive: Instant::now() + keepalive_after,
            finalizing: false,
            closed: false,
        };
        let mut session = match provider {
            CloudProvider::DeepgramNova3 => Self::DeepgramNova3(inner),
            CloudProvider::ElevenLabsScribeV2 => Self::ElevenLabsScribeV2(inner),
        };

        if provider == CloudProvider::ElevenLabsScribeV2 {
            session.await_elevenlabs_session_start().await?;
        }

        Ok(session)
    }

    pub fn provider(&self) -> CloudProvider {
        self.inner().config.provider()
    }

    pub fn config(&self) -> &CloudRunConfig {
        &self.inner().config
    }

    /// Queue one 16 kHz mono frame. This runs on the consumer side, never in the
    /// device callback. The bounded frame and queue limits cap its peak memory.
    pub fn try_enqueue_audio(&mut self, samples: &[f32]) -> Result<(), CloudError> {
        let provider = self.provider();
        let inner = self.inner_mut();
        if inner.finalizing || inner.closed {
            return Err(CloudError::Finalized);
        }
        if samples.len() > CLOUD_SAMPLE_RATE_HZ {
            return Err(CloudError::AudioFrameTooLarge);
        }
        if inner.outbound.len() == MAX_QUEUED_AUDIO_FRAMES {
            return Err(CloudError::Backpressure);
        }

        inner.outbound.push_back(audio_message(provider, samples));
        Ok(())
    }

    pub async fn send_audio(&mut self, samples: &[f32]) -> Result<(), CloudError> {
        self.try_enqueue_audio(samples)?;
        self.flush().await
    }

    pub async fn flush(&mut self) -> Result<(), CloudError> {
        while let Some(message) = self.inner_mut().outbound.pop_front() {
            self.send_message(message).await?;
        }
        Ok(())
    }

    /// Wait for the next provider event, driving periodic idle keepalives.
    /// An unexpected disconnect returns `CloudError::Disconnected`; it never
    /// turns a prior interim transcript into a final transcript.
    pub async fn next_event(&mut self) -> Result<CloudEvent, CloudError> {
        loop {
            self.flush().await?;

            let action = if self.inner().finalizing {
                ReceiveAction::Message(self.inner_mut().socket.next().await)
            } else {
                let inner = self.inner_mut();
                let deadline = inner.next_keepalive;
                tokio::select! {
                    message = inner.socket.next() => ReceiveAction::Message(message),
                    _ = sleep_until(deadline) => ReceiveAction::Keepalive,
                }
            };

            match action {
                ReceiveAction::Keepalive => self.send_keepalive().await?,
                ReceiveAction::Message(Some(Ok(message))) => {
                    if let Some(event) = self.handle_message(message).await? {
                        return Ok(event);
                    }
                }
                ReceiveAction::Message(Some(Err(error))) => {
                    return Err(self.disconnect_or(map_connected_websocket_error(error)));
                }
                ReceiveAction::Message(None) => return self.socket_ended(),
            }
        }
    }

    pub async fn finalize(&mut self) -> Result<(), CloudError> {
        if self.inner().finalizing || self.inner().closed {
            return Err(CloudError::Finalized);
        }

        self.flush().await?;
        self.send_message(finalize_message(self.provider())).await?;
        self.inner_mut().finalizing = true;
        Ok(())
    }

    fn inner(&self) -> &SessionInner {
        match self {
            Self::DeepgramNova3(inner) | Self::ElevenLabsScribeV2(inner) => inner,
        }
    }

    fn inner_mut(&mut self) -> &mut SessionInner {
        match self {
            Self::DeepgramNova3(inner) | Self::ElevenLabsScribeV2(inner) => inner,
        }
    }

    async fn await_elevenlabs_session_start(&mut self) -> Result<(), CloudError> {
        loop {
            match self.inner_mut().socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    let value: Value =
                        serde_json::from_str(text.as_str()).map_err(|_| CloudError::Protocol)?;
                    let message_type = value
                        .get("message_type")
                        .and_then(Value::as_str)
                        .ok_or(CloudError::Protocol)?;
                    match message_type {
                        "session_started" => return Ok(()),
                        message_type if is_elevenlabs_error(message_type) => {
                            return Err(classify_provider_error(&value, message_type));
                        }
                        _ => return Err(CloudError::Protocol),
                    }
                }
                Some(Ok(Message::Ping(payload))) => {
                    self.send_message(Message::Pong(payload)).await?
                }
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_))) | None => return Err(CloudError::Disconnected),
                Some(Ok(_)) => return Err(CloudError::Protocol),
                Some(Err(error)) => return Err(map_connected_websocket_error(error)),
            }
        }
    }

    async fn send_keepalive(&mut self) -> Result<(), CloudError> {
        self.send_message(keepalive_message(self.provider())).await
    }

    async fn send_message(&mut self, message: Message) -> Result<(), CloudError> {
        {
            let socket = &mut self.inner_mut().socket;
            socket
                .send(message)
                .await
                .map_err(map_connected_websocket_error)?;
        }
        self.reset_keepalive();
        Ok(())
    }

    fn reset_keepalive(&mut self) {
        let inner = self.inner_mut();
        inner.next_keepalive = Instant::now() + inner.keepalive_after;
    }

    async fn handle_message(&mut self, message: Message) -> Result<Option<CloudEvent>, CloudError> {
        match message {
            Message::Text(text) => parse_provider_message(self.provider(), text.as_str()),
            Message::Ping(payload) => {
                self.send_message(Message::Pong(payload)).await?;
                Ok(None)
            }
            Message::Pong(_) => Ok(None),
            Message::Close(_) => self.socket_ended().map(Some),
            Message::Binary(_) | Message::Frame(_) => Err(CloudError::Protocol),
        }
    }

    fn socket_ended(&mut self) -> Result<CloudEvent, CloudError> {
        let inner = self.inner_mut();
        inner.outbound.clear();
        if inner.finalizing {
            inner.closed = true;
            Ok(CloudEvent::Closed)
        } else {
            Err(CloudError::Disconnected)
        }
    }

    fn disconnect_or(&mut self, error: CloudError) -> CloudError {
        if matches!(error, CloudError::Disconnected | CloudError::Network) {
            self.inner_mut().outbound.clear();
        }
        error
    }

    #[cfg(test)]
    fn set_keepalive_for_test(&mut self, interval: Duration) {
        let inner = self.inner_mut();
        inner.keepalive_after = interval;
        inner.next_keepalive = Instant::now() + interval;
    }
}

fn provider_endpoint(provider: CloudProvider) -> &'static str {
    match provider {
        CloudProvider::DeepgramNova3 => DEEPGRAM_ENDPOINT,
        CloudProvider::ElevenLabsScribeV2 => ELEVENLABS_ENDPOINT,
    }
}

fn keepalive_after(provider: CloudProvider) -> Duration {
    match provider {
        CloudProvider::DeepgramNova3 => DEEPGRAM_KEEPALIVE,
        CloudProvider::ElevenLabsScribeV2 => ELEVENLABS_KEEPALIVE,
    }
}

fn provider_request(
    config: &CloudRunConfig,
    api_key: &Zeroizing<String>,
    endpoint: &str,
) -> Result<tokio_tungstenite::tungstenite::http::Request<()>, CloudError> {
    let mut request = endpoint
        .into_client_request()
        .map_err(|_| CloudError::Protocol)?;
    match config.provider() {
        CloudProvider::DeepgramNova3 => {
            let mut authorization =
                Zeroizing::new(String::with_capacity(api_key.as_str().len() + 6));
            authorization.push_str("Token ");
            authorization.push_str(api_key.as_str());
            let value =
                HeaderValue::from_str(authorization.as_str()).map_err(|_| CloudError::Protocol)?;
            request.headers_mut().insert(AUTHORIZATION, value);
        }
        CloudProvider::ElevenLabsScribeV2 => {
            let value =
                HeaderValue::from_str(api_key.as_str()).map_err(|_| CloudError::Protocol)?;
            request
                .headers_mut()
                .insert(HeaderName::from_static("xi-api-key"), value);
        }
    }
    Ok(request)
}

fn endpoint_for(config: &CloudRunConfig, base: &str) -> String {
    let mut endpoint = String::with_capacity(base.len() + 192);
    endpoint.push_str(base);
    endpoint.push(if base.contains('?') { '&' } else { '?' });
    let mut first = true;

    match config.provider() {
        CloudProvider::DeepgramNova3 => {
            push_query_pair(&mut endpoint, &mut first, "model", "nova-3");
            push_query_pair(&mut endpoint, &mut first, "encoding", "linear16");
            push_query_pair(&mut endpoint, &mut first, "sample_rate", "16000");
            push_query_pair(&mut endpoint, &mut first, "channels", "1");
            push_query_pair(&mut endpoint, &mut first, "interim_results", "true");
            push_query_pair(&mut endpoint, &mut first, "timestamps", "true");
            push_query_pair(&mut endpoint, &mut first, "mip_opt_out", "true");
            if let Some(language) = config.language() {
                push_query_pair(&mut endpoint, &mut first, "language", language);
            }
            for keyterm in config.keyterms() {
                push_query_pair(&mut endpoint, &mut first, "keyterm", keyterm);
            }
            if config.diarization() {
                push_query_pair(&mut endpoint, &mut first, "diarize_model", "latest");
            }
        }
        CloudProvider::ElevenLabsScribeV2 => {
            push_query_pair(&mut endpoint, &mut first, "model_id", "scribe_v2_realtime");
            push_query_pair(&mut endpoint, &mut first, "audio_format", "pcm_16000");
            push_query_pair(&mut endpoint, &mut first, "commit_strategy", "manual");
            push_query_pair(&mut endpoint, &mut first, "include_timestamps", "true");
            push_query_pair(&mut endpoint, &mut first, "enable_logging", "false");
            if let Some(language) = config.language() {
                push_query_pair(&mut endpoint, &mut first, "language_code", language);
            }
            if !config.keyterms().is_empty() {
                let mut keyterms = String::new();
                for (index, keyterm) in config.keyterms().iter().enumerate() {
                    if index != 0 {
                        keyterms.push(',');
                    }
                    keyterms.push_str(keyterm);
                }
                push_query_pair(&mut endpoint, &mut first, "keyterms", &keyterms);
            }
        }
    }

    endpoint
}

fn push_query_pair(endpoint: &mut String, first: &mut bool, key: &str, value: &str) {
    if !*first {
        endpoint.push('&');
    }
    *first = false;
    endpoint.push_str(key);
    endpoint.push('=');
    push_percent_encoded(endpoint, value);
}

fn push_percent_encoded(output: &mut String, value: &str) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    for &byte in value.as_bytes() {
        if matches!(byte, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~') {
            output.push(char::from(byte));
        } else {
            output.push('%');
            output.push(char::from(HEX[usize::from(byte >> 4)]));
            output.push(char::from(HEX[usize::from(byte & 0x0f)]));
        }
    }
}

fn audio_message(provider: CloudProvider, samples: &[f32]) -> Message {
    let pcm = pcm16le(samples);
    match provider {
        CloudProvider::DeepgramNova3 => Message::Binary(pcm.into()),
        CloudProvider::ElevenLabsScribeV2 => {
            let audio_base_64 = STANDARD.encode(pcm);
            Message::Text(
                format!(
                    r#"{{"message_type":"input_audio_chunk","audio_base_64":"{audio_base_64}","commit":false,"sample_rate":{CLOUD_SAMPLE_RATE_HZ}}}"#
                )
                .into(),
            )
        }
    }
}

fn pcm16le(samples: &[f32]) -> Vec<u8> {
    let mut pcm = Vec::with_capacity(samples.len() * std::mem::size_of::<i16>());
    for &sample in samples {
        let quantized = sample.clamp(-1.0, 1.0).to_sample::<i16>();
        pcm.extend_from_slice(&quantized.to_le_bytes());
    }
    pcm
}

fn keepalive_message(provider: CloudProvider) -> Message {
    match provider {
        CloudProvider::DeepgramNova3 => Message::Text(r#"{"type":"KeepAlive"}"#.into()),
        CloudProvider::ElevenLabsScribeV2 => Message::Text(
            format!(
                r#"{{"message_type":"input_audio_chunk","audio_base_64":"","commit":false,"sample_rate":{CLOUD_SAMPLE_RATE_HZ}}}"#
            )
            .into(),
        ),
    }
}

fn finalize_message(provider: CloudProvider) -> Message {
    match provider {
        CloudProvider::DeepgramNova3 => Message::Text(r#"{"type":"Finalize"}"#.into()),
        CloudProvider::ElevenLabsScribeV2 => Message::Text(
            format!(
                r#"{{"message_type":"input_audio_chunk","audio_base_64":"","commit":true,"sample_rate":{CLOUD_SAMPLE_RATE_HZ}}}"#
            )
            .into(),
        ),
    }
}

fn parse_provider_message(
    provider: CloudProvider,
    text: &str,
) -> Result<Option<CloudEvent>, CloudError> {
    let value: Value = serde_json::from_str(text).map_err(|_| CloudError::Protocol)?;
    match provider {
        CloudProvider::DeepgramNova3 => parse_deepgram_message(&value),
        CloudProvider::ElevenLabsScribeV2 => parse_elevenlabs_message(&value),
    }
}

fn parse_deepgram_message(value: &Value) -> Result<Option<CloudEvent>, CloudError> {
    let message_type = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or(CloudError::Protocol)?;
    match message_type {
        "Results" => {
            let alternative = value
                .get("channel")
                .and_then(|channel| channel.get("alternatives"))
                .and_then(Value::as_array)
                .and_then(|alternatives| alternatives.first())
                .ok_or(CloudError::Protocol)?;
            let text = required_string(alternative, "transcript")?;
            let words = parse_words(alternative.get("words"), "word", true)?;
            let is_final = value
                .get("is_final")
                .and_then(Value::as_bool)
                .ok_or(CloudError::Protocol)?;
            Ok(Some(if is_final {
                CloudEvent::Final { text, words }
            } else {
                CloudEvent::Interim { text, words }
            }))
        }
        "Error" => Ok(Some(CloudEvent::ProviderError(classify_provider_error(
            value,
            message_type,
        )))),
        "Metadata" | "SpeechStarted" | "UtteranceEnd" | "Warning" => Ok(None),
        _ => Err(CloudError::Protocol),
    }
}

fn parse_elevenlabs_message(value: &Value) -> Result<Option<CloudEvent>, CloudError> {
    let message_type = value
        .get("message_type")
        .and_then(Value::as_str)
        .ok_or(CloudError::Protocol)?;
    match message_type {
        "session_started" | "committed_transcript" | "committed_transcript_entities" => Ok(None),
        "partial_transcript" => Ok(Some(CloudEvent::Interim {
            text: required_string(value, "text")?,
            words: parse_words(value.get("words"), "text", false)?,
        })),
        "committed_transcript_with_timestamps" => Ok(Some(CloudEvent::Final {
            text: required_string(value, "text")?,
            words: parse_words(value.get("words"), "text", false)?,
        })),
        message_type if is_elevenlabs_error(message_type) => Ok(Some(CloudEvent::ProviderError(
            classify_provider_error(value, message_type),
        ))),
        _ => Err(CloudError::Protocol),
    }
}

fn is_elevenlabs_error(message_type: &str) -> bool {
    matches!(
        message_type,
        "scribe_error"
            | "scribe_auth_error"
            | "scribe_quota_exceeded"
            | "scribe_throttled"
            | "scribe_rate_limited"
            | "scribe_input_error"
            | "scribe_queue_overflow"
            | "scribe_resource_exhausted"
            | "scribe_session_time_limit_exceeded"
            | "scribe_chunk_size_exceeded"
            | "scribe_insufficient_audio_activity"
    )
}

fn parse_words(
    words: Option<&Value>,
    text_field: &str,
    supports_speaker: bool,
) -> Result<Vec<CloudWord>, CloudError> {
    let Some(words) = words else {
        return Ok(Vec::new());
    };
    let words = words.as_array().ok_or(CloudError::Protocol)?;
    words
        .iter()
        .map(|word| {
            let speaker = if supports_speaker {
                match word.get("speaker") {
                    Some(value) => Some(
                        u32::try_from(value.as_u64().ok_or(CloudError::Protocol)?)
                            .map_err(|_| CloudError::Protocol)?,
                    ),
                    None => None,
                }
            } else {
                None
            };
            Ok(CloudWord {
                text: required_string(word, text_field)?,
                start: timestamp(word.get("start"))?,
                end: timestamp(word.get("end"))?,
                speaker,
            })
        })
        .collect()
}

fn required_string(value: &Value, field: &str) -> Result<String, CloudError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(CloudError::Protocol)
}

fn timestamp(value: Option<&Value>) -> Result<Duration, CloudError> {
    let seconds = value
        .and_then(Value::as_f64)
        .filter(|seconds| seconds.is_finite() && *seconds >= 0.0)
        .ok_or(CloudError::Protocol)?;
    Ok(Duration::from_secs_f64(seconds))
}

fn classify_provider_error(value: &Value, message_type: &str) -> CloudError {
    if matches!(message_type, "scribe_auth_error") || status_is(value, &[401, 403]) {
        return CloudError::Authentication;
    }
    if matches!(
        message_type,
        "scribe_quota_exceeded"
            | "scribe_throttled"
            | "scribe_rate_limited"
            | "scribe_resource_exhausted"
    ) || status_is(value, &[402, 429])
    {
        return CloudError::Quota;
    }

    let code = value
        .get("err_code")
        .or_else(|| value.get("code"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let code = code.to_ascii_lowercase();
    if code.contains("auth") || code.contains("token") || code.contains("api_key") {
        CloudError::Authentication
    } else if code.contains("quota")
        || code.contains("credit")
        || code.contains("throttl")
        || code.contains("rate_limit")
        || code.contains("resource_exhaust")
    {
        CloudError::Quota
    } else {
        CloudError::Protocol
    }
}

fn status_is(value: &Value, statuses: &[u64]) -> bool {
    value
        .get("status")
        .or_else(|| value.get("status_code"))
        .and_then(Value::as_u64)
        .is_some_and(|status| statuses.contains(&status))
}

fn map_websocket_error(error: WebSocketError) -> CloudError {
    match error {
        WebSocketError::Http(response) => classify_http_status(response.status()),
        WebSocketError::ConnectionClosed | WebSocketError::AlreadyClosed => {
            CloudError::Disconnected
        }
        WebSocketError::Protocol(
            tokio_tungstenite::tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
        ) => CloudError::Disconnected,
        WebSocketError::Protocol(_)
        | WebSocketError::Utf8(_)
        | WebSocketError::AttackAttempt
        | WebSocketError::Url(_)
        | WebSocketError::HttpFormat(_) => CloudError::Protocol,
        WebSocketError::Capacity(_) | WebSocketError::WriteBufferFull(_) => {
            CloudError::Backpressure
        }
        WebSocketError::Io(_) | WebSocketError::Tls(_) => CloudError::Network,
    }
}

fn map_connected_websocket_error(error: WebSocketError) -> CloudError {
    let error = map_websocket_error(error);
    if matches!(error, CloudError::Network | CloudError::Disconnected) {
        CloudError::Disconnected
    } else {
        error
    }
}

fn classify_http_status(status: StatusCode) -> CloudError {
    match status.as_u16() {
        401 | 403 => CloudError::Authentication,
        402 | 429 => CloudError::Quota,
        400..=499 => CloudError::Protocol,
        _ => CloudError::Network,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        future::Future,
        sync::mpsc::{sync_channel, Receiver, SyncSender},
    };
    use tokio::{net::TcpListener, task::JoinHandle, time::timeout};
    use tokio_tungstenite::{
        accept_hdr_async,
        tungstenite::handshake::server::{Callback, ErrorResponse, Request, Response},
        WebSocketStream,
    };

    const TEST_TIMEOUT: Duration = Duration::from_secs(2);

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct Handshake {
        path_and_query: String,
        authorization: Option<String>,
        elevenlabs_api_key: Option<String>,
    }

    struct HandshakeCapture {
        sender: SyncSender<Handshake>,
    }

    impl Callback for HandshakeCapture {
        fn on_request(
            self,
            request: &Request,
            response: Response,
        ) -> Result<Response, ErrorResponse> {
            self.sender
                .send(Handshake {
                    path_and_query: request
                        .uri()
                        .path_and_query()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| request.uri().path().to_owned()),
                    authorization: request
                        .headers()
                        .get(AUTHORIZATION)
                        .and_then(|value| value.to_str().ok())
                        .map(str::to_owned),
                    elevenlabs_api_key: request
                        .headers()
                        .get("xi-api-key")
                        .and_then(|value| value.to_str().ok())
                        .map(str::to_owned),
                })
                .expect("test reads WebSocket handshake");
            Ok(response)
        }
    }

    struct FakeServer {
        endpoint: String,
        handshake: Receiver<Handshake>,
        task: JoinHandle<()>,
    }

    impl FakeServer {
        fn handshake(&self) -> Handshake {
            self.handshake
                .try_recv()
                .expect("client completed WebSocket handshake")
        }

        async fn finish(self) {
            self.task.await.expect("fake server task");
        }
    }

    async fn fake_server<F, FutureOutput>(handler: F) -> FakeServer
    where
        F: FnOnce(WebSocketStream<TcpStream>) -> FutureOutput + Send + 'static,
        FutureOutput: Future<Output = ()> + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (handshake_sender, handshake) = sync_channel(1);
        let task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let socket = accept_hdr_async(
                stream,
                HandshakeCapture {
                    sender: handshake_sender,
                },
            )
            .await
            .unwrap();
            handler(socket).await;
        });

        FakeServer {
            endpoint: format!("ws://{address}/realtime"),
            handshake,
            task,
        }
    }

    async fn next_message(socket: &mut WebSocketStream<TcpStream>) -> Message {
        timeout(TEST_TIMEOUT, socket.next())
            .await
            .expect("fake server timed out waiting for a WebSocket frame")
            .expect("client closed fake WebSocket")
            .expect("client WebSocket error")
    }

    fn deepgram_config() -> CloudRunConfig {
        CloudRunConfig::new(
            CloudProvider::DeepgramNova3,
            Some("en-US".to_owned()),
            vec!["Sona".to_owned(), "M4 Pro".to_owned()],
            true,
        )
    }

    fn elevenlabs_config() -> CloudRunConfig {
        CloudRunConfig::new(
            CloudProvider::ElevenLabsScribeV2,
            Some("en".to_owned()),
            vec!["atlas".to_owned(), "Sona".to_owned()],
            false,
        )
    }

    #[tokio::test]
    async fn deepgram_uses_exact_private_handshake_binary_audio_and_finalize() {
        let server = fake_server(|mut socket| async move {
            let audio = next_message(&mut socket).await;
            assert_eq!(
                audio.into_data().as_ref(),
                &[0x00, 0x80, 0x00, 0x00, 0xff, 0x7f]
            );
            socket
                .send(
                    Message::Text(
                        r#"{"type":"Results","is_final":false,"speech_final":false,"channel":{"alternatives":[{"transcript":"hello","words":[{"word":"hello","start":0.1,"end":0.4,"speaker":2}]}]}}"#
                            .into(),
                    ),
                )
                .await
                .unwrap();
            let finalize = next_message(&mut socket).await;
            assert_eq!(finalize.into_text().unwrap().as_str(), r#"{"type":"Finalize"}"#);
            socket
                .send(
                    Message::Text(
                        r#"{"type":"Results","is_final":true,"speech_final":true,"channel":{"alternatives":[{"transcript":"hello world","words":[{"word":"world","start":0.5,"end":0.9,"speaker":3}]}]}}"#
                            .into(),
                    ),
                )
                .await
                .unwrap();
            socket.send(Message::Close(None)).await.unwrap();
        })
        .await;

        let mut session = CloudSession::connect_at(
            deepgram_config(),
            Zeroizing::new("deepgram-secret".to_owned()),
            &server.endpoint,
        )
        .await
        .unwrap();
        let handshake = server.handshake();
        assert_eq!(
            handshake.authorization.as_deref(),
            Some("Token deepgram-secret")
        );
        assert_eq!(handshake.elevenlabs_api_key, None);
        assert_eq!(
            handshake.path_and_query,
            "/realtime?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&timestamps=true&mip_opt_out=true&language=en-US&keyterm=Sona&keyterm=M4%20Pro&diarize_model=latest"
        );

        session.send_audio(&[-1.0, 0.0, 1.0]).await.unwrap();
        assert_eq!(
            session.next_event().await.unwrap(),
            CloudEvent::Interim {
                text: "hello".to_owned(),
                words: vec![CloudWord {
                    text: "hello".to_owned(),
                    start: Duration::from_secs_f64(0.1),
                    end: Duration::from_secs_f64(0.4),
                    speaker: Some(2),
                }],
            }
        );
        session.finalize().await.unwrap();
        assert_eq!(
            session.next_event().await.unwrap(),
            CloudEvent::Final {
                text: "hello world".to_owned(),
                words: vec![CloudWord {
                    text: "world".to_owned(),
                    start: Duration::from_secs_f64(0.5),
                    end: Duration::from_secs_f64(0.9),
                    speaker: Some(3),
                }],
            }
        );
        assert_eq!(session.next_event().await.unwrap(), CloudEvent::Closed);
        server.finish().await;
    }

    #[tokio::test]
    async fn elevenlabs_uses_session_query_json_audio_and_commit() {
        let server = fake_server(|mut socket| async move {
            socket
                .send(
                    Message::Text(
                        r#"{"message_type":"session_started","session_id":"fake","config":{"model_id":"scribe_v2_realtime","audio_format":"pcm_16000"}}"#
                            .into(),
                    ),
                )
                .await
                .unwrap();
            let audio = next_message(&mut socket).await;
            assert_eq!(
                audio.into_text().unwrap().as_str(),
                r#"{"message_type":"input_audio_chunk","audio_base_64":"AIAAAP9/","commit":false,"sample_rate":16000}"#
            );
            socket
                .send(Message::Text(
                    r#"{"message_type":"partial_transcript","text":"test"}"#.into(),
                ))
                .await
                .unwrap();
            socket
                .send(Message::Text(
                    r#"{"message_type":"committed_transcript","text":"test complete"}"#.into(),
                ))
                .await
                .unwrap();
            socket
                .send(
                    Message::Text(
                        r#"{"message_type":"committed_transcript_with_timestamps","text":"test complete","words":[{"text":"test","start":0.11,"end":0.25},{"text":"complete","start":0.26,"end":0.51}]}"#
                            .into(),
                    ),
                )
                .await
                .unwrap();
            let commit = next_message(&mut socket).await;
            assert_eq!(
                commit.into_text().unwrap().as_str(),
                r#"{"message_type":"input_audio_chunk","audio_base_64":"","commit":true,"sample_rate":16000}"#
            );
            socket.send(Message::Close(None)).await.unwrap();
        })
        .await;

        let mut session = CloudSession::connect_at(
            elevenlabs_config(),
            Zeroizing::new("eleven-secret".to_owned()),
            &server.endpoint,
        )
        .await
        .unwrap();
        let handshake = server.handshake();
        assert_eq!(handshake.authorization, None);
        assert_eq!(
            handshake.elevenlabs_api_key.as_deref(),
            Some("eleven-secret")
        );
        assert_eq!(
            handshake.path_and_query,
            "/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000&commit_strategy=manual&include_timestamps=true&enable_logging=false&language_code=en&keyterms=atlas%2CSona"
        );

        session.send_audio(&[-1.0, 0.0, 1.0]).await.unwrap();
        assert_eq!(
            session.next_event().await.unwrap(),
            CloudEvent::Interim {
                text: "test".to_owned(),
                words: Vec::new(),
            }
        );
        assert_eq!(
            session.next_event().await.unwrap(),
            CloudEvent::Final {
                text: "test complete".to_owned(),
                words: vec![
                    CloudWord {
                        text: "test".to_owned(),
                        start: Duration::from_secs_f64(0.11),
                        end: Duration::from_secs_f64(0.25),
                        speaker: None,
                    },
                    CloudWord {
                        text: "complete".to_owned(),
                        start: Duration::from_secs_f64(0.26),
                        end: Duration::from_secs_f64(0.51),
                        speaker: None,
                    },
                ],
            }
        );
        session.finalize().await.unwrap();
        assert_eq!(session.next_event().await.unwrap(), CloudEvent::Closed);
        server.finish().await;
    }

    #[tokio::test]
    async fn deepgram_keepalive_is_scheduled_when_idle() {
        let server = fake_server(|mut socket| async move {
            let keepalive = next_message(&mut socket).await;
            assert_eq!(
                keepalive.into_text().unwrap().as_str(),
                r#"{"type":"KeepAlive"}"#
            );
            socket.send(Message::Close(None)).await.unwrap();
        })
        .await;
        let mut session = CloudSession::connect_at(
            deepgram_config(),
            Zeroizing::new("secret".to_owned()),
            &server.endpoint,
        )
        .await
        .unwrap();
        session.set_keepalive_for_test(Duration::from_millis(1));
        assert_eq!(
            session.next_event().await.unwrap_err(),
            CloudError::Disconnected
        );
        server.finish().await;
    }

    #[tokio::test]
    async fn elevenlabs_keepalive_is_scheduled_when_idle() {
        let server = fake_server(|mut socket| async move {
            socket
                .send(Message::Text(
                    r#"{"message_type":"session_started","session_id":"fake"}"#.into(),
                ))
                .await
                .unwrap();
            let keepalive = next_message(&mut socket).await;
            assert_eq!(
                keepalive.into_text().unwrap().as_str(),
                r#"{"message_type":"input_audio_chunk","audio_base_64":"","commit":false,"sample_rate":16000}"#
            );
            socket.send(Message::Close(None)).await.unwrap();
        })
        .await;
        let mut session = CloudSession::connect_at(
            elevenlabs_config(),
            Zeroizing::new("secret".to_owned()),
            &server.endpoint,
        )
        .await
        .unwrap();
        session.set_keepalive_for_test(Duration::from_millis(1));
        assert_eq!(
            session.next_event().await.unwrap_err(),
            CloudError::Disconnected
        );
        server.finish().await;
    }

    #[tokio::test]
    async fn provider_errors_and_invalid_messages_are_typed_without_bodies() {
        let authentication_server = fake_server(|mut socket| async move {
            socket
                .send(Message::Text(
                    r#"{"type":"Error","err_code":"INVALID_AUTHORIZATION","description":"never-expose-this-body"}"#.into(),
                ))
                .await
                .unwrap();
        })
        .await;
        let mut authentication_session = CloudSession::connect_at(
            deepgram_config(),
            Zeroizing::new("secret".to_owned()),
            &authentication_server.endpoint,
        )
        .await
        .unwrap();
        let authentication = authentication_session.next_event().await.unwrap();
        assert_eq!(
            authentication,
            CloudEvent::ProviderError(CloudError::Authentication)
        );
        assert!(!format!("{authentication:?}").contains("never-expose-this-body"));
        drop(authentication_session);
        authentication_server.finish().await;

        let quota_server = fake_server(|mut socket| async move {
            socket
                .send(Message::Text(
                    r#"{"message_type":"session_started","session_id":"fake"}"#.into(),
                ))
                .await
                .unwrap();
            socket
                .send(Message::Text(
                    r#"{"message_type":"scribe_quota_exceeded","error":"never-expose-this-body"}"#
                        .into(),
                ))
                .await
                .unwrap();
        })
        .await;
        let mut quota_session = CloudSession::connect_at(
            elevenlabs_config(),
            Zeroizing::new("secret".to_owned()),
            &quota_server.endpoint,
        )
        .await
        .unwrap();
        let quota = quota_session.next_event().await.unwrap();
        assert_eq!(quota, CloudEvent::ProviderError(CloudError::Quota));
        assert!(!format!("{quota:?}").contains("never-expose-this-body"));
        drop(quota_session);
        quota_server.finish().await;

        let protocol_server = fake_server(|mut socket| async move {
            socket
                .send(Message::Text(
                    r#"{"type":"unknown","description":"never-expose-this-body"}"#.into(),
                ))
                .await
                .unwrap();
        })
        .await;
        let mut protocol_session = CloudSession::connect_at(
            deepgram_config(),
            Zeroizing::new("secret".to_owned()),
            &protocol_server.endpoint,
        )
        .await
        .unwrap();
        let protocol = protocol_session.next_event().await.unwrap_err();
        assert_eq!(protocol, CloudError::Protocol);
        assert!(!format!("{protocol:?}").contains("never-expose-this-body"));
        drop(protocol_session);
        protocol_server.finish().await;
    }

    #[tokio::test]
    async fn connection_refusal_is_a_network_error() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("ws://{}/realtime", listener.local_addr().unwrap());
        drop(listener);

        let result = CloudSession::connect_at(
            deepgram_config(),
            Zeroizing::new("secret".to_owned()),
            &endpoint,
        )
        .await;
        assert!(matches!(result, Err(CloudError::Network)));
    }

    #[tokio::test]
    async fn queue_capacity_applies_backpressure_before_more_pcm_is_allocated() {
        let server =
            fake_server(|mut socket| async move { while socket.next().await.is_some() {} }).await;
        let mut session = CloudSession::connect_at(
            deepgram_config(),
            Zeroizing::new("secret".to_owned()),
            &server.endpoint,
        )
        .await
        .unwrap();
        for _ in 0..MAX_QUEUED_AUDIO_FRAMES {
            session.try_enqueue_audio(&[0.0]).unwrap();
        }
        assert_eq!(
            session.try_enqueue_audio(&[0.0]).unwrap_err(),
            CloudError::Backpressure
        );
        drop(session);
        server.finish().await;
    }

    #[tokio::test]
    async fn disconnect_after_an_interim_never_produces_a_partial_final() {
        let server = fake_server(|mut socket| async move {
            let _ = next_message(&mut socket).await;
            socket
                .send(Message::Text(
                    r#"{"type":"Results","is_final":false,"channel":{"alternatives":[{"transcript":"partial","words":[]}]}}"#.into(),
                ))
                .await
                .unwrap();
        })
        .await;
        let mut session = CloudSession::connect_at(
            deepgram_config(),
            Zeroizing::new("secret".to_owned()),
            &server.endpoint,
        )
        .await
        .unwrap();
        session.send_audio(&[0.0]).await.unwrap();
        assert!(matches!(
            session.next_event().await.unwrap(),
            CloudEvent::Interim { text, words } if text == "partial" && words.is_empty()
        ));
        assert_eq!(
            session.next_event().await.unwrap_err(),
            CloudError::Disconnected
        );
        server.finish().await;
    }
}
