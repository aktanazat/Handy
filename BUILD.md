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
bun test scripts
cd src-tauri && cargo check --all-features
cd src-tauri && cargo test --lib
cd src-tauri && cargo test --bin sona-agent-hook
```

Run `bun run prepare:agent-hook` before a Tauri build or package build. The package audit expects one executable `sona-agent-hook` sidecar and a `sona` main executable.

## Package layout

| Platform | Main executable | Application identity | Private runtime directory |
| --- | --- | --- | --- |
| macOS | `Sona.app/Contents/MacOS/sona` | `com.aktanazat.sona` | Inside the app bundle |
| Windows | `sona.exe` | `com.aktanazat.sona` | Next to the executable |
| Linux | `sona` | `com.aktanazat.sona` | `/usr/lib/sona` |

Sona uses ad-hoc local signing on macOS (`signingIdentity: "-"`). This repository does not provide notarization, automatic updates, SmartScreen reputation, or signed distribution credentials.

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
