use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug, Clone, Default)]
#[command(name = "sona", about = "Sona — speech to text")]
pub struct CliArgs {
    /// Start with the main window hidden
    #[arg(long)]
    pub start_hidden: bool,

    /// Disable the system tray icon
    #[arg(long)]
    pub no_tray: bool,

    /// Toggle transcription on/off (sent to running instance)
    #[arg(long)]
    pub toggle_transcription: bool,

    /// Toggle transcription with post-processing on/off (sent to running instance)
    #[arg(long)]
    pub toggle_post_process: bool,

    /// Cancel the current operation (sent to running instance)
    #[arg(long)]
    pub cancel: bool,

    /// Enable debug mode with verbose logging
    #[arg(long)]
    pub debug: bool,

    /// Transcribe this WAV (16 kHz mono) headlessly and exit. Runs the same
    /// batch transcription path as the app — no mic, no VAD, no download
    /// (the model must already be installed).
    #[arg(short = 'f', long, value_name = "WAV")]
    pub transcribe_file: Option<PathBuf>,

    /// Model id to load for --transcribe-file (default: the selected model).
    #[arg(long)]
    pub model: Option<String>,

    /// Hard-select the compute device for --transcribe-file by its registry
    /// index (see --list-devices). Omit to use the persisted accelerator
    /// setting. transcribe-cpp (whisper-family) models only.
    #[arg(long, value_name = "N")]
    pub device_index: Option<usize>,

    /// List the transcribe-cpp compute devices (with indices) and exit.
    #[arg(long)]
    pub list_devices: bool,

    /// List the available models (with ids) and exit. Pass an id to --model.
    /// Honors --json for machine-readable output.
    #[arg(long)]
    pub list_models: bool,

    /// Print the Agent Panel public identity and exit. No private key is exposed.
    #[arg(long)]
    pub agent_panel_public_identity: bool,

    /// Repeat the transcription N times (best_ms reports the fastest run).
    #[arg(long, value_name = "N")]
    pub repeat: Option<usize>,

    /// Emit --transcribe-file results as JSON.
    #[arg(long)]
    pub json: bool,
    /// Audio file paths supplied by an operating-system Open With action.
    /// They enter the GUI import queue and never trigger direct delivery.
    #[arg(value_name = "AUDIO", num_args = 0..)]
    pub opened_audio_files: Vec<PathBuf>,
}

#[cfg(test)]
mod tests {
    use super::CliArgs;
    use clap::Parser;
    use std::path::PathBuf;

    #[test]
    fn parses_open_with_paths_without_entering_headless_mode() {
        let args = CliArgs::try_parse_from(["sona", "/tmp/example.flac"])
            .expect("parse an operating-system file argument");
        assert_eq!(
            args.opened_audio_files,
            vec![PathBuf::from("/tmp/example.flac")]
        );
        assert!(args.transcribe_file.is_none());
    }
    #[test]
    fn parses_agent_panel_public_identity_flag() {
        let args = CliArgs::try_parse_from(["sona", "--agent-panel-public-identity"])
            .expect("parse the public identity flag");
        assert!(args.agent_panel_public_identity);
        assert!(args.opened_audio_files.is_empty());
    }
}
