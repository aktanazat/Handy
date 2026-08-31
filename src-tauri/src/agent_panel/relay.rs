use super::protocol::{
    AgentPanelWorkspaceV1, PanelTurnV1, SonaAgentResponseV1, MAX_PROPOSAL_BYTES,
};
use base64::Engine as _;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use url::Url;

const BRIDGE_VERSION: &str = "bridge-v1";
const HEADER_KEY: &str = "X-Bridge-Key";
const HEADER_TIMESTAMP: &str = "X-Bridge-Ts";
const HEADER_NONCE: &str = "X-Bridge-Nonce";
const HEADER_DIRECTION: &str = "X-Bridge-Dir";
const HEADER_STATUS: &str = "X-Bridge-Status";
const HEADER_REQUEST_NONCE: &str = "X-Bridge-Req-Nonce";
const HEADER_SIGNATURE: &str = "X-Bridge-Sig";
const MAX_SKEW_SECONDS: u64 = 300;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const RESPONSE_NONCE_TTL: Duration = Duration::from_secs(MAX_SKEW_SECONDS * 2);
pub(crate) const SONA_MODEL_ALIAS: &str = "ultra";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RelayError {
    Disabled,
    Unpaired,
    InvalidConfiguration,
    CleartextRejected,
    SecretUnavailable,
    RandomUnavailable,
    RequestFailed,
    ResponseTooLarge,
    ResponseSignatureInvalid,
    ResponseMalformed,
    RemoteRejected,
    OwnershipRejected,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum RelayJobStateV1 {
    Queued,
    Leased,
    Running,
    WaitingUser,
    WaitingApproval,
    Succeeded,
    Failed,
    Canceled,
    UnverifiedExternal,
}

impl RelayJobStateV1 {
    pub(crate) fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Succeeded | Self::Failed | Self::Canceled | Self::UnverifiedExternal
        )
    }
}

#[derive(Clone, Debug)]
pub(crate) struct RelayJob {
    pub(crate) id: String,
    pub(crate) state: RelayJobStateV1,
    pub(crate) response: Option<SonaAgentResponseV1>,
}

/// The routing facts a job is checked against on the way back in. A reply is
/// only this client's reply if it came from the workspace this client asked,
/// under the capability it asked for: the panel now speaks to two workspaces,
/// so what used to be a pair of constants is carried per job.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RelayJobExpectation<'a> {
    pub(crate) workspace: AgentPanelWorkspaceV1,
    pub(crate) job_id: Option<&'a str>,
    pub(crate) idempotency_key: Option<&'a str>,
}

#[derive(Clone, Debug)]
pub(crate) struct RelayEvent {
    pub(crate) id: u64,
    pub(crate) event_type: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelPublicIdentityV1 {
    pub key_id: String,
    pub public_key: String,
}

#[derive(Default)]
pub(crate) struct ResponseNonceCache {
    seen: Mutex<HashMap<String, Instant>>,
}

impl ResponseNonceCache {
    fn check_and_store(&self, nonce: &str) -> bool {
        let now = Instant::now();
        let mut seen = match self.seen.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        seen.retain(|_, stored| now.duration_since(*stored) < RESPONSE_NONCE_TTL);
        if seen.contains_key(nonce) {
            return false;
        }
        seen.insert(nonce.to_string(), now);
        true
    }
}

pub(crate) struct RelayClient {
    base_url: Url,
    client_key_id: String,
    signing_key: SigningKey,
    relay_key_id: String,
    relay_verifying_key: VerifyingKey,
    nonce_cache: Arc<ResponseNonceCache>,
    http: reqwest::Client,
}
struct SignatureContext<'a> {
    method: &'a str,
    path: &'a str,
    body: &'a [u8],
    timestamp: i64,
    nonce: &'a str,
    direction: &'a str,
    status: Option<StatusCode>,
    request_nonce: Option<&'a str>,
}

impl<'a> SignatureContext<'a> {
    fn request(
        method: &'a str,
        path: &'a str,
        body: &'a [u8],
        timestamp: i64,
        nonce: &'a str,
    ) -> Self {
        Self {
            method,
            path,
            body,
            timestamp,
            nonce,
            direction: "request",
            status: None,
            request_nonce: None,
        }
    }

    fn response(
        method: &'a str,
        path: &'a str,
        body: &'a [u8],
        timestamp: i64,
        nonce: &'a str,
        status: StatusCode,
        request_nonce: &'a str,
    ) -> Self {
        Self {
            method,
            path,
            body,
            timestamp,
            nonce,
            direction: "response",
            status: Some(status),
            request_nonce: Some(request_nonce),
        }
    }
}

struct ResponseVerification<'a> {
    method: &'a str,
    path: &'a str,
    body: &'a [u8],
    headers: &'a HeaderMap,
    status: StatusCode,
    request_nonce: &'a str,
}

impl RelayClient {
    pub(crate) async fn from_settings(
        app: &AppHandle,
        nonce_cache: Arc<ResponseNonceCache>,
    ) -> Result<Self, RelayError> {
        let settings = crate::settings::get_settings(app);
        if !settings.agent_panel_enabled {
            return Err(RelayError::Disabled);
        }
        if !settings.agent_panel_paired {
            return Err(RelayError::Unpaired);
        }
        let relay_url = settings
            .agent_panel_relay_url
            .as_deref()
            .ok_or(RelayError::InvalidConfiguration)?;
        let base_url = validate_relay_url(relay_url)?;
        let relay_key_id = settings
            .agent_panel_relay_key_id
            .filter(|value| is_key_identifier(value))
            .ok_or(RelayError::InvalidConfiguration)?;
        let pinned_key = settings
            .agent_panel_relay_public_key
            .as_deref()
            .ok_or(RelayError::InvalidConfiguration)?;
        let relay_verifying_key = verifying_key_from_base64(pinned_key)?;
        let secret_manager = app
            .try_state::<Arc<crate::secrets::SecretManager>>()
            .ok_or(RelayError::SecretUnavailable)?;
        let seed = secret_manager
            .agent_panel_signing_seed()
            .await
            .map_err(|_| RelayError::SecretUnavailable)?;
        let signing_key = SigningKey::from_bytes(seed.as_bytes());
        let client_key_id = public_identity_for_key(&signing_key).key_id;
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| RelayError::RequestFailed)?;
        Ok(Self {
            base_url,
            client_key_id,
            signing_key,
            relay_key_id,
            relay_verifying_key,
            nonce_cache,
            http,
        })
    }

    pub(crate) async fn submit_turn(
        &self,
        idempotency_key: &str,
        turn: &PanelTurnV1,
    ) -> Result<RelayJob, RelayError> {
        let workspace = turn.workspace();
        let body = SonaSubmission {
            workspace_id: workspace.id(),
            model: SONA_MODEL_ALIAS,
            capability: workspace.capability(),
            idempotency_key,
            request: turn,
        };
        let response: SubmissionResponse = self
            .request(Method::POST, "/v1/jobs/submit", Some(&body))
            .await?;
        response.job.into_job(
            &self.client_key_id,
            RelayJobExpectation {
                workspace,
                job_id: None,
                idempotency_key: Some(idempotency_key),
            },
        )
    }

    pub(crate) async fn get_job(
        &self,
        job_id: &str,
        workspace: AgentPanelWorkspaceV1,
    ) -> Result<RelayJob, RelayError> {
        if !is_job_identifier(job_id) {
            return Err(RelayError::OwnershipRejected);
        }
        let path = format!("/v1/jobs/{job_id}");
        let response: JobResponse = self.request(Method::GET, &path, None::<&()>).await?;
        response.job.into_job(
            &self.client_key_id,
            RelayJobExpectation {
                workspace,
                job_id: Some(job_id),
                idempotency_key: None,
            },
        )
    }

    /// The smallest signed round-trip the relay offers, for the pairing screen
    /// to prove a relay URL and a pinned key actually reach each other. It
    /// reads one event because reading nothing is not a test: the reply has to
    /// carry a body this client can verify and parse.
    pub(crate) async fn test_connection(&self) -> Result<(), RelayError> {
        let _: EventsResponse = self
            .request(Method::GET, "/v1/events?limit=1", None::<&()>)
            .await?;
        Ok(())
    }

    pub(crate) async fn get_events(
        &self,
        job_id: &str,
        after_id: u64,
    ) -> Result<Vec<RelayEvent>, RelayError> {
        if !is_job_identifier(job_id) {
            return Err(RelayError::OwnershipRejected);
        }
        let path = format!("/v1/events?after_id={after_id}&job_id={job_id}&limit=50");
        let response: EventsResponse = self.request(Method::GET, &path, None::<&()>).await?;
        let mut events = Vec::with_capacity(response.events.len());
        let mut last_id = after_id;
        for event in response.events {
            let event = event.into_event(job_id)?;
            if event.id <= last_id {
                return Err(RelayError::ResponseMalformed);
            }
            last_id = event.id;
            events.push(event);
        }
        Ok(events)
    }

    pub(crate) async fn cancel_job(
        &self,
        job_id: &str,
        workspace: AgentPanelWorkspaceV1,
    ) -> Result<RelayJob, RelayError> {
        if !is_job_identifier(job_id) {
            return Err(RelayError::OwnershipRejected);
        }
        let path = format!("/v1/jobs/{job_id}/cancel");
        let response: CancelResponse = self.request(Method::POST, &path, None::<&()>).await?;
        response.job.into_job(
            &self.client_key_id,
            RelayJobExpectation {
                workspace,
                job_id: Some(job_id),
                idempotency_key: None,
            },
        )
    }

    async fn request<T, B>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
    ) -> Result<T, RelayError>
    where
        T: for<'de> Deserialize<'de>,
        B: Serialize + ?Sized,
    {
        let body_bytes = match body {
            Some(body) => serde_json::to_vec(body).map_err(|_| RelayError::RequestFailed)?,
            None => Vec::new(),
        };
        let request_nonce = new_nonce()?;
        let timestamp = chrono::Utc::now().timestamp();
        let signature_context = SignatureContext::request(
            method.as_str(),
            path,
            &body_bytes,
            timestamp,
            &request_nonce,
        );
        let signatures = sign_headers(&self.signing_key, &self.client_key_id, &signature_context)?;
        let url = self
            .base_url
            .join(path)
            .map_err(|_| RelayError::InvalidConfiguration)?;
        let mut request = self.http.request(method.clone(), url).body(body_bytes);
        if body.is_some() {
            request = request.header(CONTENT_TYPE, "application/json");
        }
        for (name, value) in signatures {
            request = request.header(name, value);
        }
        let response = request
            .send()
            .await
            .map_err(|_| RelayError::RequestFailed)?;
        let status = response.status();
        if response
            .content_length()
            .is_some_and(|length| length > u64::try_from(MAX_RESPONSE_BYTES).unwrap_or(u64::MAX))
        {
            return Err(RelayError::ResponseTooLarge);
        }
        let headers = response.headers().clone();
        let response_bytes = read_limited_response(response).await?;
        let response_verification = ResponseVerification {
            method: method.as_str(),
            path,
            body: &response_bytes,
            headers: &headers,
            status,
            request_nonce: &request_nonce,
        };
        verify_response(
            &self.relay_verifying_key,
            &self.relay_key_id,
            &self.nonce_cache,
            &response_verification,
        )?;
        if status.is_client_error() || status.is_server_error() {
            if status == StatusCode::NOT_FOUND || status == StatusCode::FORBIDDEN {
                return Err(RelayError::OwnershipRejected);
            }
            return Err(RelayError::RemoteRejected);
        }
        serde_json::from_slice(&response_bytes).map_err(|_| RelayError::ResponseMalformed)
    }
}

pub(crate) async fn public_identity(
    enabled: bool,
    secrets: &crate::secrets::SecretManager,
) -> Result<AgentPanelPublicIdentityV1, RelayError> {
    if !enabled {
        return Err(RelayError::Disabled);
    }
    let seed = secrets
        .agent_panel_signing_seed()
        .await
        .map_err(|_| RelayError::SecretUnavailable)?;
    Ok(public_identity_for_key(&SigningKey::from_bytes(
        seed.as_bytes(),
    )))
}

pub(crate) fn new_idempotency_key() -> Result<String, RelayError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| RelayError::RandomUnavailable)?;
    Ok(hex::encode(bytes))
}

#[derive(Serialize)]
struct SonaSubmission<'a> {
    workspace_id: &'static str,
    model: &'static str,
    capability: &'static str,
    idempotency_key: &'a str,
    request: &'a PanelTurnV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SubmissionResponse {
    job: RelayJobWire,
    #[serde(rename = "created")]
    _created: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct JobResponse {
    job: RelayJobWire,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CancelResponse {
    job: RelayJobWire,
    #[serde(rename = "control")]
    _control: serde_json::Value,
    #[serde(rename = "created")]
    _created: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EventsResponse {
    events: Vec<RelayEventWire>,
}

#[derive(Deserialize)]
struct RelayJobWire {
    id: String,
    state: String,
    kind: String,
    workspace_id: String,
    model_alias: String,
    capabilities: Vec<String>,
    tools: Vec<serde_json::Value>,
    submitter_key_id: String,
    external_ref: String,
    #[serde(default)]
    result: Option<serde_json::Value>,
}

impl RelayJobWire {
    fn into_job(
        self,
        expected_submitter_key_id: &str,
        expected: RelayJobExpectation<'_>,
    ) -> Result<RelayJob, RelayError> {
        if !is_job_identifier(&self.id) {
            return Err(RelayError::ResponseMalformed);
        }
        if expected.job_id.is_some_and(|expected| expected != self.id)
            || self.submitter_key_id != expected_submitter_key_id
        {
            return Err(RelayError::OwnershipRejected);
        }
        let capability = expected.workspace.capability();
        if expected
            .idempotency_key
            .is_some_and(|expected| expected != self.external_ref)
            || self.kind != capability
            || self.workspace_id != expected.workspace.id()
            || self.model_alias != SONA_MODEL_ALIAS
            || self.capabilities.len() != 1
            || self
                .capabilities
                .first()
                .is_none_or(|granted| granted != capability)
            || !self.tools.is_empty()
        {
            return Err(RelayError::ResponseMalformed);
        }
        let state = parse_state(&self.state)?;
        let response = if state == RelayJobStateV1::Succeeded {
            let result = self.result.ok_or(RelayError::ResponseMalformed)?;
            let serialized =
                serde_json::to_vec(&result).map_err(|_| RelayError::ResponseMalformed)?;
            if serialized.len() > MAX_PROPOSAL_BYTES {
                return Err(RelayError::ResponseTooLarge);
            }
            Some(serde_json::from_value(result).map_err(|_| RelayError::ResponseMalformed)?)
        } else {
            None
        };
        Ok(RelayJob {
            id: self.id,
            state,
            response,
        })
    }
}

#[derive(Deserialize)]
struct RelayEventWire {
    id: u64,
    job_id: String,
    event_type: String,
}

impl RelayEventWire {
    fn into_event(self, expected_job_id: &str) -> Result<RelayEvent, RelayError> {
        if !is_job_identifier(&self.job_id) || self.job_id != expected_job_id {
            return Err(RelayError::OwnershipRejected);
        }
        if !is_event_type(&self.event_type) {
            return Err(RelayError::ResponseMalformed);
        }
        Ok(RelayEvent {
            id: self.id,
            event_type: self.event_type,
        })
    }
}

fn parse_state(state: &str) -> Result<RelayJobStateV1, RelayError> {
    match state {
        "QUEUED" => Ok(RelayJobStateV1::Queued),
        "LEASED" => Ok(RelayJobStateV1::Leased),
        "RUNNING" => Ok(RelayJobStateV1::Running),
        "WAITING_USER" => Ok(RelayJobStateV1::WaitingUser),
        "WAITING_APPROVAL" => Ok(RelayJobStateV1::WaitingApproval),
        "SUCCEEDED" => Ok(RelayJobStateV1::Succeeded),
        "FAILED" => Ok(RelayJobStateV1::Failed),
        "CANCELED" => Ok(RelayJobStateV1::Canceled),
        "UNVERIFIED_EXTERNAL" => Ok(RelayJobStateV1::UnverifiedExternal),
        _ => Err(RelayError::ResponseMalformed),
    }
}

async fn read_limited_response(response: reqwest::Response) -> Result<Vec<u8>, RelayError> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| RelayError::RequestFailed)?;
        let next = bytes
            .len()
            .checked_add(chunk.len())
            .ok_or(RelayError::ResponseTooLarge)?;
        if next > MAX_RESPONSE_BYTES {
            return Err(RelayError::ResponseTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn validate_relay_url(value: &str) -> Result<Url, RelayError> {
    let mut url = Url::parse(value).map_err(|_| RelayError::InvalidConfiguration)?;
    if url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(RelayError::InvalidConfiguration);
    }
    if !matches!(url.scheme(), "https" | "http") {
        return Err(RelayError::InvalidConfiguration);
    }
    if !is_private_relay_host(url.host_str()) {
        return Err(RelayError::CleartextRejected);
    }
    if url.path().is_empty() {
        url.set_path("/");
    }
    if url.path() != "/" {
        return Err(RelayError::InvalidConfiguration);
    }
    Ok(url)
}

fn is_private_relay_host(host: Option<&str>) -> bool {
    let Some(host) = host else {
        return false;
    };
    let host = host.trim_matches(|character| matches!(character, '[' | ']'));
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    if host
        .get(host.len().saturating_sub(7)..)
        .is_some_and(|suffix| suffix.eq_ignore_ascii_case(".ts.net"))
    {
        return true;
    }
    if let Ok(ipv4) = host.parse::<std::net::Ipv4Addr>() {
        let [first, second, _, _] = ipv4.octets();
        return first == 127 || (first == 100 && (64..=127).contains(&second));
    }
    if let Ok(ipv6) = host.parse::<std::net::Ipv6Addr>() {
        let segments = ipv6.segments();
        return ipv6.is_loopback()
            || (segments[0] == 0xfd7a && segments[1] == 0x115c && segments[2] == 0xa1e0);
    }
    false
}

fn verifying_key_from_base64(value: &str) -> Result<VerifyingKey, RelayError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|_| RelayError::InvalidConfiguration)?;
    let key_bytes: [u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| RelayError::InvalidConfiguration)?;
    VerifyingKey::from_bytes(&key_bytes).map_err(|_| RelayError::InvalidConfiguration)
}

/// A pairing the client would accept. Normalising here rather than at the
/// command means the rules a request is checked against are the same rules
/// `from_settings` will apply on the next turn: a pairing that saves is a
/// pairing that connects, or the difference is a fault on the wire and not a
/// second opinion in the settings layer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ValidatedPairingV1 {
    pub(crate) relay_url: String,
    pub(crate) relay_key_id: String,
    pub(crate) relay_public_key: String,
}

pub(crate) fn validate_pairing(
    relay_url: &str,
    relay_key_id: &str,
    relay_public_key: &str,
) -> Result<ValidatedPairingV1, RelayError> {
    let url = validate_relay_url(relay_url.trim())?;
    let relay_key_id = relay_key_id.trim();
    if !is_key_identifier(relay_key_id) {
        return Err(RelayError::InvalidConfiguration);
    }
    let relay_public_key = relay_public_key.trim();
    let verifying_key = verifying_key_from_base64(relay_public_key)?;
    Ok(ValidatedPairingV1 {
        relay_url: url.to_string(),
        relay_key_id: relay_key_id.to_string(),
        /* Re-encoded from the parsed key, so the stored form is the canonical
         * 32-byte encoding rather than whatever padding the paste carried. */
        relay_public_key: base64::engine::general_purpose::STANDARD
            .encode(verifying_key.to_bytes()),
    })
}

fn public_identity_for_key(signing_key: &SigningKey) -> AgentPanelPublicIdentityV1 {
    let public_bytes = signing_key.verifying_key().to_bytes();
    let mut digest = Sha256::new();
    digest.update(public_bytes);
    let digest = digest.finalize();
    let key_id = format!("sona-{}", hex::encode(&digest[..12]));
    AgentPanelPublicIdentityV1 {
        key_id,
        public_key: base64::engine::general_purpose::STANDARD.encode(public_bytes),
    }
}

fn new_nonce() -> Result<String, RelayError> {
    let mut bytes = [0_u8; 24];
    getrandom::fill(&mut bytes).map_err(|_| RelayError::RandomUnavailable)?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn sign_headers(
    signing_key: &SigningKey,
    key_id: &str,
    context: &SignatureContext<'_>,
) -> Result<Vec<(HeaderName, HeaderValue)>, RelayError> {
    let canonical = canonical_bytes(context)?;
    let signature = signing_key.sign(&canonical);
    let mut headers = vec![
        header(HEADER_KEY, key_id)?,
        header(HEADER_TIMESTAMP, &context.timestamp.to_string())?,
        header(HEADER_NONCE, context.nonce)?,
        header(HEADER_DIRECTION, context.direction)?,
        header(
            HEADER_SIGNATURE,
            &base64::engine::general_purpose::STANDARD.encode(signature.to_bytes()),
        )?,
    ];
    if let Some(status) = context.status {
        let request_nonce = context
            .request_nonce
            .ok_or(RelayError::InvalidConfiguration)?;
        headers.push(header(HEADER_STATUS, &status.as_u16().to_string())?);
        headers.push(header(HEADER_REQUEST_NONCE, request_nonce)?);
    }
    Ok(headers)
}

fn verify_response(
    verifying_key: &VerifyingKey,
    expected_key_id: &str,
    nonce_cache: &ResponseNonceCache,
    response: &ResponseVerification<'_>,
) -> Result<(), RelayError> {
    let key_id = required_header(response.headers, HEADER_KEY)?;
    if key_id != expected_key_id {
        return Err(RelayError::ResponseSignatureInvalid);
    }
    let timestamp = required_header(response.headers, HEADER_TIMESTAMP)?
        .parse::<i64>()
        .map_err(|_| RelayError::ResponseSignatureInvalid)?;
    let now = chrono::Utc::now().timestamp();
    if now.saturating_sub(timestamp).unsigned_abs() > MAX_SKEW_SECONDS {
        return Err(RelayError::ResponseSignatureInvalid);
    }
    let nonce = required_header(response.headers, HEADER_NONCE)?;
    if nonce.is_empty()
        || nonce.len() > 128
        || !nonce.bytes().all(|byte| (33..=126).contains(&byte))
    {
        return Err(RelayError::ResponseSignatureInvalid);
    }
    if required_header(response.headers, HEADER_DIRECTION)? != "response"
        || required_header(response.headers, HEADER_STATUS)? != response.status.as_u16().to_string()
        || required_header(response.headers, HEADER_REQUEST_NONCE)? != response.request_nonce
    {
        return Err(RelayError::ResponseSignatureInvalid);
    }
    let signature = base64::engine::general_purpose::STANDARD
        .decode(required_header(response.headers, HEADER_SIGNATURE)?)
        .map_err(|_| RelayError::ResponseSignatureInvalid)?;
    let signature =
        Signature::from_slice(&signature).map_err(|_| RelayError::ResponseSignatureInvalid)?;
    let context = SignatureContext::response(
        response.method,
        response.path,
        response.body,
        timestamp,
        nonce,
        response.status,
        response.request_nonce,
    );
    verifying_key
        .verify_strict(&canonical_bytes(&context)?, &signature)
        .map_err(|_| RelayError::ResponseSignatureInvalid)?;
    if !nonce_cache.check_and_store(nonce) {
        return Err(RelayError::ResponseSignatureInvalid);
    }
    Ok(())
}

fn required_header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, RelayError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or(RelayError::ResponseSignatureInvalid)
}

fn header(name: &str, value: &str) -> Result<(HeaderName, HeaderValue), RelayError> {
    let name =
        HeaderName::from_bytes(name.as_bytes()).map_err(|_| RelayError::InvalidConfiguration)?;
    let value = HeaderValue::from_str(value).map_err(|_| RelayError::InvalidConfiguration)?;
    Ok((name, value))
}

fn canonical_bytes(context: &SignatureContext<'_>) -> Result<Vec<u8>, RelayError> {
    let path = canonical_path_query(context.path)?;
    Ok(format!(
        "{BRIDGE_VERSION}\n{}\n{}\n{path}\n{}\n{}\n{}\n{}\n{}",
        context.direction,
        context.method.to_ascii_uppercase(),
        context
            .status
            .map(|status| status.as_u16())
            .map(|status| status.to_string())
            .unwrap_or_default(),
        context.request_nonce.unwrap_or_default(),
        context.timestamp,
        context.nonce,
        body_sha256(context.body),
    )
    .into_bytes())
}

fn canonical_path_query(path_query: &str) -> Result<String, RelayError> {
    let without_fragment = path_query.split('#').next().unwrap_or(path_query);
    let (path, raw_query) = without_fragment
        .split_once('?')
        .map_or((without_fragment, ""), |(path, query)| (path, query));
    let path = if path.is_empty() { "/" } else { path };
    let mut pairs = url::form_urlencoded::parse(raw_query.as_bytes())
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    pairs.sort();
    let mut canonical = percent_encode_path(path);
    if !pairs.is_empty() {
        let query = pairs
            .iter()
            .map(|(key, value)| format!("{}={}", form_encode(key), form_encode(value)))
            .collect::<Vec<_>>()
            .join("&");
        canonical.push('?');
        canonical.push_str(&query);
    }
    Ok(canonical)
}

fn percent_encode_path(path: &str) -> String {
    let mut output = String::new();
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(byte, b'/' | b'%' | b':' | b'@' | b'-' | b'_' | b'.' | b'~')
        {
            output.push(char::from(byte));
        } else {
            append_percent_encoded(&mut output, byte);
        }
    }
    output
}

fn form_encode(value: &str) -> String {
    let mut output = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            output.push(char::from(byte));
        } else if byte == b' ' {
            output.push('+');
        } else {
            append_percent_encoded(&mut output, byte);
        }
    }
    output
}

fn append_percent_encoded(output: &mut String, byte: u8) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    output.push('%');
    output.push(char::from(HEX[usize::from(byte >> 4)]));
    output.push(char::from(HEX[usize::from(byte & 0x0f)]));
}

fn body_sha256(body: &[u8]) -> String {
    hex::encode(Sha256::digest(body))
}

fn is_key_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn is_job_identifier(value: &str) -> bool {
    is_key_identifier(value)
}

fn is_event_type(value: &str) -> bool {
    is_key_identifier(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signing_key() -> SigningKey {
        SigningKey::from_bytes(&[7_u8; 32])
    }

    #[test]
    fn canonicalizes_path_query_like_the_relay() {
        assert_eq!(
            canonical_path_query("/v1/a b?z=two+words&a=x%20y&a=").expect("canonical path"),
            "/v1/a%20b?a=&a=x+y&z=two+words"
        );
    }

    #[test]
    fn rejects_non_private_relay_hosts() {
        assert_eq!(
            validate_relay_url("http://relay.example.com"),
            Err(RelayError::CleartextRejected)
        );
        assert_eq!(
            validate_relay_url("https://relay.example.com"),
            Err(RelayError::CleartextRejected)
        );
        assert!(validate_relay_url("http://100.64.1.2").is_ok());
        assert!(validate_relay_url("http://localhost:8317").is_ok());
        assert!(validate_relay_url("https://[fd7a:115c:a1e0::1]").is_ok());
    }

    #[test]
    fn response_verification_rejects_tampered_boundaries_and_replays() {
        let signing_key = signing_key();
        let peer_key_id = "relay-key";
        let request_nonce = "request-nonce";
        let body = b"{\"job\":{}}";
        let timestamp = chrono::Utc::now().timestamp();
        let context = SignatureContext::response(
            "GET",
            "/v1/jobs/job-1",
            body,
            timestamp,
            "response-nonce",
            StatusCode::OK,
            request_nonce,
        );
        let headers = sign_headers(&signing_key, peer_key_id, &context).expect("sign response");
        let mut response_headers = HeaderMap::new();
        for (name, value) in headers {
            response_headers.insert(name, value);
        }
        let cache = ResponseNonceCache::default();
        let response = ResponseVerification {
            method: "GET",
            path: "/v1/jobs/job-1",
            body,
            headers: &response_headers,
            status: StatusCode::OK,
            request_nonce,
        };
        assert_eq!(
            verify_response(&signing_key.verifying_key(), peer_key_id, &cache, &response,),
            Ok(())
        );
        let tampered_response = ResponseVerification {
            method: "POST",
            path: "/v1/jobs/job-1",
            body,
            headers: &response_headers,
            status: StatusCode::OK,
            request_nonce,
        };
        assert_eq!(
            verify_response(
                &signing_key.verifying_key(),
                peer_key_id,
                &cache,
                &tampered_response,
            ),
            Err(RelayError::ResponseSignatureInvalid)
        );
    }

    #[test]
    fn identity_is_stable_and_does_not_include_the_seed() {
        let identity = public_identity_for_key(&signing_key());
        assert!(identity.key_id.starts_with("sona-"));
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(identity.public_key)
                .expect("public key encoding")
                .len(),
            32
        );
    }
    #[test]
    fn disabled_panel_identity_never_touches_the_secret_backend() {
        let backend = Arc::new(crate::secrets::MemorySecretBackend::new());
        let secrets = crate::secrets::SecretManager::with_backend(backend.clone());
        assert_eq!(backend.operation_count(), 0);
        assert_eq!(
            tauri::async_runtime::block_on(public_identity(false, &secrets)),
            Err(RelayError::Disabled)
        );
        assert_eq!(backend.operation_count(), 0);

        let first = tauri::async_runtime::block_on(public_identity(true, &secrets))
            .expect("explicit identity");
        assert!(backend.has("agent_panel/signing-seed-v1"));
        let operations_after_create = backend.operation_count();
        let second = tauri::async_runtime::block_on(public_identity(true, &secrets))
            .expect("stable explicit identity");
        assert_eq!(first, second);
        assert_eq!(backend.operation_count(), operations_after_create + 1);
    }

    #[test]
    fn pairing_only_accepts_a_tailnet_relay_and_a_real_ed25519_key() {
        let public_key = base64::engine::general_purpose::STANDARD
            .encode(signing_key().verifying_key().to_bytes());
        let paired = validate_pairing("  http://100.99.192.40:8650  ", " relay-01 ", &public_key)
            .expect("a tailnet relay with a 32-byte key pairs");
        assert_eq!(paired.relay_url, "http://100.99.192.40:8650/");
        assert_eq!(paired.relay_key_id, "relay-01");
        assert_eq!(paired.relay_public_key, public_key);

        assert_eq!(
            validate_pairing("https://relay.example.com", "relay-01", &public_key),
            Err(RelayError::CleartextRejected)
        );
        assert_eq!(
            validate_pairing("http://100.99.192.40/v1", "relay-01", &public_key),
            Err(RelayError::InvalidConfiguration)
        );
        assert_eq!(
            validate_pairing("http://100.99.192.40", "relay 01", &public_key),
            Err(RelayError::InvalidConfiguration)
        );
        /* A 31-byte key is well-formed base64 and not a key. */
        let short = base64::engine::general_purpose::STANDARD.encode([7_u8; 31]);
        assert_eq!(
            validate_pairing("http://100.99.192.40", "relay-01", &short),
            Err(RelayError::InvalidConfiguration)
        );
    }

    #[test]
    fn a_job_from_the_other_workspace_is_not_this_turns_job() {
        let wire = || RelayJobWire {
            id: "job-1".to_string(),
            state: "SUCCEEDED".to_string(),
            kind: "sona-chat".to_string(),
            workspace_id: "sona-chat".to_string(),
            model_alias: SONA_MODEL_ALIAS.to_string(),
            capabilities: vec!["sona-chat".to_string()],
            tools: Vec::new(),
            submitter_key_id: "sona-me".to_string(),
            external_ref: "abcd".to_string(),
            result: Some(serde_json::json!({"kind":"text","message":"Found it."})),
        };
        let expectation = |workspace| RelayJobExpectation {
            workspace,
            job_id: Some("job-1"),
            idempotency_key: None,
        };
        let job = wire()
            .into_job("sona-me", expectation(AgentPanelWorkspaceV1::SonaChat))
            .expect("a chat job answers a chat turn");
        assert!(matches!(
            job.response,
            Some(super::SonaAgentResponseV1::Text { .. })
        ));
        assert_eq!(
            wire()
                .into_job("sona-me", expectation(AgentPanelWorkspaceV1::SonaConfig))
                .err(),
            Some(RelayError::ResponseMalformed)
        );
    }
}
