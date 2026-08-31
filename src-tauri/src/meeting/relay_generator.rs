//! D14: the meeting-intelligence engine that runs on the operator's own
//! server.
//!
//! One more [`MeetingTextGenerator`], with the agent panel's relay as its
//! transport: the same Ed25519-signed requests, the same tailnet-or-loopback
//! allowlist, the same submit-and-poll job shape, the same pinned relay key.
//! Nothing about the wire lives here — [`crate::agent_panel::run_chat_turn`]
//! owns that, and this module owns only the shape of the question and what its
//! two failures mean to a meeting.
//!
//! Selection lives in `processing::choose_text_engine`, not here. This engine
//! reports whether it *could* run; whether it *should* is the operator's
//! setting, their pairing, and the series' own answer, and one place decides
//! all three.

use super::processing::{MeetingTextGenerationError, MeetingTextGenerator};
use crate::agent_panel::{self, ChatTurnError};
use std::sync::mpsc;
use std::time::Duration;
use tauri::AppHandle;

/// What an artifact records as the engine that wrote it. Stable, and hashed
/// into every generation key, so it may not change without retiring every
/// generation this engine has produced.
const RELAY_MODEL_ID: &str = "sona-relay";

/// The engine's own version, as far as an artifact is concerned.
///
/// A generation key has to be known *before* the call that produces the text,
/// so this cannot be read out of a response. The relay's job envelope carries
/// no brain version either — its only model identity is the pinned `ultra`
/// alias, which is a routing constant rather than a version. So `v1` is this
/// client's turn shape: it bumps when the question this engine asks changes,
/// which is exactly when a cached generation should be retired.
const RELAY_MODEL_VERSION: &str = "v1";

/// The largest serialized model input this engine may send, in bytes.
///
/// Two ceilings sit behind this number, both enforced independently by the
/// relay and both fail-closed: 128 KiB for the context pack on its own, and
/// 184 KiB for the whole canonical submission — pack, prompt, and identifiers
/// together, measured as JSON, where every quote and newline in a transcript
/// costs its escape. 124 KiB of pack leaves the rest of the submission room to
/// exist inside the smaller of the two, the same 4 KiB of headroom this budget
/// has always kept for the prompt scaffolding that travels beside the pack.
///
/// An hour of meeting is what this has to hold; the pack ceiling was raised to
/// 128 KiB precisely so that it does.
///
/// A meeting whose evidence is larger than this is cut to fit rather than
/// refused; see `processing::fit_model_input` for which end is cut and why.
const RELAY_MAX_INPUT_BYTES: usize = 124 * 1024;

/// How long one remote turn may take before it is cancelled on the relay.
///
/// A model writing notes for an hour-long meeting is not fast, and the operator
/// is not watching this happen: the stop path runs on its own job thread and
/// review is where the answer appears. Ninety seconds is generous for the work
/// and short enough that a relay which has quietly stopped answering becomes a
/// stated failure inside one meeting rather than a wait with no end.
const RELAY_TURN_DEADLINE: Duration = Duration::from_secs(90);

/// How long the calling thread waits for the turn it handed to the runtime.
///
/// Longer than the turn's own deadline, so the turn reports its own outcome —
/// including its own cancellation — instead of being abandoned by a caller that
/// gave up first. Reaching this timeout means the runtime never ran the turn at
/// all, which is an unreachable engine, not a failed answer.
const RELAY_JOIN_TIMEOUT: Duration = Duration::from_secs(105);

/// The one instruction this engine adds to a caller's prompt.
///
/// Every caller already asks for strict JSON, because the on-device engine is a
/// structured-output model that answers in it. The engine on the far side of
/// the relay is a chat model, and a chat model's habit is to introduce its JSON
/// and wrap it in a fence. Saying so is cheaper than teaching every parser in
/// this file to tolerate prose, and it keeps the tolerance out of the code: an
/// answer that arrives fenced is a failed answer, and stays one.
const RELAY_OUTPUT_RULE: &str =
    "\n\nReply with the JSON object only. No prose before or after it, and no code fence.";

pub(crate) struct RelayTextGenerator {
    /// `None` in a build with no Tauri app — a unit test, or the CLI. Without
    /// one there are no settings to read and no runtime to run a turn on, which
    /// is the same thing as having no relay.
    app: Option<AppHandle>,
}

impl RelayTextGenerator {
    pub(crate) fn new(app: Option<AppHandle>) -> Self {
        Self { app }
    }
}

impl MeetingTextGenerator for RelayTextGenerator {
    fn is_available(&self) -> bool {
        self.app
            .as_ref()
            .is_some_and(agent_panel::relay_is_reachable)
    }

    fn model_id(&self) -> &'static str {
        RELAY_MODEL_ID
    }

    fn model_version(&self) -> &'static str {
        RELAY_MODEL_VERSION
    }

    fn max_input_bytes(&self) -> usize {
        RELAY_MAX_INPUT_BYTES
    }

    /// One turn, submitted and waited for.
    ///
    /// The trait is synchronous and its callers are the meeting job thread and
    /// two Tauri commands, so this cannot be a `block_on`: a command already
    /// runs on the async runtime, and entering the runtime from inside it
    /// deadlocks the one path the operator explicitly asked for. The turn is
    /// handed to the runtime and this thread waits on a channel instead, which
    /// is correct from a job thread and from a runtime worker alike.
    ///
    /// `max_tokens` is dropped deliberately: the relay's turn carries no output
    /// budget, and the workspace's own response ceiling is what bounds the
    /// answer. Every caller validates the text it gets back, so an answer that
    /// runs long fails the same way an answer that runs wrong does.
    fn generate(
        &self,
        system_prompt: &str,
        evidence: &str,
        max_tokens: i32,
    ) -> Result<String, MeetingTextGenerationError> {
        let _ = max_tokens;
        let app = self
            .app
            .clone()
            .ok_or(MeetingTextGenerationError::Unreachable)?;
        let prompt = format!("{system_prompt}{RELAY_OUTPUT_RULE}");
        let pack = evidence.to_string();
        let (sender, receiver) = mpsc::channel();
        tauri::async_runtime::spawn(async move {
            let answer =
                agent_panel::run_chat_turn(&app, &prompt, Some(pack), RELAY_TURN_DEADLINE).await;
            /* The receiver is gone only if this thread stopped waiting, which
             * it does only after the join timeout. Nothing to report to. */
            let _ = sender.send(answer);
        });
        match receiver.recv_timeout(RELAY_JOIN_TIMEOUT) {
            Ok(answer) => answer.map_err(generation_error),
            Err(mpsc::RecvTimeoutError::Timeout | mpsc::RecvTimeoutError::Disconnected) => {
                Err(MeetingTextGenerationError::Unreachable)
            }
        }
    }
}

/// A relay turn's two failures, in the meeting layer's own words.
///
/// One-to-one on purpose: the panel already reduced twelve transport errors to
/// the only distinction a meeting can act on, and re-deciding it here would
/// give the same fact two owners.
const fn generation_error(error: ChatTurnError) -> MeetingTextGenerationError {
    match error {
        ChatTurnError::Unreachable => MeetingTextGenerationError::Unreachable,
        ChatTurnError::Failed => MeetingTextGenerationError::Failed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_panel::protocol::{
        MAX_CHAT_SUBMISSION_BYTES, MAX_CONTEXT_PACK_BYTES, MAX_USER_MESSAGE_BYTES,
    };

    /// A build with no app handle has no settings and no runtime, so the engine
    /// must report itself unavailable rather than be selected and then fail —
    /// selection is what keeps a meeting from attempting a remote generation it
    /// was never going to complete.
    #[test]
    fn an_engine_with_no_app_is_never_selectable() {
        let generator = RelayTextGenerator::new(None);

        assert!(!generator.is_available());
        assert_eq!(
            generator.generate("prompt", "{}", 100),
            Err(MeetingTextGenerationError::Unreachable)
        );
    }

    /// The identity hashed into every generation key. Changing either string
    /// retires every artifact this engine has written, so both are pinned here
    /// rather than left to a rename.
    #[test]
    fn the_engine_names_itself_the_same_way_every_artifact_records() {
        let generator = RelayTextGenerator::new(None);

        assert_eq!(generator.model_id(), "sona-relay");
        assert_eq!(generator.model_version(), "v1");
    }

    /// The pack budget has to sit inside the ceiling the wire enforces, with
    /// room for the prompt and the identifiers that travel beside it. A change
    /// to either number that closes that gap is a pack the relay refuses.
    #[test]
    fn the_input_budget_fits_inside_the_wires_own_ceiling() {
        let generator = RelayTextGenerator::new(None);

        assert!(generator.max_input_bytes() < MAX_CONTEXT_PACK_BYTES);
        assert!(
            generator.max_input_bytes() + MAX_USER_MESSAGE_BYTES < MAX_CHAT_SUBMISSION_BYTES,
            "pack plus prompt must fit the relay's whole-submission ceiling"
        );
    }

    /// A relay that was never reached and an answer that came back wrong are
    /// different facts for a reader, and this is the only place the meeting
    /// layer learns which it has.
    #[test]
    fn transport_failures_keep_their_meaning_across_the_boundary() {
        assert_eq!(
            generation_error(ChatTurnError::Unreachable),
            MeetingTextGenerationError::Unreachable
        );
        assert_eq!(
            generation_error(ChatTurnError::Failed),
            MeetingTextGenerationError::Failed
        );
    }

    /// The rule that keeps JSON tolerance out of every parser in the meeting
    /// pipeline: the instruction travels with the prompt, so a fenced answer
    /// stays a failure instead of quietly becoming acceptable.
    #[test]
    fn the_json_only_rule_is_appended_to_the_callers_prompt() {
        assert!(RELAY_OUTPUT_RULE.contains("JSON object only"));
        assert!(RELAY_OUTPUT_RULE.contains("no code fence"));
    }
}
