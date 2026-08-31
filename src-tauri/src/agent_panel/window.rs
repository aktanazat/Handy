use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

pub(crate) const AGENT_PANEL_WINDOW_LABEL: &str = "agent-panel";
const MAIN_WINDOW_LABEL: &str = "main";
const PREFERRED_WIDTH_LOGICAL: f64 = 400.0;
const MINIMUM_WIDTH_LOGICAL: f64 = 340.0;
const COMPACT_MINIMUM_WIDTH_LOGICAL: f64 = 300.0;
const MAXIMUM_WIDTH_LOGICAL: f64 = 440.0;
const PANEL_TRANSITION_MS: u64 = 160;

const PANEL_INITIALIZATION_SCRIPT: &str = r#"
(() => {
  const root = document.documentElement;
  root.dataset.agentPanelPhase = "closed";
  const apply = () => {
    const style = document.createElement("style");
    style.textContent = `
      html[data-agent-panel-phase="opening"] body { opacity: 0; transform: translateX(-8px); }
      html[data-agent-panel-phase="open"] body { opacity: 1; transform: translateX(0); transition: opacity 160ms ease, transform 160ms ease; }
      html[data-agent-panel-phase="closing"] body { opacity: 0; transform: translateX(-8px); transition: opacity 160ms ease, transform 160ms ease; }
      @media (prefers-reduced-motion: reduce) {
        html[data-agent-panel-phase] body { transition: none; transform: none; }
      }
    `;
    document.head.appendChild(style);
  };
  if (document.head) apply(); else document.addEventListener("DOMContentLoaded", apply, { once: true });
})();
"#;

const PANEL_OPEN_SCRIPT: &str = r#"
(() => {
  const root = document.documentElement;
  root.dataset.agentPanelPhase = "opening";
  requestAnimationFrame(() => { root.dataset.agentPanelPhase = "open"; });
})();
"#;

const PANEL_CLOSE_SCRIPT: &str = r#"
document.documentElement.dataset.agentPanelPhase = "closing";
"#;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AgentPanelAttachmentV1 {
    Right,
    Left,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelGeometryV1 {
    pub x: i32,
    pub y: i32,
    pub outer_width: u32,
    pub outer_height: u32,
    pub attachment: AgentPanelAttachmentV1,
    pub compact: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct NativeWindowFrame {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) outer_width: u32,
    pub(crate) outer_height: u32,
    pub(crate) scale_factor: f64,
    pub(crate) work_x: i32,
    pub(crate) work_y: i32,
    pub(crate) work_width: u32,
    pub(crate) work_height: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PanelGeometry {
    x: i32,
    y: i32,
    outer_width: u32,
    outer_height: u32,
    attachment: AgentPanelAttachmentV1,
    compact: bool,
}

impl From<PanelGeometry> for AgentPanelGeometryV1 {
    fn from(geometry: PanelGeometry) -> Self {
        Self {
            x: geometry.x,
            y: geometry.y,
            outer_width: geometry.outer_width,
            outer_height: geometry.outer_height,
            attachment: geometry.attachment,
            compact: geometry.compact,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WindowError {
    MainUnavailable,
    NativeFailure,
}

trait GeometryHost {
    fn main_frame(&self) -> Result<NativeWindowFrame, WindowError>;
    fn set_panel_outer_frame(&self, geometry: &PanelGeometry) -> Result<(), WindowError>;
}

struct TauriGeometryHost {
    main: WebviewWindow,
    panel: WebviewWindow,
}

impl GeometryHost for TauriGeometryHost {
    fn main_frame(&self) -> Result<NativeWindowFrame, WindowError> {
        native_frame(&self.main)
    }

    fn set_panel_outer_frame(&self, geometry: &PanelGeometry) -> Result<(), WindowError> {
        let outer = self
            .panel
            .outer_size()
            .map_err(|_| WindowError::NativeFailure)?;
        let inner = self
            .panel
            .inner_size()
            .map_err(|_| WindowError::NativeFailure)?;
        let horizontal_chrome = outer.width.saturating_sub(inner.width);
        let vertical_chrome = outer.height.saturating_sub(inner.height);
        let target_inner = PhysicalSize::new(
            geometry.outer_width.saturating_sub(horizontal_chrome),
            geometry.outer_height.saturating_sub(vertical_chrome),
        );
        self.panel
            .set_size(Size::Physical(target_inner))
            .map_err(|_| WindowError::NativeFailure)?;
        self.panel
            .set_position(Position::Physical(PhysicalPosition::new(
                geometry.x, geometry.y,
            )))
            .map_err(|_| WindowError::NativeFailure)
    }
}

#[derive(Default)]
struct WindowLifecycle {
    desired_open: bool,
    geometry: Option<AgentPanelGeometryV1>,
    close_generation: u64,
}

/// Native companion lifecycle owner. It only derives a frame from the current
/// main outer bounds; it never changes the main window's position or size.
pub(crate) struct AgentPanelWindowController {
    app: AppHandle,
    lifecycle: Arc<Mutex<WindowLifecycle>>,
}

impl AgentPanelWindowController {
    pub(crate) fn new(app: &AppHandle) -> Self {
        Self {
            app: app.clone(),
            lifecycle: Arc::new(Mutex::new(WindowLifecycle::default())),
        }
    }

    pub(crate) fn open(&self) -> Result<AgentPanelGeometryV1, WindowError> {
        let main = self.main_window()?;
        if main_is_suppressed(&main)? {
            return Err(WindowError::MainUnavailable);
        }
        {
            let mut lifecycle = self.lock_lifecycle();
            lifecycle.desired_open = true;
            lifecycle.close_generation = lifecycle.close_generation.saturating_add(1);
        }
        let panel = match self.app.get_webview_window(AGENT_PANEL_WINDOW_LABEL) {
            Some(panel) => panel,
            None => self.create_panel(&main)?,
        };
        let geometry = self.sync_pair(&main, &panel)?;
        let _ = panel.eval(PANEL_OPEN_SCRIPT);
        panel.show().map_err(|_| WindowError::NativeFailure)?;
        panel.set_focus().map_err(|_| WindowError::NativeFailure)?;
        self.lock_lifecycle().geometry = Some(geometry.clone());
        Ok(geometry)
    }

    pub(crate) fn close(&self) {
        let generation = {
            let mut lifecycle = self.lock_lifecycle();
            lifecycle.desired_open = false;
            lifecycle.geometry = None;
            lifecycle.close_generation = lifecycle.close_generation.saturating_add(1);
            lifecycle.close_generation
        };
        let app = self.app.clone();
        let lifecycle = self.lifecycle.clone();
        if let Some(panel) = app.get_webview_window(AGENT_PANEL_WINDOW_LABEL) {
            let _ = panel.eval(PANEL_CLOSE_SCRIPT);
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(transition_duration(false)).await;
                let should_destroy = match lifecycle.lock() {
                    Ok(current) => !current.desired_open && current.close_generation == generation,
                    Err(poisoned) => {
                        let current = poisoned.into_inner();
                        !current.desired_open && current.close_generation == generation
                    }
                };
                if should_destroy {
                    if let Some(panel) = app.get_webview_window(AGENT_PANEL_WINDOW_LABEL) {
                        let _ = panel.destroy();
                    }
                    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                        let _ = main.set_focus();
                    }
                }
            });
        }
    }

    pub(crate) fn hide_for_main(&self) {
        if let Some(panel) = self.app.get_webview_window(AGENT_PANEL_WINDOW_LABEL) {
            let _ = panel.hide();
        }
    }

    pub(crate) fn restore_after_main_show(&self) -> Option<AgentPanelGeometryV1> {
        if !self.lock_lifecycle().desired_open {
            return None;
        }
        let main = self.main_window().ok()?;
        if main_is_suppressed(&main).ok()? {
            return None;
        }
        let panel = match self.app.get_webview_window(AGENT_PANEL_WINDOW_LABEL) {
            Some(panel) => panel,
            None => self.create_panel(&main).ok()?,
        };
        let geometry = self.sync_pair(&main, &panel).ok()?;
        let _ = panel.eval(PANEL_OPEN_SCRIPT);
        let _ = panel.show();
        self.lock_lifecycle().geometry = Some(geometry.clone());
        Some(geometry)
    }

    pub(crate) fn sync_from_main(&self) -> Option<AgentPanelGeometryV1> {
        if !self.lock_lifecycle().desired_open {
            return None;
        }
        let main = self.main_window().ok()?;
        if main_is_suppressed(&main).ok()? {
            self.hide_for_main();
            return None;
        }
        let panel = self.app.get_webview_window(AGENT_PANEL_WINDOW_LABEL)?;
        let geometry = self.sync_pair(&main, &panel).ok()?;
        self.lock_lifecycle().geometry = Some(geometry.clone());
        Some(geometry)
    }

    pub(crate) fn on_panel_destroyed(&self) {
        let mut lifecycle = self.lock_lifecycle();
        lifecycle.desired_open = false;
        lifecycle.geometry = None;
    }

    pub(crate) fn on_main_destroyed(&self) {
        self.lock_lifecycle().desired_open = false;
        self.lock_lifecycle().geometry = None;
        if let Some(panel) = self.app.get_webview_window(AGENT_PANEL_WINDOW_LABEL) {
            let _ = panel.destroy();
        }
    }

    pub(crate) fn is_desired_open(&self) -> bool {
        self.lock_lifecycle().desired_open
    }

    pub(crate) fn geometry(&self) -> Option<AgentPanelGeometryV1> {
        self.lock_lifecycle().geometry.clone()
    }

    fn main_window(&self) -> Result<WebviewWindow, WindowError> {
        self.app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or(WindowError::MainUnavailable)
    }

    fn create_panel(&self, main: &WebviewWindow) -> Result<WebviewWindow, WindowError> {
        let builder = WebviewWindowBuilder::new(
            &self.app,
            AGENT_PANEL_WINDOW_LABEL,
            WebviewUrl::App("/agent-panel".into()),
        )
        .title("Sona Agent")
        .decorations(false)
        .shadow(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focusable(true)
        .skip_taskbar(true)
        // The panel remains opaque. This is the least surprising behavior when
        // the OS requests reduced transparency and prevents a glass fallback.
        .transparent(false)
        .visible(false)
        .inner_size(PREFERRED_WIDTH_LOGICAL, 640.0)
        .initialization_script(PANEL_INITIALIZATION_SCRIPT)
        .parent(main)
        .map_err(|_| WindowError::NativeFailure)?;
        builder.build().map_err(|_| WindowError::NativeFailure)
    }

    fn sync_pair(
        &self,
        main: &WebviewWindow,
        panel: &WebviewWindow,
    ) -> Result<AgentPanelGeometryV1, WindowError> {
        let host = TauriGeometryHost {
            main: main.clone(),
            panel: panel.clone(),
        };
        let geometry = sync_geometry(&host)?;
        Ok(geometry.into())
    }

    fn lock_lifecycle(&self) -> std::sync::MutexGuard<'_, WindowLifecycle> {
        match self.lifecycle.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

fn native_frame(window: &WebviewWindow) -> Result<NativeWindowFrame, WindowError> {
    let position = window
        .outer_position()
        .map_err(|_| WindowError::NativeFailure)?;
    let size = window
        .outer_size()
        .map_err(|_| WindowError::NativeFailure)?;
    let monitor = window
        .current_monitor()
        .map_err(|_| WindowError::NativeFailure)?
        .ok_or(WindowError::MainUnavailable)?;
    let work_area = monitor.work_area();
    Ok(NativeWindowFrame {
        x: position.x,
        y: position.y,
        outer_width: size.width,
        outer_height: size.height,
        scale_factor: window
            .scale_factor()
            .map_err(|_| WindowError::NativeFailure)?,
        work_x: work_area.position.x,
        work_y: work_area.position.y,
        work_width: work_area.size.width,
        work_height: work_area.size.height,
    })
}

fn main_is_suppressed(window: &WebviewWindow) -> Result<bool, WindowError> {
    Ok(window
        .is_minimized()
        .map_err(|_| WindowError::NativeFailure)?
        || window
            .is_fullscreen()
            .map_err(|_| WindowError::NativeFailure)?
        || !window
            .is_visible()
            .map_err(|_| WindowError::NativeFailure)?)
}

fn sync_geometry(host: &impl GeometryHost) -> Result<PanelGeometry, WindowError> {
    let geometry = panel_geometry(&host.main_frame()?);
    host.set_panel_outer_frame(&geometry)?;
    Ok(geometry)
}

fn panel_geometry(main: &NativeWindowFrame) -> PanelGeometry {
    let preferred = logical_width(PREFERRED_WIDTH_LOGICAL, main.scale_factor);
    let minimum = logical_width(MINIMUM_WIDTH_LOGICAL, main.scale_factor);
    let compact_minimum = logical_width(COMPACT_MINIMUM_WIDTH_LOGICAL, main.scale_factor);
    let maximum = logical_width(MAXIMUM_WIDTH_LOGICAL, main.scale_factor);
    let main_right = i64::from(main.x) + i64::from(main.outer_width);
    let work_right = i64::from(main.work_x) + i64::from(main.work_width);
    let right_space = available_space(work_right, main_right);
    let left_space = available_space(i64::from(main.x), i64::from(main.work_x));

    if right_space >= minimum {
        return PanelGeometry {
            x: i32_from_i64(main_right),
            y: main.y,
            outer_width: right_space.min(preferred).clamp(minimum, maximum),
            outer_height: main.outer_height,
            attachment: AgentPanelAttachmentV1::Right,
            compact: false,
        };
    }
    if left_space >= minimum {
        let width = left_space.min(preferred).clamp(minimum, maximum);
        return PanelGeometry {
            x: main.x.saturating_sub(i32_from_u32(width)),
            y: main.y,
            outer_width: width,
            outer_height: main.outer_height,
            attachment: AgentPanelAttachmentV1::Left,
            compact: false,
        };
    }

    let attach_right = right_space >= left_space;
    let width = right_space
        .max(left_space)
        .min(maximum)
        .max(compact_minimum);
    PanelGeometry {
        x: if attach_right {
            i32_from_i64(main_right)
        } else {
            main.x.saturating_sub(i32_from_u32(width))
        },
        y: main.y,
        outer_width: width,
        outer_height: main.outer_height,
        attachment: if attach_right {
            AgentPanelAttachmentV1::Right
        } else {
            AgentPanelAttachmentV1::Left
        },
        compact: true,
    }
}

fn logical_width(width: f64, scale_factor: f64) -> u32 {
    LogicalSize::new(width, 1.0).to_physical(scale_factor).width
}

fn available_space(end: i64, start: i64) -> u32 {
    if end <= start {
        return 0;
    }
    u32::try_from(end - start).unwrap_or(u32::MAX)
}

fn i32_from_i64(value: i64) -> i32 {
    match i32::try_from(value) {
        Ok(value) => value,
        Err(_) if value.is_negative() => i32::MIN,
        Err(_) => i32::MAX,
    }
}

fn i32_from_u32(value: u32) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

fn transition_duration(reduced_motion: bool) -> Duration {
    if reduced_motion {
        Duration::ZERO
    } else {
        Duration::from_millis(PANEL_TRANSITION_MS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> NativeWindowFrame {
        NativeWindowFrame {
            x: 100,
            y: 80,
            outer_width: 900,
            outer_height: 800,
            scale_factor: 1.0,
            work_x: 0,
            work_y: 0,
            work_width: 1920,
            work_height: 1080,
        }
    }

    struct MacGeometryHarness {
        main: NativeWindowFrame,
        applied: Mutex<Option<PanelGeometry>>,
    }

    impl GeometryHost for MacGeometryHarness {
        fn main_frame(&self) -> Result<NativeWindowFrame, WindowError> {
            Ok(self.main)
        }

        fn set_panel_outer_frame(&self, geometry: &PanelGeometry) -> Result<(), WindowError> {
            match self.applied.lock() {
                Ok(mut slot) => *slot = Some(geometry.clone()),
                Err(poisoned) => *poisoned.into_inner() = Some(geometry.clone()),
            }
            Ok(())
        }
    }

    #[test]
    fn right_attachment_preserves_the_main_frame() {
        let main = frame();
        let geometry = panel_geometry(&main);
        assert_eq!(geometry.attachment, AgentPanelAttachmentV1::Right);
        assert_eq!(geometry.x, 1000);
        assert_eq!(geometry.y, main.y);
        assert_eq!(geometry.outer_height, main.outer_height);
        assert_eq!(main, frame());
    }

    #[test]
    fn left_attachment_preserves_the_main_frame() {
        let main = NativeWindowFrame {
            x: 420,
            work_width: 1200,
            ..frame()
        };
        let geometry = panel_geometry(&main);
        assert_eq!(geometry.attachment, AgentPanelAttachmentV1::Left);
        assert_eq!(geometry.y, main.y);
        assert_eq!(geometry.outer_height, main.outer_height);
        assert_eq!(main.x, 420);
        assert_eq!(main.outer_width, 900);
    }

    #[test]
    fn compact_mode_uses_the_larger_side_without_changing_main() {
        let main = NativeWindowFrame {
            x: 260,
            outer_width: 600,
            work_width: 960,
            ..frame()
        };
        let geometry = panel_geometry(&main);
        assert!(geometry.compact);
        assert!(geometry.outer_width >= logical_width(COMPACT_MINIMUM_WIDTH_LOGICAL, 1.0));
        assert_eq!(geometry.outer_height, main.outer_height);
        assert_eq!(main.outer_width, 600);
    }

    #[test]
    fn geometry_host_seam_applies_native_outer_frame() {
        let harness = MacGeometryHarness {
            main: frame(),
            applied: Mutex::new(None),
        };
        let geometry = sync_geometry(&harness).expect("geometry sync");
        let applied = match harness.applied.lock() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        };
        assert_eq!(applied, Some(geometry));
    }

    #[test]
    fn scale_factor_uses_logical_panel_width() {
        let main = NativeWindowFrame {
            scale_factor: 2.0,
            work_width: 3840,
            ..frame()
        };
        let geometry = panel_geometry(&main);
        assert_eq!(
            geometry.outer_width,
            logical_width(PREFERRED_WIDTH_LOGICAL, 2.0)
        );
    }

    #[test]
    fn reduced_motion_has_no_native_wait() {
        assert_eq!(transition_duration(true), Duration::ZERO);
        assert_eq!(
            transition_duration(false),
            Duration::from_millis(PANEL_TRANSITION_MS)
        );
    }
}
