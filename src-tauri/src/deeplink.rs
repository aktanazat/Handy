//! `sona://` URL routing.
//!
//! Parsing is kept separate from dispatch so the route table can be tested
//! without an `AppHandle`. Dispatch lives in `lib.rs`, next to the CLI and tray
//! handlers it shares plumbing with.

/// A resolved `sona://` route.
///
/// Every variant maps onto an action the app already exposes through the tray,
/// the CLI, or a command. A deep link is an alternative trigger, never a new
/// capability, so nothing here can do something a user cannot already do.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DeepLinkAction {
    /// `sona://record` — same toggle as `--toggle-transcription` and the tray.
    ToggleRecording,
    /// `sona://record?mode=<id>` — start a run under one specific mode without
    /// changing which mode is active afterwards.
    RecordWithMode(String),
    /// `sona://mode/<id>` — switch the active mode, recording nothing.
    SetActiveMode(String),
    /// `sona://meeting/start` — surface the meeting screen. Deliberately does
    /// not begin capture: meetings are prompt-only by product decision, and a
    /// URL is not consent to record a room.
    StartMeeting,
}

/// The one scheme this app answers to.
pub const DEEP_LINK_SCHEME: &str = "sona";

/// Parses a `sona://` URL into an action, or `None` when it is not a route this
/// app serves.
///
/// Unknown hosts, unknown paths, a missing mode id, and any other scheme all
/// return `None` rather than a best guess: silently reinterpreting a link the
/// user (or another app) got wrong is worse than ignoring it.
pub fn parse_deep_link(raw: &str) -> Option<DeepLinkAction> {
    let url = url::Url::parse(raw.trim()).ok()?;
    if !url.scheme().eq_ignore_ascii_case(DEEP_LINK_SCHEME) {
        return None;
    }

    // A non-special scheme keeps its authority verbatim, so the route keyword
    // is the host and everything after it is the path.
    let route = url.host_str()?;
    let segments: Vec<&str> = url
        .path()
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();

    if route.eq_ignore_ascii_case("record") && segments.is_empty() {
        // An absent `mode` means "use whatever is active". A present but blank
        // `mode` means the link was built wrong, which is not the same request,
        // so it is refused rather than quietly downgraded to a plain toggle.
        return match url.query_pairs().find(|(key, _)| key == "mode") {
            Some((_, value)) => non_empty(&value).map(DeepLinkAction::RecordWithMode),
            None => Some(DeepLinkAction::ToggleRecording),
        };
    }
    if route.eq_ignore_ascii_case("mode") {
        let [mode_id] = segments[..] else {
            return None;
        };
        return non_empty(mode_id).map(DeepLinkAction::SetActiveMode);
    }
    if route.eq_ignore_ascii_case("meeting") && segments == ["start"] {
        return Some(DeepLinkAction::StartMeeting);
    }
    None
}

fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_record_toggles() {
        assert_eq!(
            parse_deep_link("sona://record"),
            Some(DeepLinkAction::ToggleRecording)
        );
        assert_eq!(
            parse_deep_link("sona://record/"),
            Some(DeepLinkAction::ToggleRecording)
        );
    }

    #[test]
    fn record_carries_an_explicit_mode() {
        assert_eq!(
            parse_deep_link("sona://record?mode=mode_1712345678901"),
            Some(DeepLinkAction::RecordWithMode(
                "mode_1712345678901".to_string()
            ))
        );
    }

    #[test]
    fn mode_route_switches_the_active_mode() {
        assert_eq!(
            parse_deep_link("sona://mode/mode_42"),
            Some(DeepLinkAction::SetActiveMode("mode_42".to_string()))
        );
    }

    #[test]
    fn meeting_start_is_the_only_meeting_route() {
        assert_eq!(
            parse_deep_link("sona://meeting/start"),
            Some(DeepLinkAction::StartMeeting)
        );
        assert_eq!(parse_deep_link("sona://meeting"), None);
        assert_eq!(parse_deep_link("sona://meeting/stop"), None);
    }

    #[test]
    fn the_scheme_is_matched_case_insensitively() {
        assert_eq!(
            parse_deep_link("SONA://record"),
            Some(DeepLinkAction::ToggleRecording)
        );
    }

    #[test]
    fn other_schemes_are_not_ours() {
        assert_eq!(parse_deep_link("file:///tmp/audio.wav"), None);
        assert_eq!(parse_deep_link("https://sona.app/record"), None);
        assert_eq!(parse_deep_link("sonata://record"), None);
    }

    #[test]
    fn malformed_routes_are_ignored_rather_than_guessed() {
        assert_eq!(parse_deep_link("sona://record/extra"), None);
        assert_eq!(parse_deep_link("sona://mode"), None);
        assert_eq!(parse_deep_link("sona://mode/"), None);
        assert_eq!(parse_deep_link("sona://mode/a/b"), None);
        assert_eq!(parse_deep_link("sona://quit"), None);
        assert_eq!(parse_deep_link("not a url"), None);
        assert_eq!(parse_deep_link(""), None);
    }

    #[test]
    fn a_blank_mode_query_is_malformed_not_a_toggle() {
        assert_eq!(parse_deep_link("sona://record?mode="), None);
        assert_eq!(parse_deep_link("sona://record?mode=%20"), None);
    }

    #[test]
    fn unrelated_query_parameters_do_not_select_a_mode() {
        assert_eq!(
            parse_deep_link("sona://record?source=raycast"),
            Some(DeepLinkAction::ToggleRecording)
        );
    }

    #[test]
    fn surrounding_whitespace_is_tolerated() {
        assert_eq!(
            parse_deep_link("  sona://record\n"),
            Some(DeepLinkAction::ToggleRecording)
        );
    }
}
