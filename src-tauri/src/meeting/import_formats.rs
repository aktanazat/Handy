//! Readers for the transcript exports other note-takers produce.
//!
//! Each vendor's documented shape is cited beside the parser that reads it, and
//! one sample of that shape lives in `fixtures/` so a format change shows up as
//! a failing test rather than as a meeting with no transcript. Nothing here
//! reaches the network: a reader is handed bytes that are already on disk.
//!
//! Detection is by content, not by file name. An export renamed on the way out
//! of a download folder is still the same export, and the three shapes are
//! unambiguous: JSON starts with a bracket, SubRip has an arrow in its timing
//! line, and Otter's text export has a clock at the end of each turn's first
//! line.

use serde::Deserialize;
use std::fs;
use std::path::Path;

/// The largest transcript export Sona will read. Plain text at this size is
/// tens of hours of speech, so a file past it is not a transcript, and the
/// reader holds the whole thing at once — unlike the audio path, which streams.
const MAX_TRANSCRIPT_EXPORT_BYTES: u64 = 32 * 1024 * 1024;

/// How long the last segment of a timestamped export is assumed to run when the
/// vendor states a start and no end. Only the final segment needs it: every
/// earlier one ends where the next begins.
const TRAILING_SEGMENT_MS: u64 = 2_000;

/// One vendor's export, read into the fields Sona can build a meeting from.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportedTranscript {
    pub title: String,
    /// When the conversation happened, if the export says. Granola stamps
    /// absolute times; Otter and Circleback are relative to their own zero.
    pub started_at_utc_ms: Option<i64>,
    pub segments: Vec<ImportedSegment>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportedSegment {
    pub speaker: Option<String>,
    pub start_ms: Option<u64>,
    pub end_ms: Option<u64>,
    pub text: String,
}

/// Why an export was refused. The string is for the log; every refusal reaches
/// the operator as the same typed command error, because they all have the same
/// answer: this file is not an export Sona can read, so pick another one.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TranscriptImportError(pub &'static str);

/// Read one transcript export from disk. The file stem is the title for the
/// formats that do not carry one.
pub fn read_transcript_export(path: &Path) -> Result<ImportedTranscript, TranscriptImportError> {
    let metadata =
        fs::metadata(path).map_err(|_| TranscriptImportError("transcript file is unreadable"))?;
    if !metadata.file_type().is_file() {
        return Err(TranscriptImportError("transcript path is not a file"));
    }
    if metadata.len() > MAX_TRANSCRIPT_EXPORT_BYTES {
        return Err(TranscriptImportError("transcript file is too large"));
    }
    let contents =
        fs::read_to_string(path).map_err(|_| TranscriptImportError("transcript is not UTF-8"))?;
    let file_stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    parse_transcript_export(&file_stem, &contents)
}

/// The pure half: pick the reader the content matches and run it.
pub fn parse_transcript_export(
    file_stem: &str,
    contents: &str,
) -> Result<ImportedTranscript, TranscriptImportError> {
    let trimmed = contents.trim_start();
    let parsed = if trimmed.starts_with('[') || trimmed.starts_with('{') {
        parse_json_export(file_stem, trimmed)
    } else if looks_like_subrip(contents) {
        parse_subrip(file_stem, contents)
    } else {
        parse_otter_text(file_stem, contents)
    }?;
    if parsed.segments.is_empty() {
        return Err(TranscriptImportError("export contains no transcript"));
    }
    Ok(parsed)
}

/// Fill in the ends the vendor left out, and give an untimed export a synthetic
/// timeline. Offsets on an imported transcript are an ordering and anchoring
/// device — there is no audio to seek — but every citation, catch-up window and
/// analytics pass reads them, so they have to be present and strictly forward.
pub fn resolve_spans(segments: &[ImportedSegment]) -> Vec<(u64, u64)> {
    let mut spans: Vec<(u64, u64)> = Vec::with_capacity(segments.len());
    for (index, segment) in segments.iter().enumerate() {
        let previous_end = spans.last().map_or(0, |(_, end)| *end);
        let start = segment.start_ms.unwrap_or(previous_end).max(previous_end);
        let next_start = segments[index.saturating_add(1)..]
            .iter()
            .find_map(|later| later.start_ms);
        let end = segment
            .end_ms
            .or(next_start)
            .filter(|end| *end > start)
            .unwrap_or_else(|| start.saturating_add(TRAILING_SEGMENT_MS));
        spans.push((start, end));
    }
    spans
}

fn looks_like_subrip(contents: &str) -> bool {
    contents
        .lines()
        .take(8)
        .any(|line| line.contains("-->") && line.contains(','))
}

// ---------------------------------------------------------------------------
// Granola and Circleback: JSON.
// ---------------------------------------------------------------------------

/// Granola's transcript item.
/// <https://docs.granola.ai/api-reference/get-transcript>
///
/// Unknown fields are accepted on purpose: this is another product's payload,
/// and a field Granola adds must not stop an export from importing.
#[derive(Debug, Deserialize)]
struct GranolaExport {
    title: Option<String>,
    transcript: Vec<GranolaItem>,
}

#[derive(Debug, Deserialize)]
struct GranolaItem {
    speaker: GranolaSpeaker,
    text: String,
    start_time: String,
    end_time: String,
}

#[derive(Debug, Deserialize)]
struct GranolaSpeaker {
    /// The resolved person, when Granola identified one.
    name: Option<String>,
    /// The anonymous diarization bucket (`Speaker A`), on mobile transcripts.
    diarization_label: Option<String>,
}

/// Circleback's transcript segment.
/// <https://circleback.ai/docs/api/meetings/get-meeting-transcript>
#[derive(Debug, Deserialize)]
struct CirclebackSegment {
    speaker: Option<String>,
    text: String,
    /// Seconds from the start of the meeting.
    timestamp: f64,
}

fn parse_json_export(
    file_stem: &str,
    contents: &str,
) -> Result<ImportedTranscript, TranscriptImportError> {
    if contents.starts_with('[') {
        let segments: Vec<CirclebackSegment> = serde_json::from_str(contents)
            .map_err(|_| TranscriptImportError("not a Circleback transcript export"))?;
        return Ok(ImportedTranscript {
            title: file_stem.to_string(),
            started_at_utc_ms: None,
            segments: segments
                .into_iter()
                .filter(|segment| !segment.text.trim().is_empty())
                .map(|segment| ImportedSegment {
                    speaker: trimmed_name(segment.speaker.as_deref()),
                    start_ms: seconds_to_ms(segment.timestamp),
                    end_ms: None,
                    text: segment.text.trim().to_string(),
                })
                .collect(),
        });
    }
    let export: GranolaExport = serde_json::from_str(contents)
        .map_err(|_| TranscriptImportError("not a Granola transcript export"))?;
    // Granola stamps every item with a wall clock, so the meeting's own zero is
    // its first item and the session start is that instant.
    let anchor_ms = export
        .transcript
        .iter()
        .filter_map(|item| rfc3339_ms(&item.start_time))
        .min();
    let segments = export
        .transcript
        .into_iter()
        .filter(|item| !item.text.trim().is_empty())
        .map(|item| ImportedSegment {
            speaker: trimmed_name(
                item.speaker
                    .name
                    .as_deref()
                    .or(item.speaker.diarization_label.as_deref()),
            ),
            start_ms: offset_from(anchor_ms, &item.start_time),
            end_ms: offset_from(anchor_ms, &item.end_time),
            text: item.text.trim().to_string(),
        })
        .collect();
    Ok(ImportedTranscript {
        title: export
            .title
            .as_deref()
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .unwrap_or(file_stem)
            .to_string(),
        started_at_utc_ms: anchor_ms,
        segments,
    })
}

fn offset_from(anchor_ms: Option<i64>, value: &str) -> Option<u64> {
    let anchor = anchor_ms?;
    u64::try_from(rfc3339_ms(value)?.checked_sub(anchor)?).ok()
}

fn rfc3339_ms(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|stamp| stamp.timestamp_millis())
}

fn seconds_to_ms(seconds: f64) -> Option<u64> {
    (seconds.is_finite() && seconds >= 0.0).then_some((seconds * 1_000.0) as u64)
}

// ---------------------------------------------------------------------------
// Otter: SubRip and plain text.
// ---------------------------------------------------------------------------

/// Otter's SRT export, one cue per turn, with the speaker name prefixed onto
/// the cue text when "Show speaker names" is on.
/// <https://help.otter.ai/hc/en-us/articles/11742706003735-Create-captions-subtitles-for-your-video>
fn parse_subrip(
    file_stem: &str,
    contents: &str,
) -> Result<ImportedTranscript, TranscriptImportError> {
    let mut segments = Vec::new();
    for block in paragraphs(contents) {
        let Some(timing_index) = block.iter().position(|line| line.contains("-->")) else {
            continue;
        };
        let Some((start_ms, end_ms)) = parse_subrip_timing(block[timing_index]) else {
            return Err(TranscriptImportError("SubRip cue has an unreadable timing"));
        };
        let body = block[timing_index.saturating_add(1)..].join(" ");
        let (speaker, text) = split_speaker_prefix(body.trim());
        if text.is_empty() {
            continue;
        }
        segments.push(ImportedSegment {
            speaker,
            start_ms: Some(start_ms),
            end_ms: Some(end_ms),
            text,
        });
    }
    Ok(ImportedTranscript {
        title: file_stem.to_string(),
        started_at_utc_ms: None,
        segments,
    })
}

fn parse_subrip_timing(line: &str) -> Option<(u64, u64)> {
    let (start, end) = line.split_once("-->")?;
    Some((parse_subrip_clock(start)?, parse_subrip_clock(end)?))
}

fn parse_subrip_clock(value: &str) -> Option<u64> {
    let value = value.trim();
    let (clock, millis) = match value.split_once(',').or_else(|| value.split_once('.')) {
        Some((clock, millis)) => (clock, millis.parse::<u64>().ok()?),
        None => (value, 0),
    };
    parse_clock(clock)?.checked_add(millis)
}

/// A speaker label Otter prefixes onto cue text: everything before the first
/// colon, when that prefix is short and reads like a name rather than like a
/// sentence that happens to contain one.
fn split_speaker_prefix(body: &str) -> (Option<String>, String) {
    let candidate = body
        .split_once(':')
        .filter(|(prefix, _)| {
            !prefix.is_empty()
                && prefix.len() <= 64
                && !prefix.contains(['.', '?', '!'])
                && prefix.split_whitespace().count() <= 6
        })
        .map(|(prefix, rest)| (prefix.trim().to_string(), rest.trim().to_string()));
    match candidate {
        Some((speaker, text)) if !text.is_empty() => (Some(speaker), text),
        _ => (None, body.to_string()),
    }
}

/// Otter's plain-text export: an optional title and branding header, then one
/// paragraph per turn whose first line ends with the turn's clock.
/// <https://help.otter.ai/hc/en-us/articles/360047733634-Export-conversations>
///
/// A turn is recognised by that clock. An export with both "Show speaker names"
/// and "Show timestamps" turned off is indistinguishable from any other text
/// document, and is refused rather than guessed at.
fn parse_otter_text(
    file_stem: &str,
    contents: &str,
) -> Result<ImportedTranscript, TranscriptImportError> {
    let mut title = None;
    let mut segments: Vec<ImportedSegment> = Vec::new();
    for block in paragraphs(contents) {
        let Some(head) = block.first() else { continue };
        match parse_turn_header(head) {
            Some((speaker, start_ms)) => {
                let text = block[1..].join(" ").trim().to_string();
                if text.is_empty() {
                    continue;
                }
                segments.push(ImportedSegment {
                    speaker,
                    start_ms: Some(start_ms),
                    end_ms: None,
                    text,
                });
            }
            // Everything before the first turn is Otter's header. Its first
            // line is the conversation name; the branding line below it is not.
            None if segments.is_empty() => title = title.or_else(|| trimmed_name(Some(head))),
            None => {
                if let Some(last) = segments.last_mut() {
                    last.text.push(' ');
                    last.text.push_str(block.join(" ").trim());
                }
            }
        }
    }
    if segments.is_empty() {
        return Err(TranscriptImportError("no Otter turns found in the export"));
    }
    Ok(ImportedTranscript {
        title: title.unwrap_or_else(|| file_stem.to_string()),
        started_at_utc_ms: None,
        segments,
    })
}

/// `Speaker Name  1:04` — the speaker is whatever precedes the clock, and an
/// export with speaker names off leaves the clock alone on the line.
fn parse_turn_header(line: &str) -> Option<(Option<String>, u64)> {
    let line = line.trim_end();
    let (head, clock) = line.rsplit_once(char::is_whitespace).unwrap_or(("", line));
    Some((trimmed_name(Some(head)), parse_clock(clock)?))
}

/// `M:SS` or `H:MM:SS` as milliseconds.
fn parse_clock(value: &str) -> Option<u64> {
    let mut parts = value.trim().split(':').rev();
    let seconds = parts.next()?.parse::<u64>().ok()?;
    let minutes = parts.next()?.parse::<u64>().ok()?;
    let hours = match parts.next() {
        Some(hours) => hours.parse::<u64>().ok()?,
        None => 0,
    };
    if parts.next().is_some() || seconds >= 60 || minutes >= 60 {
        return None;
    }
    hours
        .checked_mul(3_600)?
        .checked_add(minutes.checked_mul(60)?)?
        .checked_add(seconds)?
        .checked_mul(1_000)
}

/// Blank-line separated blocks, each as its non-empty lines.
fn paragraphs(contents: &str) -> Vec<Vec<&str>> {
    let mut blocks = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    for line in contents.lines() {
        if line.trim().is_empty() {
            if !current.is_empty() {
                blocks.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(line.trim());
    }
    if !current.is_empty() {
        blocks.push(current);
    }
    blocks
}

fn trimmed_name(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    const OTTER_TEXT: &str = include_str!("fixtures/otter_export.txt");
    const OTTER_SRT: &str = include_str!("fixtures/otter_export.srt");
    const GRANOLA: &str = include_str!("fixtures/granola_note.json");
    const CIRCLEBACK: &str = include_str!("fixtures/circleback_transcript.json");

    #[test]
    fn otter_text_export_keeps_speakers_and_turn_clocks() {
        let parsed = parse_transcript_export("otter_export", OTTER_TEXT).unwrap();

        assert_eq!(parsed.title, "Weekly product sync");
        assert_eq!(parsed.started_at_utc_ms, None);
        assert_eq!(
            parsed.segments,
            vec![
                ImportedSegment {
                    speaker: Some("Priya Raman".to_string()),
                    start_ms: Some(2_000),
                    end_ms: None,
                    text:
                        "Let's start with the pricing page. The new tiers are live behind a flag."
                            .to_string(),
                },
                ImportedSegment {
                    speaker: Some("Tom Alvarez".to_string()),
                    start_ms: Some(19_000),
                    end_ms: None,
                    text: "I can flip the flag on Thursday once the copy review is done."
                        .to_string(),
                },
                ImportedSegment {
                    speaker: Some("Priya Raman".to_string()),
                    start_ms: Some(64_000),
                    end_ms: None,
                    text: "Thursday works. I'll write the changelog entry today.".to_string(),
                },
            ]
        );
    }

    #[test]
    fn otter_srt_export_joins_wrapped_cue_lines() {
        let parsed = parse_transcript_export("otter_export", OTTER_SRT).unwrap();

        assert_eq!(
            parsed.segments,
            vec![
                ImportedSegment {
                    speaker: Some("Priya Raman".to_string()),
                    start_ms: Some(2_000),
                    end_ms: Some(11_480),
                    text: "Let's start with the pricing page.".to_string(),
                },
                ImportedSegment {
                    speaker: Some("Tom Alvarez".to_string()),
                    start_ms: Some(19_120),
                    end_ms: Some(24_600),
                    text: "I can flip the flag on Thursday once the copy review is done."
                        .to_string(),
                },
                ImportedSegment {
                    speaker: Some("Priya Raman".to_string()),
                    start_ms: Some(64_000),
                    end_ms: Some(69_250),
                    text: "Thursday works.".to_string(),
                },
            ]
        );
    }

    #[test]
    fn granola_export_anchors_absolute_stamps_to_the_first_item() {
        let parsed = parse_transcript_export("granola_note", GRANOLA).unwrap();

        assert_eq!(parsed.title, "Quarterly yoghurt budget review");
        assert_eq!(parsed.started_at_utc_ms, Some(1_775_660_404_000));
        assert_eq!(
            parsed.segments,
            vec![
                ImportedSegment {
                    speaker: Some("Oat Benson".to_string()),
                    start_ms: Some(0),
                    end_ms: Some(5_500),
                    text: "I'm done pretending. Greek is the only yoghurt that deserves us."
                        .to_string(),
                },
                ImportedSegment {
                    speaker: Some("Speaker B".to_string()),
                    start_ms: Some(6_250),
                    end_ms: Some(10_000),
                    text: "Finally. Regular yoghurt is just milk that gave up halfway.".to_string(),
                },
            ]
        );
    }

    #[test]
    fn circleback_export_carries_a_null_speaker_through() {
        let parsed = parse_transcript_export("circleback_transcript", CIRCLEBACK).unwrap();

        assert_eq!(parsed.title, "circleback_transcript");
        assert_eq!(
            parsed.segments,
            vec![
                ImportedSegment {
                    speaker: Some("John Appleseed".to_string()),
                    start_ms: Some(4_560),
                    end_ms: None,
                    text: "Hey, how's it going?".to_string(),
                },
                ImportedSegment {
                    speaker: Some("Samantha Grey".to_string()),
                    start_ms: Some(18_320),
                    end_ms: None,
                    text: "Going well, just testing the Circleback API.".to_string(),
                },
                ImportedSegment {
                    speaker: None,
                    start_ms: Some(32_000),
                    end_ms: None,
                    text: "Sorry, joining late.".to_string(),
                },
            ]
        );
    }

    #[test]
    fn prose_with_no_turns_is_refused() {
        assert!(parse_transcript_export(
            "notes",
            "Some notes I typed after the call.\n\nThey are not a transcript.\n",
        )
        .is_err());
        assert!(parse_transcript_export("empty", "").is_err());
        assert!(parse_transcript_export("truncated", "{\"transcript\": [").is_err());
        assert!(parse_transcript_export("wrong-json", "[{\"line\": \"hello\"}]").is_err());
    }

    #[test]
    fn a_cue_with_a_broken_clock_refuses_the_whole_file() {
        assert_eq!(
            parse_transcript_export("otter", "1\n00:00:02,000 --> later\nHello.\n"),
            Err(TranscriptImportError("SubRip cue has an unreadable timing")),
        );
    }

    /// Every span moves forward and none is empty, whatever the vendor left
    /// out: `append_transcript_segments` rejects a segment that does not.
    #[test]
    fn spans_stay_forward_when_ends_are_missing() {
        let spans = resolve_spans(&[
            ImportedSegment {
                speaker: None,
                start_ms: Some(4_560),
                end_ms: None,
                text: "one".to_string(),
            },
            ImportedSegment {
                speaker: None,
                start_ms: None,
                end_ms: None,
                text: "two".to_string(),
            },
            ImportedSegment {
                speaker: None,
                start_ms: Some(18_320),
                end_ms: None,
                text: "three".to_string(),
            },
        ]);

        assert_eq!(
            spans,
            vec![(4_560, 18_320), (18_320, 20_320), (20_320, 22_320)]
        );
        assert!(spans.windows(2).all(|pair| pair[0].1 <= pair[1].0));
        assert!(spans.iter().all(|(start, end)| start < end));
    }

    /// A vendor that hands back an out-of-order or duplicated stamp must not
    /// produce a segment the store refuses.
    #[test]
    fn spans_absorb_a_stamp_that_goes_backwards() {
        let spans = resolve_spans(&[
            ImportedSegment {
                speaker: None,
                start_ms: Some(10_000),
                end_ms: Some(12_000),
                text: "one".to_string(),
            },
            ImportedSegment {
                speaker: None,
                start_ms: Some(4_000),
                end_ms: Some(6_000),
                text: "two".to_string(),
            },
        ]);

        assert_eq!(spans, vec![(10_000, 12_000), (12_000, 14_000)]);
    }
}
