use crate::query::external::ExternalLoopStatus;
use crate::query::QueryScope;
use clap::{ArgGroup, Parser};
use std::path::PathBuf;

/* The read-only corpus flags below are one verb per invocation, so they live
 * in a clap group rather than in seven pairwise `conflicts_with`es: the group
 * is what makes `sona --meetings --loops` a usage error clap words itself,
 * and what keeps the list in one place when an eighth verb arrives. Their
 * modifiers hang off the verb they belong to with `requires`, so a flag that
 * cannot mean anything on its own says so instead of being ignored. */
#[derive(Parser, Debug, Clone, Default)]
#[command(name = "sona", about = "Sona — speech to text")]
#[command(group(ArgGroup::new("read").args([
    "query", "meetings", "meeting", "transcript", "loops", "people", "events",
])))]
#[command(group(ArgGroup::new("loop_side").args(["mine", "waiting"])))]
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

    // ── Read-only corpus queries ───────────────────────────────────────────
    // Each of these answers with one JSON value on stdout and exits. They
    // require Settings > Agents > External access, and none of them writes.
    /// Search the corpus and print the matching rows as JSON.
    #[arg(long, value_name = "TEXT")]
    pub query: Option<String>,

    /// Which nouns --query searches. Defaults to all of them.
    #[arg(long, value_enum, requires = "query")]
    pub scope: Option<QueryScope>,

    /// How many rows a read returns (max 100). Not for --meetings, which
    /// counts with --last.
    #[arg(long, value_name = "N", conflicts_with = "last")]
    pub limit: Option<usize>,

    /// List retained meetings, newest first, as JSON.
    #[arg(long)]
    pub meetings: bool,

    /// How many meetings --meetings returns (max 100).
    #[arg(long, value_name = "N", requires = "meetings")]
    pub last: Option<usize>,

    /// Earliest local day --meetings includes, as YYYY-MM-DD.
    #[arg(long, value_name = "DATE", requires = "to", conflicts_with = "last")]
    pub from: Option<String>,

    /// Latest local day --meetings includes, as YYYY-MM-DD.
    #[arg(long, value_name = "DATE", requires = "from", conflicts_with = "last")]
    pub to: Option<String>,

    /// Print one meeting — summary, notes and ledger rows — as JSON.
    #[arg(long, value_name = "MEETING_ID")]
    pub meeting: Option<String>,

    /// Print one meeting's speaker-labeled transcript as JSON.
    #[arg(long, value_name = "MEETING_ID")]
    pub transcript: Option<String>,

    /// List the corpus's open loops and commitments as JSON.
    #[arg(long)]
    pub loops: bool,

    /// Keep only loops in this state. Omit to get every state.
    #[arg(long, value_enum, requires = "loops")]
    pub status: Option<ExternalLoopStatus>,

    /// Keep only loops the user owes.
    #[arg(long, requires = "loops")]
    pub mine: bool,

    /// Keep only loops somebody else owes.
    #[arg(long, requires = "loops")]
    pub waiting: bool,

    /// Look a person up by name, alias or calendar address.
    #[arg(long, value_name = "NAME")]
    pub people: Option<String>,

    /// List what has happened to the corpus, newest first, as JSON.
    #[arg(long)]
    pub events: bool,

    /// Resume --events after this event id.
    #[arg(long, value_name = "EVENT_ID", requires = "events")]
    pub after: Option<String>,

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
