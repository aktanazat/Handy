//! Portable mode support for Sona.
//! When a file named `portable` exists next to the executable, all user data
//! (settings, models, recordings, database, logs) is stored in a `Data/`
//! directory alongside the executable instead of the platform app-data root.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::Manager;

static PORTABLE_DATA_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

pub const PORTABLE_MAGIC: &str = "Sona Portable Mode";
const LEGACY_PORTABLE_MAGIC: &str = "Handy Portable Mode";

/// Detect portable mode by looking for a `portable` marker file next to the exe.
/// Must be called once at startup before Tauri initializes.
pub fn init() {
    PORTABLE_DATA_DIR.get_or_init(|| {
        let exe_path = std::env::current_exe().ok()?;
        let exe_dir = exe_path.parent()?;

        let marker_path = exe_dir.join("portable");
        let data_dir = exe_dir.join("Data");

        let marker = portable_marker(&marker_path);
        let legacy_empty_marker =
            marker.is_none() && marker_path.exists() && data_dir.exists();
        let is_portable = marker.is_some() || legacy_empty_marker;

        if is_portable
            && debug_portable_marker_requires_override(
                &exe_path,
                cfg!(debug_assertions),
                debug_portable_override_enabled(),
            )
        {
            eprintln!(
                "[portable] refusing Cargo debug portable marker at {}: it disables native secure storage. Remove or archive the marker before `tauri dev`, or set SONA_ALLOW_PORTABLE_DEV=1 for an intentional portable development run.",
                marker_path.display()
            );
            std::process::exit(78);
        }

        if is_portable {
            if marker == Some(LEGACY_PORTABLE_MAGIC) {
                eprintln!("[portable] upgrading legacy marker to Sona");
                let _ = std::fs::write(&marker_path, PORTABLE_MAGIC);
            } else if legacy_empty_marker {
                // An empty marker next to Data/ is the legacy Scoop layout. Keep
                // the install portable and make its intent explicit for Sona.
                eprintln!("[portable] upgrading legacy empty marker to Sona");
                let _ = std::fs::write(&marker_path, PORTABLE_MAGIC);
            }
            if !data_dir.exists() {
                std::fs::create_dir_all(&data_dir).ok()?;
            }
            let hf_home = hugging_face_home(&data_dir);
            std::env::set_var("HF_HOME", &hf_home);
            eprintln!("[portable] data dir: {}", data_dir.display());
            eprintln!("[portable] Hugging Face home: {}", hf_home.display());
            Some(data_dir)
        } else {
            None
        }
    });
}

/// Keep hf-hub downloads inside the portable data directory. hf-hub appends
/// its own `hub` component to `HF_HOME` for model snapshots and blobs.
fn hugging_face_home(data_dir: &Path) -> PathBuf {
    data_dir.join("huggingface")
}

/// Returns `true` if running in portable mode.
pub fn is_portable() -> bool {
    PORTABLE_DATA_DIR.get().and_then(|v| v.as_ref()).is_some()
}

/// Get the portable data dir (if active). Does not require an AppHandle.
/// Returns `None` when not in portable mode.
pub fn data_dir() -> Option<&'static PathBuf> {
    PORTABLE_DATA_DIR.get().and_then(|v| v.as_ref())
}

/// Portable-aware replacement for `app.path().app_data_dir()`.
pub fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, tauri::Error> {
    if let Some(dir) = data_dir() {
        Ok(dir.clone())
    } else {
        app.path().app_data_dir()
    }
}

/// Portable-aware replacement for `app.path().app_log_dir()`.
pub fn app_log_dir(app: &tauri::AppHandle) -> Result<PathBuf, tauri::Error> {
    if let Some(dir) = data_dir() {
        Ok(dir.join("logs"))
    } else {
        app.path().app_log_dir()
    }
}

/// Resolve a relative path against the app data directory (portable-aware).
/// Replaces `app.path().resolve(path, BaseDirectory::AppData)`.
pub fn resolve_app_data(app: &tauri::AppHandle, relative: &str) -> Result<PathBuf, tauri::Error> {
    Ok(app_data_dir(app)?.join(relative))
}

/// Get the path to use with `tauri-plugin-store`.
/// Returns an absolute path in portable mode (so the store plugin writes to
/// the portable Data dir) or the original relative path otherwise.
pub fn store_path(relative: &str) -> PathBuf {
    if let Some(dir) = data_dir() {
        dir.join(relative)
    } else {
        PathBuf::from(relative)
    }
}

/// Return a recognized marker after trimming only surrounding whitespace.
/// Legacy content remains accepted so an in-place portable upgrade retains
/// its data, but `init` immediately rewrites it to `PORTABLE_MAGIC`.
fn portable_marker(path: &Path) -> Option<&'static str> {
    match std::fs::read_to_string(path).ok()?.trim() {
        PORTABLE_MAGIC => Some(PORTABLE_MAGIC),
        LEGACY_PORTABLE_MAGIC => Some(LEGACY_PORTABLE_MAGIC),
        _ => None,
    }
}

fn debug_portable_override_enabled() -> bool {
    std::env::var("SONA_ALLOW_PORTABLE_DEV").as_deref() == Ok("1")
}

fn debug_portable_marker_requires_override(
    executable: &Path,
    debug_build: bool,
    explicit_override: bool,
) -> bool {
    if !debug_build || explicit_override {
        return false;
    }

    let Some(debug_directory) = executable.parent() else {
        return false;
    };
    let Some(target_directory) = debug_directory.parent() else {
        return false;
    };

    debug_directory
        .file_name()
        .is_some_and(|name| name == "debug")
        && target_directory
            .file_name()
            .is_some_and(|name| name == "target")
}

#[cfg(test)]
/// Check whether a marker uses either supported portable sentinel.
fn is_valid_portable_marker(path: &Path) -> bool {
    portable_marker(path).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temporary_directory(name: &str) -> std::path::PathBuf {
        let path =
            std::env::temp_dir().join(format!("sona-portable-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn new_magic_string_enables_portable() {
        let dir = temporary_directory("current");
        let marker = dir.join("portable");
        std::fs::write(&marker, PORTABLE_MAGIC).unwrap();
        assert!(is_valid_portable_marker(&marker));
        assert_eq!(portable_marker(&marker), Some(PORTABLE_MAGIC));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn legacy_magic_string_remains_accepted_for_in_place_upgrade() {
        let dir = temporary_directory("legacy");
        let marker = dir.join("portable");
        std::fs::write(&marker, LEGACY_PORTABLE_MAGIC).unwrap();
        assert!(is_valid_portable_marker(&marker));
        assert_eq!(portable_marker(&marker), Some(LEGACY_PORTABLE_MAGIC));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn empty_marker_requires_existing_data_directory() {
        let dir = temporary_directory("empty");
        let marker = dir.join("portable");
        std::fs::File::create(&marker).unwrap();
        assert!(!is_valid_portable_marker(&marker));
        std::fs::create_dir(dir.join("Data")).unwrap();
        assert!(marker.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn wrong_content_does_not_enable_portable() {
        let dir = temporary_directory("wrong");
        let marker = dir.join("portable");
        std::fs::write(&marker, "some other content").unwrap();
        assert!(!is_valid_portable_marker(&marker));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn whitespace_is_accepted_only_around_a_known_magic_string() {
        let dir = temporary_directory("whitespace");
        let marker = dir.join("portable");
        let mut file = std::fs::File::create(&marker).unwrap();
        writeln!(file, "  {PORTABLE_MAGIC}").unwrap();
        assert!(is_valid_portable_marker(&marker));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn hugging_face_home_is_inside_portable_data() {
        let data_dir = Path::new("portable-root").join("Data");
        assert_eq!(hugging_face_home(&data_dir), data_dir.join("huggingface"));
    }

    #[test]
    fn cargo_debug_portable_marker_requires_explicit_override() {
        let executable = Path::new("/workspace/src-tauri/target/debug/sona");

        assert!(debug_portable_marker_requires_override(
            executable, true, false
        ));
    }

    #[test]
    fn explicit_override_keeps_intentional_debug_portable_mode_available() {
        let executable = Path::new("/workspace/src-tauri/target/debug/sona");

        assert!(!debug_portable_marker_requires_override(
            executable, true, true
        ));
        assert!(!debug_portable_marker_requires_override(
            Path::new("/Applications/Sona.app/Contents/MacOS/Sona"),
            false,
            false,
        ));
    }
}
