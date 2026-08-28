//! Deterministic text delivery.
//!
//! Target apps do not give Sona an insertion acknowledgement for keyboard or
//! clipboard requests. This module therefore treats delivery as a one-shot
//! operation: it may fall back only before a dispatch, never after an uncertain
//! dispatch. The result is a typed receipt that history can persist without
//! claiming more certainty than the platform provides.

use crate::clipboard::{self, ClipboardDispatch};
use crate::modes::DeliveryPlan;
use crate::settings::{ClipboardHandling, PasteMethod};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryMethod {
    #[default]
    None,
    AccessibilityInsertion,
    ClipboardPaste,
    DirectTyping,
    ExternalScript,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryOutcome {
    /// The operating system confirmed the Accessibility set operation.
    Delivered,
    /// The selected mechanism did not issue any insertion/paste event.
    #[default]
    DefinitelyNotDispatched,
    /// Input was sent or may have reached the target, but the target cannot
    /// confirm it. Never retry this outcome.
    DispatchedButUnconfirmed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Type)]
pub struct DeliveryReceipt {
    pub method: DeliveryMethod,
    pub outcome: DeliveryOutcome,
    pub dispatched_at_ms: u64,
}

impl DeliveryReceipt {
    pub fn not_dispatched() -> Self {
        Self::new(
            DeliveryMethod::None,
            DeliveryOutcome::DefinitelyNotDispatched,
        )
    }

    fn new(method: DeliveryMethod, outcome: DeliveryOutcome) -> Self {
        Self {
            method,
            outcome,
            dispatched_at_ms: now_ms(),
        }
    }
}

/// Dispatches text from one frozen mode. No setting is read from the store.
///
/// This function owns the two decisions every route shares: the exact text
/// that gets dispatched, and what still has to happen once a route dispatched
/// it. Routes below only move bytes.
pub fn deliver(app: &AppHandle, text: String, settings: &DeliveryPlan) -> DeliveryReceipt {
    let primary = primary_method(settings);
    let text = compose_final_text(text, settings);

    #[cfg(target_os = "macos")]
    if should_prefer_accessibility(settings) {
        match crate::context::macos::insert_into_focused_editable(&text) {
            crate::context::macos::AccessibilityInsertion::Delivered => {
                finish_after_dispatch(app, settings, &text);
                return DeliveryReceipt::new(
                    DeliveryMethod::AccessibilityInsertion,
                    DeliveryOutcome::Delivered,
                );
            }
            crate::context::macos::AccessibilityInsertion::DispatchedButUnconfirmed => {
                // Same certainty class as a clipboard chord that returned
                // without a local error: the request left Sona. The user's
                // configured finishing applies to both.
                finish_after_dispatch(app, settings, &text);
                return DeliveryReceipt::new(
                    DeliveryMethod::AccessibilityInsertion,
                    DeliveryOutcome::DispatchedButUnconfirmed,
                );
            }
            crate::context::macos::AccessibilityInsertion::NotDispatched => {
                // Only this branch may use a fallback. The AX request did not
                // commit a value, so no duplicate text can result.
            }
        }
    }

    match clipboard::paste_frozen(&text, app, settings) {
        ClipboardDispatch::DefinitelyNotDispatched(error) => {
            log::warn!("Text delivery was not dispatched: {error}");
            DeliveryReceipt::new(primary, DeliveryOutcome::DefinitelyNotDispatched)
        }
        ClipboardDispatch::Dispatched => {
            finish_after_dispatch(app, settings, &text);
            DeliveryReceipt::new(primary, DeliveryOutcome::DispatchedButUnconfirmed)
        }
        // A backend error leaves the insertion unproven, so no submit key and
        // no clipboard rewrite follow it; the reliable transaction already ran
        // its own finishing.
        ClipboardDispatch::DispatchedWithBackendError
        | ClipboardDispatch::DispatchedAndFinished => {
            DeliveryReceipt::new(primary, DeliveryOutcome::DispatchedButUnconfirmed)
        }
    }
}

/// The one place a trailing space is added, so every route dispatches the same
/// string and the receipt describes the same delivery.
fn compose_final_text(mut text: String, settings: &DeliveryPlan) -> String {
    if settings.append_trailing_space {
        text.push(' ');
    }
    text
}

fn primary_method(settings: &DeliveryPlan) -> DeliveryMethod {
    match settings.paste_method {
        PasteMethod::None => DeliveryMethod::None,
        PasteMethod::Direct => DeliveryMethod::DirectTyping,
        PasteMethod::ExternalScript => DeliveryMethod::ExternalScript,
        PasteMethod::CtrlV | PasteMethod::CtrlShiftV | PasteMethod::ShiftInsert => {
            DeliveryMethod::ClipboardPaste
        }
    }
}

/// Accessibility insertion is a better *implementation* of the clipboard-paste
/// intent: it writes at the caret, leaves the clipboard alone, and can confirm
/// the result. It is not a better implementation of the other methods —
/// `Direct` is chosen precisely for targets where paste and AX do not work
/// (terminals, VMs, remote desktops), and `ExternalScript` delegates insertion
/// entirely. Preferring AX for those would discard the user's explicit choice.
#[cfg(target_os = "macos")]
fn should_prefer_accessibility(settings: &DeliveryPlan) -> bool {
    is_clipboard_family(settings.paste_method)
}

fn is_clipboard_family(method: PasteMethod) -> bool {
    matches!(
        method,
        PasteMethod::CtrlV | PasteMethod::CtrlShiftV | PasteMethod::ShiftInsert
    )
}

/// What Sona still owes the user after a route dispatched text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Finishing {
    auto_submit: bool,
    copy_final_to_clipboard: bool,
}

/// Sona owes finishing exactly for the insertions it performs itself. `None`
/// dispatched nothing, and an external script owns everything after its own
/// insertion — pressing Enter or rewriting the clipboard behind it would fight
/// the script.
fn finishing_plan(settings: &DeliveryPlan) -> Finishing {
    let handy_inserted =
        is_clipboard_family(settings.paste_method) || settings.paste_method == PasteMethod::Direct;
    Finishing {
        auto_submit: handy_inserted && settings.auto_submit,
        copy_final_to_clipboard: handy_inserted
            && settings.clipboard_handling == ClipboardHandling::CopyToClipboard,
    }
}

/// Gives the target application time to process the insertion before the
/// submit key, so Enter cannot arrive ahead of the text.
const AUTO_SUBMIT_DELAY_MS: u64 = 50;

/// Runs the finishing steps for a dispatch that already happened. A failure
/// here is logged and never retried: the text is already on its way.
fn finish_after_dispatch(app: &AppHandle, settings: &DeliveryPlan, text: &str) {
    let finishing = finishing_plan(settings);

    if finishing.auto_submit {
        std::thread::sleep(std::time::Duration::from_millis(AUTO_SUBMIT_DELAY_MS));
        if let Err(error) = clipboard::send_auto_submit(app, settings.auto_submit_key) {
            log::warn!("Delivery dispatched, but auto-submit failed: {error}");
        }
    }
    if finishing.copy_final_to_clipboard {
        if let Err(error) = clipboard::write_text_to_clipboard(app, text) {
            log::warn!("Delivery dispatched, but copying final text failed: {error}");
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| u64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{AutoSubmitKey, TypingTool};

    const EVERY_METHOD: [PasteMethod; 6] = [
        PasteMethod::CtrlV,
        PasteMethod::CtrlShiftV,
        PasteMethod::ShiftInsert,
        PasteMethod::Direct,
        PasteMethod::ExternalScript,
        PasteMethod::None,
    ];

    fn plan(paste_method: PasteMethod) -> DeliveryPlan {
        DeliveryPlan {
            paste_method,
            clipboard_handling: ClipboardHandling::DontModify,
            auto_submit: false,
            auto_submit_key: AutoSubmitKey::Enter,
            append_trailing_space: false,
            paste_delay_ms: 0,
            paste_delay_after_ms: 0,
            reliable_paste: false,
            typing_tool: TypingTool::Auto,
            external_script_path: None,
        }
    }

    /// The H1 regression trap: Accessibility insertion replaces the clipboard
    /// chord only. `Direct` and `ExternalScript` are explicit mechanism
    /// choices and must reach their own backend.
    #[test]
    fn accessibility_replaces_only_the_clipboard_family() {
        assert!(is_clipboard_family(PasteMethod::CtrlV));
        assert!(is_clipboard_family(PasteMethod::CtrlShiftV));
        assert!(is_clipboard_family(PasteMethod::ShiftInsert));
        assert!(!is_clipboard_family(PasteMethod::Direct));
        assert!(!is_clipboard_family(PasteMethod::ExternalScript));
        assert!(!is_clipboard_family(PasteMethod::None));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn accessibility_preference_follows_the_clipboard_family() {
        for method in EVERY_METHOD {
            assert_eq!(
                should_prefer_accessibility(&plan(method)),
                is_clipboard_family(method),
                "accessibility preference for {method:?}"
            );
        }
    }

    #[test]
    fn trailing_space_is_appended_once_for_every_route() {
        for method in EVERY_METHOD {
            let mut settings = plan(method);
            settings.append_trailing_space = true;
            assert_eq!(
                compose_final_text("hello".to_string(), &settings),
                "hello ",
                "composed text for {method:?}"
            );

            settings.append_trailing_space = false;
            assert_eq!(
                compose_final_text("hello".to_string(), &settings),
                "hello",
                "composed text for {method:?}"
            );
        }
    }

    #[test]
    fn every_handy_insertion_finishes_the_configured_way() {
        for method in [
            PasteMethod::CtrlV,
            PasteMethod::CtrlShiftV,
            PasteMethod::ShiftInsert,
            PasteMethod::Direct,
        ] {
            let mut settings = plan(method);
            settings.auto_submit = true;
            settings.clipboard_handling = ClipboardHandling::CopyToClipboard;
            assert_eq!(
                finishing_plan(&settings),
                Finishing {
                    auto_submit: true,
                    copy_final_to_clipboard: true,
                },
                "finishing for {method:?}"
            );
        }
    }

    #[test]
    fn external_script_and_disabled_delivery_never_finish_in_handy() {
        for method in [PasteMethod::ExternalScript, PasteMethod::None] {
            let mut settings = plan(method);
            settings.auto_submit = true;
            settings.clipboard_handling = ClipboardHandling::CopyToClipboard;
            assert_eq!(
                finishing_plan(&settings),
                Finishing {
                    auto_submit: false,
                    copy_final_to_clipboard: false,
                },
                "finishing for {method:?}"
            );
        }
    }

    #[test]
    fn finishing_stays_off_when_the_user_disabled_it() {
        for method in EVERY_METHOD {
            assert_eq!(
                finishing_plan(&plan(method)),
                Finishing {
                    auto_submit: false,
                    copy_final_to_clipboard: false,
                },
                "finishing for {method:?}"
            );
        }
    }

    /// A receipt is persisted history. Any new field carrying transcript text
    /// would leak it into the delivery record, so the field set is pinned.
    #[test]
    fn receipt_serializes_exactly_the_content_free_field_set() {
        let receipt = DeliveryReceipt::new(
            DeliveryMethod::ClipboardPaste,
            DeliveryOutcome::DispatchedButUnconfirmed,
        );
        let serialized = serde_json::to_value(&receipt).expect("receipt serializes");
        let mut fields = serialized
            .as_object()
            .expect("receipt is a JSON object")
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        fields.sort();

        assert_eq!(fields, ["dispatched_at_ms", "method", "outcome"]);
    }
}
