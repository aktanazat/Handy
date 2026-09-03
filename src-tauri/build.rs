/// Stamp the commit this binary came from, so "which Sona is this" has an
/// answer. The version cannot say: an installed 1.1.0 bundle and a working
/// tree eight commits ahead both call themselves 1.1.0, which is how a stale
/// install gets exercised as if it were current. `unknown` when git is not
/// there to ask, as in a source tarball.
///
/// It is the commit this build script last observed, not a claim about the
/// tree. Everything below emits `rerun-if-changed`, which replaces cargo's
/// default of rerunning on any package change, so a source edit alone does
/// not re-run this — only a move of `HEAD` or a ref does. A `-dirty` marker
/// was tried and removed for that reason: it would have gone stale in both
/// directions and lied with confidence. The sha alone carries the story.
///
/// Only `sona --version` reads it. The update check keeps comparing bare
/// `CARGO_PKG_VERSION`, which is the number releases are ordered by.
fn emit_build_identity() {
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .args(args)
            .output()
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
    };
    // `--git-path` resolves through a worktree's `.git` file, where a literal
    // `../.git/HEAD` does not exist and the stamp would freeze at whatever
    // the first build saw.
    for name in ["HEAD", "refs"] {
        if let Some(path) = git(&["rev-parse", "--git-path", name]) {
            if std::path::Path::new(&path).exists() {
                println!("cargo:rerun-if-changed={path}");
            }
        }
    }
    let commit = git(&["rev-parse", "--short=7", "HEAD"]).filter(|sha| !sha.is_empty());
    println!(
        "cargo:rustc-env=SONA_BUILD_COMMIT={}",
        commit.as_deref().unwrap_or("unknown")
    );
}

fn main() {
    emit_build_identity();

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    build_apple_intelligence_bridge();

    #[cfg(target_os = "macos")]
    build_meeting_capture_bridge();
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

    generate_tray_translations();

    // Linux ships transcribe-cpp as a shared libtranscribe + loadable ggml
    // backend modules (the `dynamic-backends` posture in Cargo.toml). Bake an
    // $ORIGIN-relative rpath into the `sona` binary so it finds libtranscribe
    // next to it in the package — deb/rpm install into the app-private
    // `/usr/lib/sona` (the dir Tauri already uses for resources; keeps
    // Sona's libs out of the ldconfig-scanned `/usr/lib`, issue #1639) while
    // the AppImage keeps them in `usr/lib` (linuxdeploy's layout), hence both
    // entries. transcribe's
    // init_backends_default() then loads the ggml modules co-located there.
    // (Windows resolves DLLs from the exe directory, so it needs no rpath;
    // macOS links transcribe-cpp statically via the `metal` feature.)
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib/sona:$ORIGIN/../lib");
    }

    // Stage transcribe-cpp's shared runtime libraries (and the dlopen'd ggml
    // backend modules) for the installer. Self-gates on the shared /
    // dynamic-backends posture used by Linux and Windows; it's a no-op for the
    // static macOS `metal` build, where there is nothing to ship.
    stage_transcribe_runtime_libs();

    // When ORT is dynamically linked (Windows CI sets ORT_LIB_LOCATION +
    // ORT_PREFER_DYNAMIC_LINK to a baseline ONNX Runtime), ship its onnxruntime.dll
    // next to Sona.exe so the app loads our baseline build instead of statically
    // embedding pyke's /arch:AVX2 one (which crashes at startup on pre-Haswell CPUs).
    stage_onnxruntime_dll();

    // Must run after transcribe staging because that helper recreates transcribe-libs/.
    stage_vc_runtime_dlls();

    tauri_build::build()
}

/// The `transcribe-libs/` staging directory beside this crate's manifest.
///
/// Three callers stage into it — the MSVC runtime DLLs, `onnxruntime.dll`, and
/// transcribe-cpp's shared libraries — so the path lives here rather than
/// being spelled out again at each one.
fn transcribe_libs_path() -> std::path::PathBuf {
    // cargo always sets CARGO_MANIFEST_DIR for a build script, and the staged
    // libraries have to land beside the manifest for the bundler to find them.
    // PANIC: a build that cannot locate its own crate root must stop.
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    std::path::PathBuf::from(manifest_dir).join("transcribe-libs")
}

/// [`transcribe_libs_path`], created if it does not exist yet.
fn transcribe_libs_dir() -> std::path::PathBuf {
    let dir = transcribe_libs_path();
    // Without this directory the installer ships with no runtime libraries.
    // PANIC: a silently incomplete package is worse than a failed build.
    std::fs::create_dir_all(&dir).expect("create transcribe-libs staging dir");
    dir
}

/// Stage the MSVC runtime DLLs into `transcribe-libs/` for app-local deployment.
///
/// Sona's native stack links the VC++ runtime dynamically (/MD). Shipping the
/// DLLs beside `sona.exe` covers machines with no redistributable installed and
/// machines whose system redist is older than the CI toolset (issue #1527).
///
/// Driven by `SONA_VC_REDIST_DIRS`, set by CI to the redist dirs from the same
/// Visual Studio install that compiled the native code. Copies only the runtime
/// DLL families Sona imports and no-ops when the env var is unset.
fn stage_vc_runtime_dlls() {
    println!("cargo:rerun-if-env-changed=SONA_VC_REDIST_DIRS");

    let Some(redist_dirs) = std::env::var_os("SONA_VC_REDIST_DIRS") else {
        return;
    };
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let dest = transcribe_libs_dir();

    let mut copied: Vec<String> = Vec::new();
    for dir in std::env::split_paths(&redist_dirs) {
        for entry in std::fs::read_dir(&dir)
            .unwrap_or_else(|e| panic!("SONA_VC_REDIST_DIRS: read {}: {e}", dir.display()))
            .flatten()
        {
            let src = entry.path();
            let name = src
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let lower = name.to_lowercase();
            let wanted = lower.ends_with(".dll")
                && (lower.starts_with("msvcp140")
                    || lower.starts_with("vcruntime140")
                    || lower.starts_with("vcomp140"));
            if wanted {
                std::fs::copy(&src, dest.join(&name))
                    .unwrap_or_else(|e| panic!("copy {}: {e}", src.display()));
                copied.push(lower);
            }
        }
    }

    // Fail the build rather than ship an installer that regresses issue #1527.
    for required in ["msvcp140.dll", "vcruntime140.dll"] {
        if !copied.iter().any(|n| n == required) {
            panic!(
                "SONA_VC_REDIST_DIRS is set but {required} was not found in it; \
                 the app-local VC++ runtime would be incomplete and Sona would \
                 crash on machines without a current redist (issue #1527)"
            );
        }
    }
    println!(
        "cargo:warning=Staged {} VC++ runtime DLL(s) for app-local deployment",
        copied.len()
    );
}

/// Copy the dynamically-linked ONNX Runtime `onnxruntime.dll` into the
/// `transcribe-libs/` staging dir so `tauri.windows.conf.json` bundles it beside
/// `Sona.exe` (Windows resolves DLLs from the executable's directory).
///
/// No-op unless `ORT_PREFER_DYNAMIC_LINK` + `ORT_LIB_LOCATION` are set for a Windows
/// target — i.e. the CI dynamic-link path. A plain static build (no env) skips this
/// and keeps the embedded ORT, and non-Windows targets bundle their ORT elsewhere
/// (see build.yml frameworks/deb.files steps), so they are ignored here.
fn stage_onnxruntime_dll() {
    use std::path::PathBuf;

    println!("cargo:rerun-if-env-changed=ORT_LIB_LOCATION");
    println!("cargo:rerun-if-env-changed=ORT_PREFER_DYNAMIC_LINK");

    if std::env::var_os("ORT_PREFER_DYNAMIC_LINK").is_none() {
        return;
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let Some(lib_location) = std::env::var_os("ORT_LIB_LOCATION") else {
        return;
    };

    let src = PathBuf::from(&lib_location).join("onnxruntime.dll");
    if !src.exists() {
        panic!(
            "ORT_PREFER_DYNAMIC_LINK is set but {} does not exist; a dynamic ORT \
             build must supply onnxruntime.dll to bundle",
            src.display()
        );
    }

    // transcribe-libs/ is already created by stage_transcribe_runtime_libs() on the
    // Windows x86_64 dynamic-backends build and bundled by tauri.windows.conf.json;
    // create it defensively so this is self-contained.
    let dest_dir = transcribe_libs_dir();
    std::fs::copy(&src, dest_dir.join("onnxruntime.dll"))
        .unwrap_or_else(|e| panic!("copy {}: {e}", src.display()));
    println!("cargo:warning=Staged onnxruntime.dll for Windows bundling");
}

/// Stage transcribe-cpp's shared runtime libraries into `transcribe-libs/` so the
/// installer can ship them next to the executable. One code path covers Windows
/// (`.dll`) and Linux (versioned `.so`); the match-by-name filter below handles
/// both naming schemes.
///
/// Source dirs arrive as `DEP_TRANSCRIBE_CPP_*`: the sys crate (`links =
/// "transcribe"`) emits its install dirs and the wrapper (`links =
/// "transcribe_cpp"`) forwards them one hop to us — the only way that metadata
/// crosses cargo's one-hop `links` boundary. The keys exist only in a shared /
/// dynamic-backends build; a static build (macOS `metal`) leaves them unset, so
/// this is a no-op there. `RUNTIME_DIR` (core libs) and `MODULE_DIR` (dlopen'd
/// ggml modules) may be the same dir — the `BTreeSet` below dedups them.
///
/// Where the staged dir lands: Windows bundles it beside `sona.exe` (DLLs resolve
/// from the exe dir); Linux deb/rpm map it into the app-private `/usr/lib/sona`
/// and the AppImage into `usr/lib`, both on the binary's rpath.
fn stage_transcribe_runtime_libs() {
    use std::collections::BTreeSet;
    use std::path::PathBuf;

    println!("cargo:rerun-if-env-changed=DEP_TRANSCRIBE_CPP_RUNTIME_DIR");
    println!("cargo:rerun-if-env-changed=DEP_TRANSCRIBE_CPP_MODULE_DIR");

    // Present only in a shared posture. A static build has nothing to ship.
    let Some(runtime_dir) = std::env::var_os("DEP_TRANSCRIBE_CPP_RUNTIME_DIR") else {
        return;
    };

    // transcribe-cpp publishes its runtime layout in up to two directories:
    //   RUNTIME_DIR : the shared libs to load (transcribe + core ggml / ggml-base)
    //   MODULE_DIR  : the dlopen'd ggml backend modules (the per-ISA ggml-cpu-*
    //                 and ggml-vulkan), dynamic-backends only. Often — but not
    //                 always — the SAME directory as RUNTIME_DIR (it is on Linux).
    // BOTH must sit next to the executable, or init_backends_default() finds the
    // core libs but zero loadable compute backends and registers no devices.
    let mut dirs = BTreeSet::new();
    dirs.insert(PathBuf::from(runtime_dir));
    if let Some(module_dir) = std::env::var_os("DEP_TRANSCRIBE_CPP_MODULE_DIR") {
        dirs.insert(PathBuf::from(module_dir));
    }

    // Recreate clean so a renamed or dropped ggml module can never linger in the
    // package from a previous build.
    let _ = std::fs::remove_dir_all(transcribe_libs_path());
    let dest = transcribe_libs_dir();

    // Collect every candidate library name first (across both dirs) so the
    // pruning below can see each lib's whole symlink family at once.
    let mut libs: std::collections::BTreeMap<String, PathBuf> = Default::default();
    for dir in &dirs {
        println!("cargo:rerun-if-changed={}", dir.display());
        for entry in std::fs::read_dir(dir)
            .unwrap_or_else(|e| panic!("read {}: {e}", dir.display()))
            .flatten()
        {
            let src = entry.path();
            let name = src.file_name().and_then(|s| s.to_str()).unwrap_or("");
            // Match by NAME, not extension: Linux versions its libs
            // (libtranscribe.so.0, .so.0.2.0) and the loader needs the SONAME, so
            // an extension-only filter would miss the versioned names entirely.
            let is_lib = name.ends_with(".dll")
                || name.ends_with(".dylib")
                || name.ends_with(".so")
                || name.contains(".so.");
            if is_lib {
                libs.insert(name.to_string(), src);
            }
        }
    }

    // A Linux install dir carries each lib as a symlink chain (for example,
    // libfoo.so -> libfoo.so.0.2 -> libfoo.so.0.2.0), and tauri's deb/rpm
    // bundlers flatten symlinks into real files. Staging every name would
    // triplicate each lib and draw "not a symbolic link" warnings from ldconfig
    // (issue #1639). Only one name per lib is needed at runtime: the shortest
    // versioned name is the SONAME for linked core libs, while a dlopen'd ggml
    // backend module generally has only its bare unversioned name. Stage that
    // name; `fs::copy` dereferences the symlink so the staged file is real.
    let mut best: std::collections::BTreeMap<&str, (&str, &PathBuf, usize)> = Default::default();
    for (name, src) in &libs {
        let (stem, rank) = match split_versioned_so(name) {
            // Windows/macOS names (.dll/.dylib) are unversioned: keep as-is.
            None => (name.as_str(), 0),
            // Prefer the shortest versioned name (`.so.0`, `.so.0.2`, etc.),
            // then the bare `.so`; a full version is only the fallback when the
            // install tree did not provide its SONAME symlink.
            Some((stem, 0)) => (stem, usize::MAX),
            Some((stem, depth)) => (stem, depth - 1),
        };
        match best.get(stem) {
            Some(&(_, _, existing)) if existing <= rank => {}
            _ => {
                best.insert(stem, (name, src, rank));
            }
        }
    }

    let mut copied = 0usize;
    for &(name, src, _) in best.values() {
        std::fs::copy(src, dest.join(name))
            .unwrap_or_else(|e| panic!("copy {}: {e}", src.display()));
        copied += 1;
    }
    if copied == 0 {
        panic!(
            "no transcribe-cpp runtime libraries found under {dirs:?}; a shared / \
             dynamic-backends build must ship them or the app registers zero \
             compute devices"
        );
    }
    println!("cargo:warning=Staged {copied} transcribe-cpp runtime library file(s)");
}

/// Split a versioned ELF shared-library name into (stem, version depth):
/// `libfoo.so` -> ("libfoo", 0), `libfoo.so.0` -> ("libfoo", 1),
/// `libfoo.so.0.2.0` -> ("libfoo", 3). Returns None for names that aren't a
/// `.so` optionally followed by dot-separated numeric components.
fn split_versioned_so(name: &str) -> Option<(&str, usize)> {
    let idx = name.find(".so")?;
    let (stem, rest) = (&name[..idx], &name[idx + 3..]);
    if rest.is_empty() {
        return Some((stem, 0));
    }
    let comps: Vec<&str> = rest.strip_prefix('.')?.split('.').collect();
    comps
        .iter()
        .all(|c| !c.is_empty() && c.bytes().all(|b| b.is_ascii_digit()))
        .then_some((stem, comps.len()))
}

/// The one section of a locale bundle the tray codegen reads: the tray menu's
/// flat map of key to translated string. Every other section is ignored, and a
/// `tray` that is not a flat string map fails the build rather than producing a
/// tray with blank labels.
#[derive(serde::Deserialize)]
struct LocaleBundle {
    tray: Option<std::collections::BTreeMap<String, String>>,
}

/// One locale directory's tray strings, keyed by its BCP-47 directory name.
/// `None` for a bundle that carries no `tray` section.
fn read_locale_tray(
    dir: &std::path::Path,
) -> Option<(String, std::collections::BTreeMap<String, String>)> {
    // `read_dir` never yields an entry without a final component, and a locale
    // directory is named after its BCP-47 code, which is ASCII.
    // PANIC: a non-UTF-8 name here means a corrupt checkout.
    let lang = dir.file_name().unwrap().to_str().unwrap().to_string();
    let json_path = dir.join("translation.json");

    println!("cargo:rerun-if-changed={}", json_path.display());

    // Every locale directory in the repo carries a translation.json.
    // PANIC: an unreadable one must fail the build.
    let content = std::fs::read_to_string(&json_path).unwrap();
    // `bun run check:translations` gates every bundle's contents, so a file
    // that does not parse here means that gate was bypassed.
    // PANIC: a malformed bundle must fail the build, not ship blank labels.
    let bundle: LocaleBundle = serde_json::from_str(&content).unwrap();

    bundle.tray.map(|tray| (lang, tray))
}

/// Generate tray menu translations from frontend locale files.
///
/// Source of truth: src/i18n/locales/*/translation.json
/// The English "tray" section defines the struct fields.
fn generate_tray_translations() {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::Path;

    // cargo always sets OUT_DIR for a build script, and there is nowhere to
    // write the generated module without it.
    // PANIC: a build that cannot find its own output directory must stop.
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let locales_dir = Path::new("../src/i18n/locales");

    println!("cargo:rerun-if-changed=../src/i18n/locales");

    // Collect all locale translations
    let mut translations: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();

    // The locales directory is checked into the repo beside this crate.
    // PANIC: its absence means a broken checkout, not a build to continue.
    let locale_entries = fs::read_dir(locales_dir).unwrap();
    for entry in locale_entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Some((lang, tray)) = read_locale_tray(&path) {
            translations.insert(lang, tray);
        }
    }

    // English defines the schema, and without it there are no fields at all —
    // every downstream `TrayStrings` reference would fail to compile.
    // PANIC: a missing reference locale must stop the build.
    let english = translations.get("en").unwrap();
    let fields: Vec<_> = english
        .keys()
        .map(|k| (camel_to_snake(k), k.clone()))
        .collect();

    // Generate code
    let mut out = String::from(
        "// Auto-generated from src/i18n/locales/*/translation.json - do not edit\n\n",
    );

    // Struct
    out.push_str("#[derive(Debug, Clone)]\npub struct TrayStrings {\n");
    for (rust_field, _) in &fields {
        out.push_str(&format!("    pub {rust_field}: String,\n"));
    }
    out.push_str("}\n\n");

    // Static map
    out.push_str(
        "pub static TRANSLATIONS: Lazy<HashMap<&'static str, TrayStrings>> = Lazy::new(|| {\n",
    );
    out.push_str("    let mut m = HashMap::new();\n");

    for (lang, tray) in &translations {
        out.push_str(&format!("    m.insert(\"{lang}\", TrayStrings {{\n"));
        for (rust_field, json_key) in &fields {
            let val = tray.get(json_key).map(String::as_str).unwrap_or("");
            out.push_str(&format!(
                "        {rust_field}: \"{}\".to_string(),\n",
                escape_string(val)
            ));
        }
        out.push_str("    });\n");
    }

    out.push_str("    m\n});\n");

    // OUT_DIR is cargo's own scratch directory for this crate, and a module
    // that cannot be written leaves the crate referencing a missing file.
    // PANIC: the build must stop here rather than fail later and obscurely.
    fs::write(Path::new(&out_dir).join("tray_translations.rs"), out).unwrap();

    println!(
        "cargo:warning=Generated tray translations: {} languages, {} fields",
        translations.len(),
        fields.len()
    );
}

fn camel_to_snake(s: &str) -> String {
    s.chars()
        .enumerate()
        .fold(String::new(), |mut acc, (i, c)| {
            if c.is_uppercase() && i > 0 {
                acc.push('_');
            }
            /* `char::to_lowercase` yields one or more chars, and the tail
             * matters: the old `.next().unwrap()` dropped every char past the
             * first, silently truncating a key whose lowercase expands. */
            acc.extend(c.to_lowercase());
            acc
        })
}

fn escape_string(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

#[cfg(target_os = "macos")]
fn build_meeting_capture_bridge() {
    use std::env;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const SOURCE: &str = "swift/meeting_capture.swift";
    println!("cargo:rerun-if-changed={SOURCE}");

    // The compiled bridge has nowhere to go without cargo's output directory.
    // PANIC: cargo always sets OUT_DIR for a build script.
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
    let object_path = out_dir.join("meeting_capture.o");
    let archive_path = out_dir.join("libmeeting_capture.a");
    // Every macOS toolchain that can build this crate ships xcrun, and the SDK
    // path it prints is a filesystem path.
    // PANIC: no SDK means no Swift bridge, so the build cannot continue.
    let sdk_path = env::var("SDKROOT").unwrap_or_else(|_| {
        String::from_utf8(
            Command::new("xcrun")
                .args(["--sdk", "macosx", "--show-sdk-path"])
                .output()
                .expect("Failed to locate macOS SDK")
                .stdout,
        )
        .expect("SDK path is not valid UTF-8")
        .trim()
        .to_string()
    });
    // Same toolchain guarantee as the SDK above: xcrun locates swiftc, and its
    // answer is a filesystem path.
    // PANIC: no Swift compiler means no bridge to link against.
    let swiftc_path = env::var("SWIFTC").unwrap_or_else(|_| {
        String::from_utf8(
            Command::new("xcrun")
                .args(["--find", "swiftc"])
                .output()
                .expect("Failed to locate swiftc")
                .stdout,
        )
        .expect("swiftc path is not valid UTF-8")
        .trim()
        .to_string()
    });
    // The Swift target triple cannot be formed without the architecture.
    // PANIC: cargo always sets CARGO_CFG_TARGET_ARCH.
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").expect("target architecture unavailable");
    let target = format!("{target_arch}-apple-macosx14.0");

    if !Path::new(SOURCE).is_file() {
        panic!("Meeting capture Swift source is missing");
    }
    // Both paths were just built from OUT_DIR, which cargo keeps UTF-8, and a
    // swiftc that cannot run leaves the crate with no bridge to link.
    // PANIC: stop here rather than fail obscurely at link time.
    let status = Command::new(&swiftc_path)
        .args([
            "-parse-as-library",
            "-target",
            &target,
            "-sdk",
            &sdk_path,
            "-O",
            "-c",
            SOURCE,
            "-o",
            object_path
                .to_str()
                .expect("meeting capture object path is not UTF-8"),
        ])
        .status()
        .expect("Failed to invoke swiftc for meeting capture");
    if !status.success() {
        panic!("swiftc failed to compile meeting capture bridge");
    }
    // libtool is part of the same toolchain, and without the archive there is
    // nothing for `rustc-link-lib=static` to find.
    // PANIC: stop here rather than fail obscurely at link time.
    let status = Command::new("libtool")
        .args([
            "-static",
            "-o",
            archive_path
                .to_str()
                .expect("meeting capture archive path is not UTF-8"),
            object_path
                .to_str()
                .expect("meeting capture object path is not UTF-8"),
        ])
        .status()
        .expect("Failed to archive meeting capture bridge");
    if !status.success() {
        panic!("libtool failed for meeting capture bridge");
    }

    // swiftc lives at <toolchain>/usr/bin/swiftc, so it always has two parents.
    // PANIC: a layout without them is not a toolchain this bridge can link to.
    let toolchain_swift_lib = Path::new(&swiftc_path)
        .parent()
        .and_then(|path| path.parent())
        .map(|root| root.join("lib/swift/macosx"))
        .expect("Unable to determine Swift toolchain lib directory");
    let sdk_swift_lib = Path::new(&sdk_path).join("usr/lib/swift");
    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=meeting_capture");
    println!(
        "cargo:rustc-link-search=native={}",
        toolchain_swift_lib.display()
    );
    println!("cargo:rustc-link-search=native={}", sdk_swift_lib.display());
    for framework in [
        "ScreenCaptureKit",
        "AVFoundation",
        "AppKit",
        "ApplicationServices",
        "CoreMedia",
        "CoreAudio",
        "AudioToolbox",
        "CoreGraphics",
        "Foundation",
        "CoreFoundation",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn build_apple_intelligence_bridge() {
    use std::env;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const REAL_SWIFT_FILE: &str = "swift/apple_intelligence.swift";
    const STUB_SWIFT_FILE: &str = "swift/apple_intelligence_stub.swift";
    const BRIDGE_HEADER: &str = "swift/apple_intelligence_bridge.h";

    println!("cargo:rerun-if-changed={REAL_SWIFT_FILE}");
    println!("cargo:rerun-if-changed={STUB_SWIFT_FILE}");
    println!("cargo:rerun-if-changed={BRIDGE_HEADER}");

    // The compiled bridge has nowhere to go without cargo's output directory.
    // PANIC: cargo always sets OUT_DIR for a build script.
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
    let object_path = out_dir.join("apple_intelligence.o");
    let static_lib_path = out_dir.join("libapple_intelligence.a");

    // SDKROOT/SWIFTC env-var overrides let non-Xcode toolchains (e.g. nixpkgs
    // with apple-sdk_* + standalone swift) bypass xcrun, which is Xcode-only.
    // PANIC: no macOS SDK means no Swift bridge, so the build cannot continue.
    let sdk_path = env::var("SDKROOT").unwrap_or_else(|_| {
        String::from_utf8(
            Command::new("xcrun")
                .args(["--sdk", "macosx", "--show-sdk-path"])
                .output()
                .expect("Failed to locate macOS SDK")
                .stdout,
        )
        .expect("SDK path is not valid UTF-8")
        .trim()
        .to_string()
    });

    // Check if the SDK supports FoundationModels (required for Apple Intelligence)
    let framework_path =
        Path::new(&sdk_path).join("System/Library/Frameworks/FoundationModels.framework");
    // SONA_FORCE_AI_STUB=1 is an explicit escape hatch: force the stub even when
    // the active toolchain could build the real path (e.g. to skip the Swift
    // compile, or if the auto-detection below misfires). The common CLT-only case
    // is detected automatically just below, so this flag is rarely needed.
    let force_stub = env::var("SONA_FORCE_AI_STUB").as_deref() == Ok("1");

    // Auto-detect a Command-Line-Tools-only toolchain. The CLT SDK contains
    // FoundationModels.framework, so the `framework_path.exists()` check alone
    // wrongly selects the real Swift path, which then fails to compile because
    // the CLT `swiftc` has no FoundationModelsMacros plugin (full Xcode only).
    // Detecting this lets a plain `cargo build` / `tauri dev` succeed without the
    // manual flag. Skipped when SWIFTC is overridden: that signals a custom
    // toolchain (e.g. the nixpkgs standalone-swift path supported above) whose
    // capabilities can't be inferred from `xcode-select`.
    let command_line_tools_only = env::var("SWIFTC").is_err() && is_command_line_tools_only();
    if command_line_tools_only && !force_stub {
        println!(
            "cargo:warning=Command Line Tools-only toolchain detected; Apple Intelligence \
             (FoundationModels) needs full Xcode. Falling back to stubs. Install Xcode and run \
             `sudo xcode-select -s /Applications/Xcode.app`, or set SONA_FORCE_AI_STUB=1 to \
             silence this message."
        );
    }

    let has_foundation_models = framework_path.exists() && !force_stub && !command_line_tools_only;

    let source_file = if has_foundation_models {
        println!("cargo:warning=Building with Apple Intelligence support.");
        REAL_SWIFT_FILE
    } else {
        // The SDK genuinely lacking FoundationModels is only one reason we build
        // stubs — CLT-only detection and SONA_FORCE_AI_STUB (each warned about
        // above) also land here, and for those the framework does exist. Only
        // claim it's "not found" when that's actually true.
        if framework_path.exists() {
            println!("cargo:warning=Building Apple Intelligence with stubs.");
        } else {
            println!("cargo:warning=Apple Intelligence SDK not found. Building with stubs.");
        }
        STUB_SWIFT_FILE
    };

    if !Path::new(source_file).exists() {
        panic!("Source file {} is missing!", source_file);
    }

    // See SDKROOT note above — same env-override pattern for non-Xcode toolchains.
    // PANIC: no Swift compiler means no bridge to link against.
    let swiftc_path = env::var("SWIFTC").unwrap_or_else(|_| {
        String::from_utf8(
            Command::new("xcrun")
                .args(["--find", "swiftc"])
                .output()
                .expect("Failed to locate swiftc")
                .stdout,
        )
        .expect("swiftc path is not valid UTF-8")
        .trim()
        .to_string()
    });

    // swiftc lives at <toolchain>/usr/bin/swiftc, so it always has two parents.
    // PANIC: a layout without them is not a toolchain this bridge can link to.
    let toolchain_swift_lib = Path::new(&swiftc_path)
        .parent()
        .and_then(|p| p.parent())
        .map(|root| root.join("lib/swift/macosx"))
        .expect("Unable to determine Swift toolchain lib directory");
    let sdk_swift_lib = Path::new(&sdk_path).join("usr/lib/swift");

    // Use macOS 11.0 as deployment target for compatibility
    // The @available(macOS 26.0, *) checks in Swift handle runtime availability
    // Weak linking for FoundationModels is handled via cargo:rustc-link-arg below
    // A swiftc that cannot run leaves the crate with no bridge to link.
    // PANIC: stop here rather than fail obscurely at link time.
    let status = Command::new(&swiftc_path)
        .args([
            // Without this flag swiftc treats single-file input as script
            // mode and emits its own `_main` symbol into the .o, which can
            // win the link against Rust's main under some linkers (e.g.
            // open-source ld64 used in nixpkgs' Darwin stdenv), producing a
            // binary whose main() is a 5-instruction no-op that returns 0.
            // `-parse-as-library` keeps the compilation in library mode so
            // no `_main` is emitted. See:
            //   https://forums.swift.org/t/main-in-a-single-swift-file/63079
            "-parse-as-library",
            "-target",
            "arm64-apple-macosx11.0",
            "-sdk",
            &sdk_path,
            "-O",
            "-import-objc-header",
            BRIDGE_HEADER,
            "-c",
            source_file,
            "-o",
            object_path
                .to_str()
                .expect("Failed to convert object path to string"),
        ])
        .status()
        .expect("Failed to invoke swiftc for Apple Intelligence bridge");

    if !status.success() {
        panic!("swiftc failed to compile {source_file}");
    }

    // libtool is part of the same toolchain, and without the archive there is
    // nothing for `rustc-link-lib=static` to find.
    // PANIC: stop here rather than fail obscurely at link time.
    let status = Command::new("libtool")
        .args([
            "-static",
            "-o",
            static_lib_path
                .to_str()
                .expect("Failed to convert static lib path to string"),
            object_path
                .to_str()
                .expect("Failed to convert object path to string"),
        ])
        .status()
        .expect("Failed to create static library for Apple Intelligence bridge");

    if !status.success() {
        panic!("libtool failed for Apple Intelligence bridge");
    }

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=apple_intelligence");
    println!(
        "cargo:rustc-link-search=native={}",
        toolchain_swift_lib.display()
    );
    println!("cargo:rustc-link-search=native={}", sdk_swift_lib.display());
    println!("cargo:rustc-link-lib=framework=Foundation");

    if has_foundation_models {
        // Use weak linking so the app can launch on systems without FoundationModels
        println!("cargo:rustc-link-arg=-weak_framework");
        println!("cargo:rustc-link-arg=FoundationModels");
    }
}

/// Returns true when the active developer directory is the standalone Command
/// Line Tools rather than a full Xcode install.
///
/// `xcode-select -p` prints the active developer dir; the CLT install resolves
/// to a path ending in `CommandLineTools` (e.g. `/Library/Developer/CommandLineTools`),
/// whereas full Xcode resolves under `Xcode.app`. A CLT-only toolchain ships
/// FoundationModels.framework in its SDK but a `swiftc` without the
/// FoundationModelsMacros plugin, so the Apple Intelligence Swift path cannot
/// compile (issue #1448). On any error we conservatively return false so the
/// existing SDK-presence check decides.
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn is_command_line_tools_only() -> bool {
    use std::process::Command;

    Command::new("xcode-select")
        .arg("-p")
        .output()
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|path| path.trim().ends_with("CommandLineTools"))
        .unwrap_or(false)
}
