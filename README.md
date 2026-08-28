# Sona

Sona is a local-first desktop speech-to-text app for macOS, Windows, and Linux. It records from the microphone, transcribes with a selected local model, and delivers the finished text using the mode that started the run.

## What Sona does

- Local Whisper-family GGUF and ONNX transcription models.
- Per-mode recognition, context, prompt, delivery, and shortcut settings.
- Optional cloud transcription with a user-provided provider key and explicit consent.
- Searchable local history with delivery receipts and retained recordings.
- Audio-file transcription, vocabulary corrections, CSV vocabulary tools, and optional emoji replacements.
- Optional local agent hooks for Claude, Codex, and Grok.

Local runs keep captured audio on the device. Cloud transcription sends audio only after you configure a provider key and accept that provider's transfer notice. Sona does not store provider keys in its settings file.

## Releases and install

Tagged builds are published on the [releases page](https://github.com/aktanazat/Handy/releases). Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds macOS (Apple silicon), Windows, and Linux bundles and attaches them to a draft release for review before publishing.

- macOS: open the `.dmg` and drag Sona to Applications.
- Windows: run the `.msi` or the NSIS `-setup.exe` installer.
- Linux: use the `.AppImage`, or install the `.deb` on Debian and Ubuntu.

macOS bundles are signed and notarized only when the repository has the Apple signing secrets configured. Without them the release job still succeeds and produces unsigned bundles, which macOS quarantines on first open; remove the quarantine flag with `xattr -dr com.apple.quarantine /Applications/Sona.app` or build from source instead.

## Compatibility boundaries

Sona implements its speech, mode, context, delivery, history, import, and agent features with open code and public provider APIs. It does not copy or depend on Superwhisper binaries, services, private assets, licensing systems, or enterprise controls.

Three implementation details are intentionally absent because the source evidence does not contain enough information to reproduce them safely: the private X-Signature authentication scheme, the S1 cloud model weights, and server-only decode defaults. Cloud transcription uses direct bring-your-own-key provider connections. Local transcription uses the models and decode settings listed in Sona.

## First launch and migration

Sona uses its own application identity and data directory. On the first launch it can move data from the **Legacy app**.

- Settings and history are copied, so the original mutable data remains available for rollback.
- Recordings and models move to avoid duplicating large files.
- Provider keys move through the operating system credential store using write, read-back, and delete steps. If the system denies access to an old key, Sona starts normally and asks you to enter that key again.
- Close the Legacy app before moving data. Running both apps can make them compete for global shortcuts.

After a successful move, remove the Legacy app using the normal method for your platform. Sona never uninstalls another app. A debug-only rollback removes Sona's copied settings and history, moves recordings and models back, and discards any changes made in Sona after migration.

## Command line

```bash
sona --list-models --json
sona --list-devices
sona --transcribe-file recording.wav --repeat 3 --json

sona --toggle-transcription
sona --toggle-post-process
sona --cancel
sona --start-hidden
sona --no-tray
sona --debug
```

On macOS, the installed binary is:

```bash
/Applications/Sona.app/Contents/MacOS/sona --toggle-transcription
```

## Data locations

| Platform | Default application data directory                                          |
| -------- | --------------------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/com.aktanazat.sona`                          |
| Windows  | `%APPDATA%\com.aktanazat.sona`                                              |
| Linux    | `$XDG_DATA_HOME/com.aktanazat.sona`, or `~/.local/share/com.aktanazat.sona` |

Sona stores settings in `settings_store.json`, history in `history.db`, recordings in `recordings/`, models in `models/`, and logs in `logs/sona.log`.

### Portable mode

Create a file named `portable` next to the Sona executable. Sona writes `Sona Portable Mode` to that file and keeps its data in the adjacent `Data/` directory. Existing portable installations with the older marker remain portable and are upgraded in place.

Portable mode does not use the native credential store, so provider-backed features remain unavailable until you use a normal installation.

## Environment variables

| Variable                             | Purpose                                                 |
| ------------------------------------ | ------------------------------------------------------- |
| `SONA_NO_GTK_LAYER_SHELL=1`          | Disable the Linux GTK layer-shell overlay.              |
| `SONA_METAL_RESIDENCY=1`             | Restore the upstream Metal residency setting.           |
| `SONA_DEBUG_MIC_READY_DELAY_MS`      | Add a debug microphone-ready delay.                     |
| `SONA_FORCE_TRANSCRIPTION_FAILURE=1` | Force a debug transcription failure.                    |
| `SONA_FORCE_AI_STUB=1`               | Build the Apple Intelligence stub.                      |
| `SONA_VC_REDIST_DIRS`                | Set the Windows VC++ runtime staging directories in CI. |

## Build from source

Install current Rust and Bun, then run:

```bash
bun install
bun run prepare:agent-hook
bun run build
cd src-tauri && cargo check --all-features
```

The desktop development command is:

```bash
bun run tauri dev
```

For Linux package builds, Sona installs private runtime libraries under `/usr/lib/sona`. The package executable is `sona`.

## Troubleshooting

### Linux overlay problems

If the GTK layer-shell overlay conflicts with your compositor, start Sona with:

```bash
SONA_NO_GTK_LAYER_SHELL=1 sona
```

This uses a regular always-on-top window for the recording overlay.

### macOS permissions

Sona is a new macOS application identity. Grant Microphone and Accessibility access again after installation. To reset a stale Accessibility grant during development:

```bash
tccutil reset Accessibility com.aktanazat.sona
```

Use the settings screens to inspect the live permission state and application-data location.

## Licenses

The bundled **Open-source licenses** action opens the packaged `LICENSE` and `NOTICE` files.
