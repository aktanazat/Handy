use tauri::{AppHandle, Manager};

pub const CONSENT_PANEL_LABEL: &str = "meeting-consent";
const PANEL_WIDTH: f64 = 380.0;
const PANEL_MARGIN: f64 = 14.0;

/// The panel's card is inset from the window on every edge (`m-2` in
/// ConsentPanel.tsx, 7pt at the app's 14px root font), so the window is the
/// card plus that inset twice.
const CARD_INSET: f64 = 7.0;

// The heights below are the card's rendered content height at `PANEL_WIDTH`,
// measured in the shipped layout across all 24 locales and recorded at the
// tallest one: the window is chosen before any text is measured, and copy that
// does not fit is copy the reader loses. English renders 14pt shorter than the
// widest locales in the shapes without a paragraph and 31pt shorter in the ones
// with two, which shows as bottom inset rather than as the band this panel used
// to open between its checkbox and its buttons. Change the panel's copy or
// layout and these have to be measured again.

/// The prompt's title, assurance line and buttons. Nothing here is optional.
const PROMPT_CONTENT: f64 = 104.0;
/// The always-record checkbox row and the gap above it. Calendar prompts only.
const PROMPT_CHECKBOX_ROW: f64 = 28.0;
/// The one-time introduction paragraph: two lines in bg, de, ru and uk.
const PROMPT_INTRODUCTION: f64 = 38.0;
/// The recurring-meeting brief: one line in every locale.
const PROMPT_SERIES_BRIEF: f64 = 21.0;
/// The in-session pill: status row, meeting title, buttons. The title
/// truncates and the rest is short, so every locale renders the same height.
const RECORDING_CONTENT: f64 = 118.0;

/// Which rows the panel is about to render, and therefore how tall its window
/// has to be. One window hosts both states — the same arrangement
/// `overlay::show_overlay_state` uses — so each transition resizes it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConsentPanelLayout {
    /// The consent prompt. Each flag is one conditional row in
    /// ConsentPanel.tsx, and the presenter has to predict them because the
    /// window is sized before the webview draws.
    Prompt {
        always_record_checkbox: bool,
        introduction: bool,
        series_brief: bool,
    },
    /// The pill shown while this panel's meeting records.
    Recording,
}

impl ConsentPanelLayout {
    /// Logical window height that hugs this layout's content.
    pub fn height(self) -> f64 {
        let content = match self {
            Self::Prompt {
                always_record_checkbox,
                introduction,
                series_brief,
            } => {
                let mut content = PROMPT_CONTENT;
                if always_record_checkbox {
                    content += PROMPT_CHECKBOX_ROW;
                }
                if introduction {
                    content += PROMPT_INTRODUCTION;
                }
                if series_brief {
                    content += PROMPT_SERIES_BRIEF;
                }
                content
            }
            Self::Recording => RECORDING_CONTENT,
        };
        content + 2.0 * CARD_INSET
    }
}

#[cfg(target_os = "macos")]
use objc2_app_kit::NSWindowSharingType;
#[cfg(target_os = "macos")]
use tauri::WebviewUrl;
#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel, StyleMask};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(MeetingConsentPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })
}

#[cfg(target_os = "macos")]
pub fn create(app: &AppHandle) {
    let Some((x, y)) = position(app) else {
        log::warn!("Meeting consent panel could not determine the primary monitor");
        return;
    };
    match PanelBuilder::<_, MeetingConsentPanel>::new(app, CONSENT_PANEL_LABEL)
        .url(WebviewUrl::App("/consent".into()))
        .title("Meeting recording")
        .position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
        .level(PanelLevel::Status)
        .size(tauri::Size::Logical(tauri::LogicalSize {
            width: PANEL_WIDTH,
            // Only the backing size the panel is born with: every `show` sizes
            // the window for the state it is about to render.
            height: ConsentPanelLayout::Recording.height(),
        }))
        .has_shadow(true)
        .transparent(true)
        .no_activate(false)
        .corner_radius(12.0)
        .style_mask(StyleMask::empty().borderless())
        .with_window(|window| {
            window
                .decorations(false)
                .transparent(true)
                .focusable(true)
                .accept_first_mouse(true)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
        })
        .collection_behavior(
            CollectionBehavior::new()
                .can_join_all_spaces()
                .full_screen_auxiliary(),
        )
        .build()
    {
        Ok(panel) => {
            // SharingNone excludes meeting titles from screen capture and
            // prevents the panel leaking into the call being recorded.
            panel.as_panel().setSharingType(NSWindowSharingType::None);
            panel.hide();
        }
        Err(error) => log::error!("Meeting consent panel could not be created: {error}"),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn create(_app: &AppHandle) {}

/// Sizes the panel for `layout`, re-pins its top-right corner, and shows it.
///
/// The reposition is not redundant: a resize keeps the window's bottom-left
/// origin, so growing it without moving it would push the top edge up and
/// eventually off the menu bar. Setting the position again anchors the top
/// edge, and the panel grows downward.
pub fn show(app: &AppHandle, layout: ConsentPanelLayout) -> bool {
    let Some(window) = app.get_webview_window(CONSENT_PANEL_LABEL) else {
        return false;
    };
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: PANEL_WIDTH,
        height: layout.height(),
    }));
    #[cfg(target_os = "macos")]
    if let Some((x, y)) = position(app) {
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
    }
    window.show().is_ok()
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(CONSENT_PANEL_LABEL) {
        let _ = window.hide();
    }
}

#[cfg(target_os = "macos")]
fn position(app: &AppHandle) -> Option<(f64, f64)> {
    let monitor = app.primary_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let work_area = monitor.work_area();
    let left = f64::from(work_area.position.x) / scale;
    let top = f64::from(work_area.position.y) / scale;
    let width = f64::from(work_area.size.width) / scale;
    Some((
        left + width - PANEL_WIDTH - PANEL_MARGIN,
        top + PANEL_MARGIN,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every height a state can ask for, measured in the rendered panel at
    /// PANEL_WIDTH across all 24 locales and recorded at the tallest one. A
    /// change here means the panel's copy or layout changed and the window has
    /// to be measured again — the numbers cannot be re-derived from the code.
    #[test]
    fn every_panel_state_gets_the_height_its_content_was_measured_at() {
        let prompt = |always_record_checkbox, introduction, series_brief| {
            ConsentPanelLayout::Prompt {
                always_record_checkbox,
                introduction,
                series_brief,
            }
            .height()
        };

        assert_eq!(prompt(false, false, false), 118.0);
        assert_eq!(prompt(false, true, false), 156.0);
        assert_eq!(prompt(true, false, false), 146.0);
        assert_eq!(prompt(true, true, false), 184.0);
        assert_eq!(prompt(true, true, true), 205.0);
        assert_eq!(ConsentPanelLayout::Recording.height(), 132.0);
    }

    /// The panel used to be one 212pt window for every state, which is where
    /// the prompt's blank band and the pill's floating title came from.
    #[test]
    fn no_state_is_as_tall_as_the_one_size_that_replaced_it() {
        let states = [
            ConsentPanelLayout::Recording,
            ConsentPanelLayout::Prompt {
                always_record_checkbox: true,
                introduction: true,
                series_brief: true,
            },
        ];

        for state in states {
            assert!(
                state.height() < 212.0,
                "{state:?} still asks for the old fixed height"
            );
        }
    }
}
