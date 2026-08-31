use tauri::{AppHandle, Manager};

pub const CONSENT_PANEL_LABEL: &str = "meeting-consent";
const PANEL_WIDTH: f64 = 380.0;
const PANEL_HEIGHT: f64 = 212.0;
const PANEL_MARGIN: f64 = 14.0;

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
            height: PANEL_HEIGHT,
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

pub fn show(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window(CONSENT_PANEL_LABEL) else {
        return false;
    };
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
