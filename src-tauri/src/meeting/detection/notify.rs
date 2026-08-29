//! Prompt delivery through `UNUserNotificationCenter`.
//!
//! Native notifications over a custom always-on-top window, deliberately: they
//! respect Focus and Do Not Disturb, land in Notification Center when missed,
//! carry inline action buttons without stealing focus, and can be silenced at
//! the OS level. That last one is a feature — the reviewer complaint about
//! Granola's custom pop-up is precisely that it nagged when the user wanted
//! quiet, and an OS-level off switch is a defense against Sona doing the same.
//!
//! Two hard constraints shape the code:
//!
//! * `UNUserNotificationCenter::currentNotificationCenter` raises an
//!   Objective-C exception when the process is not a bundled application. That
//!   is every `cargo test` binary and every `cargo run` of a bare executable, so
//!   the bundle check below is load-bearing, not defensive padding.
//! * The delegate that receives action clicks must outlive every notification.
//!   It is created once and leaked into the center for the process lifetime;
//!   there is no correct point at which to drop it while notifications may still
//!   be in Notification Center history.

use std::sync::Arc;

use super::machine::PromptKind;

/// Action identifier for the affirmative button. Also the value reported back
/// through `PromptResponse`.
pub const ACTION_START: &str = "computer.sona.detection.start";
/// Action identifier for the dismissive button.
pub const ACTION_DISMISS: &str = "computer.sona.detection.dismiss";
/// The one category all detection prompts use, so the two buttons are
/// registered once rather than per notification.
pub const CATEGORY_DETECTION: &str = "computer.sona.detection.prompt";

/// The affirmative button's label, per §5.4.
pub const START_TITLE: &str = "Start Transcribing";
/// The dismissive button's label, per §5.4.
pub const DISMISS_TITLE: &str = "Dismiss";

/// What the operator did with a prompt.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PromptResponse {
    /// "Start Transcribing", or clicking the notification body.
    Start { prompt_id: String },
    /// "Dismiss".
    Dismiss { prompt_id: String },
}

/// Receives action clicks. Implemented by the detection runtime.
pub trait PromptResponder: Send + Sync {
    fn prompt_answered(&self, response: PromptResponse);
}

/// A responder the delegate reads through, bound once the runtime exists.
///
/// The notification delegate has to be registered before the runtime is built —
/// registering it later would drop clicks on notifications already on screen —
/// but the delegate's target is the runtime. This cell is the whole resolution:
/// one write, at a named point, and a click that arrives before the bind is
/// dropped rather than routed at a half-built object.
#[derive(Default)]
pub struct ResponderCell {
    inner: std::sync::OnceLock<Arc<dyn PromptResponder>>,
}

impl ResponderCell {
    /// Binds the real responder. Later calls are ignored: a second target for the
    /// same notifications would be an ambiguity, not a feature.
    pub fn bind(&self, responder: Arc<dyn PromptResponder>) {
        let _ = self.inner.set(responder);
    }
}

impl PromptResponder for ResponderCell {
    fn prompt_answered(&self, response: PromptResponse) {
        match self.inner.get() {
            Some(responder) => responder.prompt_answered(response),
            None => log::info!(
                "Meeting detection dropped a notification click that arrived before startup \
                 finished"
            ),
        }
    }
}

/// Whether the operator has allowed notifications.
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum NotificationAccess {
    NotDetermined,
    Authorized,
    Denied,
    /// No notification center reachable — an unbundled build, or a non-macOS
    /// target.
    Unavailable,
}

/// Prompt delivery, behind a trait so the runtime is exercisable without a
/// notification center.
pub trait PromptPresenter: Send + Sync {
    fn access(&self) -> NotificationAccess;

    /// Requests authorization if it has not been asked for yet.
    fn request_access(&self) -> NotificationAccess;

    /// Posts one prompt. `prompt_id` comes back verbatim in the response.
    fn present(&self, prompt_id: &str, prompt: &PromptKind) -> bool;
}

/// Used when no notification center is reachable. Detection still runs: the
/// in-app pre-meeting card and the meetings list remain, so the feature
/// degrades to visible-in-app rather than disappearing.
pub struct NoPrompts;

impl PromptPresenter for NoPrompts {
    fn access(&self) -> NotificationAccess {
        NotificationAccess::Unavailable
    }

    fn request_access(&self) -> NotificationAccess {
        NotificationAccess::Unavailable
    }

    fn present(&self, _prompt_id: &str, _prompt: &PromptKind) -> bool {
        false
    }
}

#[cfg(target_os = "macos")]
pub use macos::UserNotificationPrompts;

#[cfg(target_os = "macos")]
mod macos {
    use super::{
        NotificationAccess, PromptKind, PromptPresenter, PromptResponder, PromptResponse,
        ACTION_DISMISS, ACTION_START, CATEGORY_DETECTION, DISMISS_TITLE, START_TITLE,
    };
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, ProtocolObject};
    use objc2::{define_class, msg_send, AnyThread, DefinedClass};
    use objc2_foundation::{
        NSArray, NSBundle, NSError, NSObject, NSObjectProtocol, NSSet, NSString,
    };
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
        UNNotificationAction, UNNotificationActionOptions, UNNotificationCategory,
        UNNotificationCategoryOptions, UNNotificationRequest, UNNotificationResponse,
        UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };
    use std::sync::mpsc;
    use std::sync::{Arc, OnceLock};
    use std::time::Duration;

    const AUTHORIZATION_TIMEOUT: Duration = Duration::from_secs(120);

    /// True only for a real `.app` bundle. `currentNotificationCenter` throws
    /// otherwise, and an Objective-C exception crossing back into Rust is
    /// undefined behavior, so this gate must hold before any call below.
    fn is_bundled_application() -> bool {
        objc2::rc::autoreleasepool(|_| {
            let bundle = NSBundle::mainBundle();
            let has_identifier = bundle.bundleIdentifier().is_some();
            let is_app_bundle = bundle.bundlePath().to_string().ends_with(".app");
            has_identifier && is_app_bundle
        })
    }

    pub struct DelegateIvars {
        responder: Arc<dyn PromptResponder>,
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements, and the single ivar
        // is a reference-counted Rust value with no Objective-C lifecycle.
        #[unsafe(super(NSObject))]
        #[name = "SonaDetectionNotificationDelegate"]
        #[ivars = DelegateIvars]
        pub struct DetectionDelegate;

        impl DetectionDelegate {
            // UNUserNotificationCenterDelegate: the operator clicked an action or
            // the notification body.
            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive_response(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                completion: &block2::DynBlock<dyn Fn()>,
            ) {
                let action = response.actionIdentifier().to_string();
                let prompt_id = response.notification().request().identifier().to_string();
                // The default action is clicking the notification itself. Treating
                // it as "start" matches how the copy reads: the notification asks
                // whether to transcribe, so acting on it is an affirmative.
                let started = action == ACTION_START || action == DEFAULT_ACTION;
                let responder = Arc::clone(&self.ivars().responder);
                if started {
                    responder.prompt_answered(PromptResponse::Start { prompt_id });
                } else if action == ACTION_DISMISS || action == DISMISS_ACTION {
                    responder.prompt_answered(PromptResponse::Dismiss { prompt_id });
                }
                completion.call(());
            }

            // Without this, a notification posted while Sona is frontmost is
            // silently dropped by the system.
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &objc2_user_notifications::UNNotification,
                completion: &block2::DynBlock<dyn Fn(usize)>,
            ) {
                // UNNotificationPresentationOptionBanner | ...Sound is 1 << 4 | 1 << 1
                // in the modern SDK; the banner bit alone is what a prompt needs.
                completion.call((PRESENTATION_BANNER,));
            }
        }

        unsafe impl NSObjectProtocol for DetectionDelegate {}

        unsafe impl UNUserNotificationCenterDelegate for DetectionDelegate {}
    );

    /// `UNNotificationDefaultActionIdentifier` — clicking the notification body.
    const DEFAULT_ACTION: &str = "com.apple.UNNotificationDefaultActionIdentifier";
    /// `UNNotificationDismissActionIdentifier` — swiping the notification away.
    const DISMISS_ACTION: &str = "com.apple.UNNotificationDismissActionIdentifier";
    /// `UNNotificationPresentationOptionBanner`.
    const PRESENTATION_BANNER: usize = 1 << 4;

    impl DetectionDelegate {
        fn new(responder: Arc<dyn PromptResponder>) -> Retained<Self> {
            let this = Self::alloc().set_ivars(DelegateIvars { responder });
            // `this` is a freshly allocated DetectionDelegate with valid NSObject
            // ivars. SAFETY: Objective-C initialization retains that ownership.
            unsafe { msg_send![super(this), init] }
        }
    }

    /// Owns the notification center's delegate and category registration, and
    /// creates all three lazily.
    ///
    /// `start` runs inside Tauri's `setup`, before the window and its webview
    /// exist. Nothing in this type may touch UserNotifications there: that is
    /// main-thread framework work in the middle of app launch, and it is the
    /// only code in this slice whose execution differs between a `cargo` build
    /// and a bundled app — so it is also the only code no test has ever run.
    /// Deferring it means the earliest possible touch is the first detection
    /// tick, on the detection thread, well after the window is up.
    pub struct UserNotificationPrompts {
        responder: Arc<dyn PromptResponder>,
        center: OnceLock<CenterBinding>,
    }

    /// The center together with the delegate that must outlive every
    /// notification it delivers.
    struct CenterBinding {
        center: Retained<UNUserNotificationCenter>,
        /// Held for the process lifetime: the center keeps only a weak delegate
        /// reference, and a dropped delegate silently stops every action click.
        _delegate: Retained<DetectionDelegate>,
    }

    // SAFETY: `UNUserNotificationCenter` is documented as thread-safe, the
    // delegate is only read by the Objective-C runtime, and `OnceLock` gives the
    // one-time initialization its own synchronization.
    unsafe impl Send for UserNotificationPrompts {}
    unsafe impl Sync for UserNotificationPrompts {}

    impl UserNotificationPrompts {
        /// `None` when there is no notification center to talk to, which is the
        /// normal state for an unbundled build.
        ///
        /// The bundle check is the only work done here. It reads the main
        /// bundle's identifier and touches no notification API, so this is safe
        /// to call during `setup`.
        pub fn start(responder: Arc<dyn PromptResponder>) -> Option<Self> {
            if !is_bundled_application() {
                return None;
            }
            Some(Self {
                responder,
                center: OnceLock::new(),
            })
        }

        /// Creates the center, binds the delegate, and registers the two actions
        /// — once, on whichever call needs it first.
        ///
        /// The delegate is still bound before any notification this process
        /// posts, because posting goes through `present`, which comes through
        /// here first. What is no longer true is that it is bound before
        /// notifications from a *previous* run that are still in Notification
        /// Center: clicking one of those launches the app, and the click is
        /// delivered once a delegate exists. That is a one-tick window at worst
        /// and it is the trade for not touching AppKit during launch.
        fn center(&self) -> &UNUserNotificationCenter {
            &self
                .center
                .get_or_init(|| {
                    let center = UNUserNotificationCenter::currentNotificationCenter();
                    let delegate = DetectionDelegate::new(Arc::clone(&self.responder));
                    let protocol_delegate = ProtocolObject::from_ref(&*delegate);
                    center.setDelegate(Some(protocol_delegate));
                    register_category(&center);
                    CenterBinding {
                        center,
                        _delegate: delegate,
                    }
                })
                .center
        }
    }

    fn register_category(center: &UNUserNotificationCenter) {
        objc2::rc::autoreleasepool(|_| {
            // `Foreground` brings Sona forward on click, which is what the
            // affirmative action needs: the next step is a consent screen.
            let start = UNNotificationAction::actionWithIdentifier_title_options(
                &NSString::from_str(ACTION_START),
                &NSString::from_str(START_TITLE),
                UNNotificationActionOptions::Foreground,
            );
            let dismiss = UNNotificationAction::actionWithIdentifier_title_options(
                &NSString::from_str(ACTION_DISMISS),
                &NSString::from_str(DISMISS_TITLE),
                UNNotificationActionOptions::empty(),
            );
            let actions = NSArray::from_retained_slice(&[start, dismiss]);
            let intents: Retained<NSArray<NSString>> = NSArray::new();
            let category =
                UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
                    &NSString::from_str(CATEGORY_DETECTION),
                    &actions,
                    &intents,
                    UNNotificationCategoryOptions::empty(),
                );
            let categories = NSSet::from_retained_slice(&[category]);
            center.setNotificationCategories(&categories);
        });
    }

    impl PromptPresenter for UserNotificationPrompts {
        fn access(&self) -> NotificationAccess {
            let (sender, receiver) = mpsc::channel::<UNAuthorizationStatus>();
            let completion = RcBlock::new(
                move |settings: core::ptr::NonNull<
                    objc2_user_notifications::UNNotificationSettings,
                >| {
                    // SAFETY: the system hands a live settings object to this block.
                    let status = unsafe { settings.as_ref().authorizationStatus() };
                    let _ = sender.send(status);
                },
            );
            self.center()
                .getNotificationSettingsWithCompletionHandler(&completion);
            match receiver.recv_timeout(Duration::from_secs(5)) {
                Ok(UNAuthorizationStatus::NotDetermined) => NotificationAccess::NotDetermined,
                Ok(UNAuthorizationStatus::Denied) => NotificationAccess::Denied,
                Ok(_) => NotificationAccess::Authorized,
                Err(_) => NotificationAccess::Unavailable,
            }
        }

        fn request_access(&self) -> NotificationAccess {
            let (sender, receiver) = mpsc::channel::<bool>();
            let completion = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
                let _ = sender.send(granted.as_bool());
            });
            self.center()
                .requestAuthorizationWithOptions_completionHandler(
                    UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                    &completion,
                );
            match receiver.recv_timeout(AUTHORIZATION_TIMEOUT) {
                Ok(true) => NotificationAccess::Authorized,
                Ok(false) => NotificationAccess::Denied,
                Err(_) => NotificationAccess::NotDetermined,
            }
        }

        fn present(&self, prompt_id: &str, prompt: &PromptKind) -> bool {
            objc2::rc::autoreleasepool(|_| {
                let content = UNMutableNotificationContent::new();
                content.setTitle(&NSString::from_str(&prompt.notification_title()));
                content.setBody(&NSString::from_str(PROMPT_BODY));
                content.setCategoryIdentifier(&NSString::from_str(CATEGORY_DETECTION));
                // No trigger: deliver immediately. The ad-hoc path must fire on
                // the microphone transition itself, not on a schedule.
                let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
                    &NSString::from_str(prompt_id),
                    &content,
                    None,
                );
                // A delivery failure surfaces in the status event as a prompt with
                // `notified` false, not as a silent success, so no completion
                // handler is needed here.
                self.center()
                    .addNotificationRequest_withCompletionHandler(&request, None);
                true
            })
        }
    }

    /// One line, so the two buttons carry the decision.
    const PROMPT_BODY: &str = "Sona can take local notes for this call.";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_action_titles_match_the_prompt_spec() {
        assert_eq!(START_TITLE, "Start Transcribing");
        assert_eq!(DISMISS_TITLE, "Dismiss");
    }

    #[test]
    fn an_absent_presenter_reports_unavailable_and_posts_nothing() {
        assert_eq!(NoPrompts.access(), NotificationAccess::Unavailable);
        assert!(!NoPrompts.present("prompt-1", &PromptKind::UnknownMicSource));
    }
}
