# Building Sona

Sona builds as a Tauri 2 desktop app with a Rust backend and a Bun-managed React frontend.

## Prerequisites

- Current stable Rust with the platform toolchain.
- Bun.
- Platform libraries required by Tauri and the selected transcription runtime.

```bash
bun install
bun run prepare:agent-hook
```

`prepare:agent-hook` builds the packaged `sona-agent-hook` sidecar for the current target and stages it under `src-tauri/binaries/` using Tauri's target-suffixed naming convention.

## Development

```bash
bun run tauri dev
```

If the macOS CMake policy setting is required by a local toolchain:

```bash
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri dev
```

The frontend-only commands are:

```bash
bun run dev
bun run build
bun run preview
```

## Checks

```bash
bun run build
bun run lint
bun run lint:anti-slop
bun run check:translations
bun test
cd cloudflare/sona-companion && bun run typecheck && bun run test
cd src-tauri && cargo check --all-features
cd src-tauri && cargo test --lib
cd src-tauri && cargo test --bin sona-agent-hook
```

Run `bun run prepare:agent-hook` before a Tauri build or package build. The package audit expects one executable `sona-agent-hook` sidecar and a `sona` main executable.

## Version bump

1. `src-tauri/Cargo.toml` `[package] version` — the only place this app declares a version.
2. `src-tauri/Cargo.lock` — run any cargo command, then commit the changed `sona` entry.
3. `package.json` `version`.
4. `src/content/release-notes/index.ts` — add a `RELEASE_NOTE_MARKDOWN` entry keyed by the new version, or What's New has nothing to show.
5. `mobile/Sona.xcodeproj/project.pbxproj` `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION`, only when shipping the companion app.

`src-tauri/tauri.conf.json` deliberately carries no `version` field. With it absent, `tauri-codegen` compiles `PackageInfo.version` from `env!("CARGO_PKG_VERSION")` (tauri-codegen 2.6.3, `src/context.rs:273-278`), so `getVersion()` in Settings > About, the What's New gate, `sona --version`, and the bundle version all read step 1 — do not add it back, or About and `--version` can disagree. `tools/sona-mcp` and `cloudflare/sona-companion` version independently. No script checks agreement; this prints one line when steps 1-4 match, and two if a version reappears in the Tauri config:

```bash
{ awk -F'"' '/^version = /{print $2; exit}' src-tauri/Cargo.toml; jq -r '.version // empty' src-tauri/tauri.conf.json; jq -r .version package.json; sed -n 's/^  "\([0-9][0-9.]*\)".*/\1/p' src/content/release-notes/index.ts | sort -V | tail -1; } | sort -u
```

## Package layout

| Platform | Main executable                | Application identity | Private runtime directory |
| -------- | ------------------------------ | -------------------- | ------------------------- |
| macOS    | `Sona.app/Contents/MacOS/sona` | `com.aktanazat.sona` | Inside the app bundle     |
| Windows  | `sona.exe`                     | `com.aktanazat.sona` | Next to the executable    |
| Linux    | `sona`                         | `com.aktanazat.sona` | `/usr/lib/sona`           |

macOS builds sign with the Apple Development identity named in `tauri.conf.json` (`Apple Development: Created via API (JWV9B89S4H)`, team `AAVB324H37`) and enable the hardened runtime. That certificate is a development identity, not a distribution one: this repository does not provide notarization, SmartScreen reputation, or signed distribution credentials. Nothing updates itself either; `commands/updates.rs` only compares the running `CARGO_PKG_VERSION` against a releases URL when the user asks.

## Platform notes

### macOS

Sona supports macOS 10.15 and later. Local Apple Intelligence support uses the FoundationModels framework when the active toolchain provides it; otherwise the build uses the stub bridge. Set `SONA_FORCE_AI_STUB=1` to force that bridge.

Sona is a new TCC subject. Grant Microphone and Accessibility access again after installing it. Reset a development Accessibility grant with:

```bash
tccutil reset Accessibility com.aktanazat.sona
```

### Windows

The NSIS installer uses the Sona product name and installs under the selected Sona directory. CI sets `SONA_VC_REDIST_DIRS` when it stages the app-local VC++ runtime.

### Linux

The deb and rpm packages install Sona's private native libraries in `/usr/lib/sona`; the executable's rpath points there. The AppImage continues to use its own `usr/lib` layout.

If a Wayland compositor has trouble with the recording overlay, run:

```bash
SONA_NO_GTK_LAYER_SHELL=1 sona
```

## Portable installations

Place a `portable` marker beside the executable. Sona recognizes `Sona Portable Mode`, writes that marker for new portable installs, and keeps data under the adjacent `Data/` directory. It accepts the older marker only to preserve an in-place upgrade.

Portable mode intentionally disables native credential storage. Cloud and provider-key features stay unavailable there.

## Migrating from the Legacy app

On first launch Sona offers to move settings, history, recordings, models, and configured provider keys from the Legacy app. Close the Legacy app first. Sona copies mutable data, moves large blobs, journals each operation, and writes a completion receipt only after migration finishes.

If migration needs to be reversed, use the debug rollback action while the Legacy app is closed. The rollback discards Sona-era settings and history changes, then moves recordings and models back. It does not uninstall the Legacy app or re-register its macOS login item.
