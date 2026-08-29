//! The application dimension of the decision table.
//!
//! Deliberately a **pull query**, not a watcher. The brief sketches an
//! `NSWorkspace` notification observer with a KVO fallback, because
//! `didLaunchApplicationNotification` is not posted for background and
//! `LSUIElement` processes. But every decision-table row that reads the app
//! dimension is triggered by something else — a microphone transition or a
//! calendar instant — and case 4 (app open, microphone idle) is a suppression,
//! so no row is driven by an app edge alone. Asking `runningApplications` at
//! decision time is strictly stronger than either observer: it sees background
//! and agent processes that the launch notification drops, and it keeps no
//! duplicated "is Zoom running" state to fall out of sync.
//!
//! The activation-edge stream the brief describes already exists in
//! `meeting_macos::MacosMeetingSuggestionObserver`, which feeds
//! `MeetingSuggestionService`. This module consumes that service's live offers
//! for the browser evidence in case 7 rather than building a second window-title
//! reader.

use super::machine::{AppSignal, BrowserTitleEvidence};
use crate::meeting::suggestions::{MeetingProvider, MeetingSuggestion};

/// The brief's §5.2 table. Community-sourced, so it seeds a settings-editable
/// list rather than being the final word — Microsoft has already renamed Teams's
/// bundle ID once, and the operator can add whatever their organization uses.
pub const DEFAULT_MEETING_APP_BUNDLE_IDS: &[&str] = &[
    // Zoom.
    "us.zoom.xos",
    // Microsoft Teams, current "work or school" build.
    "com.microsoft.teams2",
    // Microsoft Teams, classic installs.
    "com.microsoft.teams",
    // Slack, which is also where huddles live: a huddle is a mode inside the
    // app, not a separate process.
    "com.tinyspeck.slackmacgap",
    // Cisco Webex. Other Webex components ship under separate IDs.
    "com.webex.meetingmanager",
];

/// Browsers whose frontmost tab may be a meeting. Google Meet has no native
/// macOS app at all, so the browser path is the only way to see it.
const BROWSER_BUNDLE_IDS: &[&str] = &[
    "com.apple.safari",
    "com.google.chrome",
    "com.google.chrome.canary",
    "com.microsoft.edgemac",
    "org.mozilla.firefox",
    "company.thebrowser.browser",
];

/// One running application, reduced to what the decision table and prompt copy
/// need. No window titles, URLs, or process arguments cross this boundary.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RunningApp {
    pub bundle_id: String,
    pub display_name: String,
    pub frontmost: bool,
}

/// The platform's answer to "what is running right now". Behind a trait so the
/// composition below is testable without a window server.
pub trait RunningAppsSource: Send + Sync {
    /// Every running application, with `frontmost` set on the one receiving key
    /// events. Bundle IDs are lowercased.
    fn running_apps(&self) -> Vec<RunningApp>;
}

/// Reports nothing running. Used on non-macOS targets, where detection has no
/// application dimension.
pub struct NoRunningApps;

impl RunningAppsSource for NoRunningApps {
    fn running_apps(&self) -> Vec<RunningApp> {
        Vec::new()
    }
}

pub fn default_meeting_app_bundle_ids() -> Vec<String> {
    DEFAULT_MEETING_APP_BUNDLE_IDS
        .iter()
        .map(|bundle_id| (*bundle_id).to_string())
        .collect()
}

/// Normalizes an operator-edited allowlist: lowercased, trimmed, deduplicated,
/// and with empties dropped. A settings-editable list is the one place a typo can
/// silently disable detection for an app, so it is cleaned on the way in.
pub fn normalize_allowlist(entries: &[String]) -> Vec<String> {
    let mut normalized = Vec::with_capacity(entries.len());
    for entry in entries {
        let bundle_id = entry.trim().to_ascii_lowercase();
        if bundle_id.is_empty() || normalized.contains(&bundle_id) {
            continue;
        }
        normalized.push(bundle_id);
    }
    normalized
}

/// The runtime validation the brief asks for: an allowlist entry only becomes a
/// signal when a process with that bundle ID is actually running. A stale or
/// renamed ID contributes nothing instead of poisoning the decision.
pub fn app_signal(running: &[RunningApp], allowlist: &[String]) -> AppSignal {
    let matches_allowlist = |app: &RunningApp| {
        allowlist
            .iter()
            .any(|bundle_id| bundle_id == &app.bundle_id)
    };

    // Frontmost wins so the prompt names the app the operator is looking at.
    let known = running
        .iter()
        .filter(|app| matches_allowlist(app))
        .max_by_key(|app| app.frontmost);
    if let Some(app) = known {
        return AppSignal::Known {
            bundle_id: app.bundle_id.clone(),
            display_name: app.display_name.clone(),
            frontmost: app.frontmost,
        };
    }

    // A browser only counts when it is frontmost: a background browser window is
    // not evidence that the operator is in a call.
    let browser = running
        .iter()
        .find(|app| app.frontmost && is_browser_bundle_id(&app.bundle_id));
    if let Some(app) = browser {
        return AppSignal::Browser {
            bundle_id: app.bundle_id.clone(),
            display_name: app.display_name.clone(),
        };
    }

    AppSignal::Absent
}

pub fn is_browser_bundle_id(bundle_id: &str) -> bool {
    BROWSER_BUNDLE_IDS
        .iter()
        .any(|candidate| bundle_id.eq_ignore_ascii_case(candidate))
}

pub fn is_app_running(running: &[RunningApp], bundle_id: &str) -> bool {
    running
        .iter()
        .any(|app| app.bundle_id.eq_ignore_ascii_case(bundle_id))
}

/// Browser-tab evidence for §5.3 case 7, read off the live suggestion offers the
/// existing activation observer already produces.
///
/// `MeetingSuggestion::evidence_flags` carries exactly what is needed:
/// `ax_title` / `ax_host` mean the observer read a window title or URL host and
/// matched it against a meeting host, and `ax_unavailable` means Accessibility is
/// not trusted, so no title was readable at all. Reusing this keeps one owner for
/// "what is in that browser tab" instead of adding a second reader.
pub fn browser_title_evidence(
    suggestions: &[MeetingSuggestion],
    browser_bundle_id: &str,
) -> BrowserTitleEvidence {
    let offer = suggestions
        .iter()
        .find(|offer| offer.app_bundle_id.eq_ignore_ascii_case(browser_bundle_id));
    let Some(offer) = offer else {
        return BrowserTitleEvidence::NoMatch;
    };
    if offer.evidence_flags.ax_unavailable {
        return BrowserTitleEvidence::Unreadable;
    }
    let matched_a_meeting = offer.evidence_flags.ax_title || offer.evidence_flags.ax_host;
    let meeting_provider = matches!(
        offer.provider,
        MeetingProvider::GoogleMeet
            | MeetingProvider::Zoom
            | MeetingProvider::MicrosoftTeams
            | MeetingProvider::Webex
            | MeetingProvider::SlackHuddle
    );
    if matched_a_meeting && meeting_provider {
        return BrowserTitleEvidence::MeetingMatch;
    }
    BrowserTitleEvidence::NoMatch
}

/// `NSWorkspace`-backed implementation. `runningApplications` needs no
/// entitlement and no TCC grant; it is always-available data.
#[cfg(target_os = "macos")]
pub struct WorkspaceApps;

#[cfg(target_os = "macos")]
impl RunningAppsSource for WorkspaceApps {
    fn running_apps(&self) -> Vec<RunningApp> {
        use objc2_app_kit::NSWorkspace;

        // An autorelease pool per call: without one, every NSString and
        // NSRunningApplication read here would be held for the polling thread's
        // whole life.
        objc2::rc::autoreleasepool(|_| {
            let workspace = NSWorkspace::sharedWorkspace();
            let frontmost_pid = workspace
                .frontmostApplication()
                .map(|application| application.processIdentifier());
            workspace
                .runningApplications()
                .iter()
                .filter_map(|application| {
                    let bundle_id = application.bundleIdentifier()?.to_string().to_lowercase();
                    if bundle_id.is_empty() {
                        return None;
                    }
                    let display_name = application
                        .localizedName()
                        .map(|name| name.to_string())
                        .unwrap_or_else(|| bundle_id.clone());
                    Some(RunningApp {
                        frontmost: frontmost_pid
                            .is_some_and(|pid| pid == application.processIdentifier()),
                        bundle_id,
                        display_name,
                    })
                })
                .collect()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meeting::suggestions::MeetingEvidenceFlags;
    use crate::meeting::types::MeetingSuggestionId;

    fn app(bundle_id: &str, display_name: &str, frontmost: bool) -> RunningApp {
        RunningApp {
            bundle_id: bundle_id.to_string(),
            display_name: display_name.to_string(),
            frontmost,
        }
    }

    fn offer(
        bundle_id: &str,
        provider: MeetingProvider,
        evidence_flags: MeetingEvidenceFlags,
    ) -> MeetingSuggestion {
        MeetingSuggestion {
            offer_id: MeetingSuggestionId::new(),
            provider,
            app_bundle_id: bundle_id.to_string(),
            evidence_flags,
            observed_at_ns: 1,
            expires_at_ns: 2,
        }
    }

    #[test]
    fn the_default_allowlist_is_the_briefs_bundle_id_table() {
        let defaults = default_meeting_app_bundle_ids();

        for expected in [
            "us.zoom.xos",
            "com.microsoft.teams2",
            "com.microsoft.teams",
            "com.tinyspeck.slackmacgap",
            "com.webex.meetingmanager",
        ] {
            assert!(
                defaults.iter().any(|bundle_id| bundle_id == expected),
                "{expected} must seed the allowlist"
            );
        }
    }

    #[test]
    fn an_allowlist_entry_only_counts_when_the_app_is_actually_running() {
        let allowlist = default_meeting_app_bundle_ids();

        assert_eq!(app_signal(&[], &allowlist), AppSignal::Absent);
        assert_eq!(
            app_signal(&[app("us.zoom.xos", "Zoom", false)], &allowlist),
            AppSignal::Known {
                bundle_id: "us.zoom.xos".to_string(),
                display_name: "Zoom".to_string(),
                frontmost: false,
            }
        );
    }

    #[test]
    fn a_renamed_bundle_id_contributes_nothing_instead_of_matching_loosely() {
        let signal = app_signal(
            &[app("com.microsoft.teams3", "Microsoft Teams", true)],
            &default_meeting_app_bundle_ids(),
        );

        assert_eq!(signal, AppSignal::Absent);
    }

    #[test]
    fn the_frontmost_meeting_app_names_the_prompt() {
        let signal = app_signal(
            &[
                app("us.zoom.xos", "Zoom", false),
                app("com.tinyspeck.slackmacgap", "Slack", true),
            ],
            &default_meeting_app_bundle_ids(),
        );

        assert_eq!(
            signal,
            AppSignal::Known {
                bundle_id: "com.tinyspeck.slackmacgap".to_string(),
                display_name: "Slack".to_string(),
                frontmost: true,
            }
        );
    }

    #[test]
    fn a_native_meeting_app_outranks_a_frontmost_browser() {
        let signal = app_signal(
            &[
                app("com.google.chrome", "Chrome", true),
                app("us.zoom.xos", "Zoom", false),
            ],
            &default_meeting_app_bundle_ids(),
        );

        assert_eq!(
            signal,
            AppSignal::Known {
                bundle_id: "us.zoom.xos".to_string(),
                display_name: "Zoom".to_string(),
                frontmost: false,
            }
        );
    }

    #[test]
    fn a_background_browser_is_not_evidence() {
        let signal = app_signal(
            &[app("com.google.chrome", "Chrome", false)],
            &default_meeting_app_bundle_ids(),
        );

        assert_eq!(signal, AppSignal::Absent);
    }

    #[test]
    fn an_operator_added_bundle_id_becomes_a_signal() {
        let signal = app_signal(
            &[app("com.example.call", "Example Call", true)],
            &normalize_allowlist(&["  COM.Example.Call  ".to_string()]),
        );

        assert_eq!(
            signal,
            AppSignal::Known {
                bundle_id: "com.example.call".to_string(),
                display_name: "Example Call".to_string(),
                frontmost: true,
            }
        );
    }

    #[test]
    fn normalizing_an_allowlist_drops_blanks_and_duplicates() {
        let normalized = normalize_allowlist(&[
            "US.Zoom.XOS".to_string(),
            "   ".to_string(),
            "us.zoom.xos".to_string(),
            String::new(),
        ]);

        assert_eq!(normalized, vec!["us.zoom.xos".to_string()]);
    }

    #[test]
    fn browser_evidence_reads_the_existing_activation_offers() {
        let matched = offer(
            "com.google.chrome",
            MeetingProvider::GoogleMeet,
            MeetingEvidenceFlags::app_only().with_ax_host(),
        );
        assert_eq!(
            browser_title_evidence(&[matched], "com.google.chrome"),
            BrowserTitleEvidence::MeetingMatch
        );

        let untrusted = offer(
            "com.google.chrome",
            MeetingProvider::GoogleMeet,
            MeetingEvidenceFlags::app_only().with_ax_unavailable(),
        );
        assert_eq!(
            browser_title_evidence(&[untrusted], "com.google.chrome"),
            BrowserTitleEvidence::Unreadable
        );

        assert_eq!(
            browser_title_evidence(&[], "com.google.chrome"),
            BrowserTitleEvidence::NoMatch
        );
    }

    #[test]
    fn an_app_only_browser_offer_is_not_a_meeting_match() {
        let app_only = offer(
            "com.google.chrome",
            MeetingProvider::ConfiguredApp,
            MeetingEvidenceFlags::app_only(),
        );

        assert_eq!(
            browser_title_evidence(&[app_only], "com.google.chrome"),
            BrowserTitleEvidence::NoMatch
        );
    }
}
