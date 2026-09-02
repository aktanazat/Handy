//! The `where-did-we-land` evals, run against Sona's own ledger.
//!
//! Upstream keeps two kinds of check, because two different things break: a
//! structural script that reads a finished page, and behavioural scenarios a
//! person runs by hand and grades against a rubric. `ledger::check` is the
//! script. This module is the scenario that has a rubric a machine can read,
//! `evals/02-messy-two-party.md`: a thread that loops back, a real decision, a
//! question asked out loud and never answered, and a thread dropped
//! mid-sentence on a topic switch. Upstream's other scenario, the trigger
//! phrasings, has no port: Sona reads a ledger from every meeting rather than
//! on a phrase, and the half of it that still applies — a ledger never
//! replaces the summary or the action list — is a frontend test.
//!
//! Offline, on one fixture: the transcript, transcribed from upstream into the
//! shape Sona's importer reads, and a hand-written expected ledger in the
//! shape the model is asked for. The expected ledger has to pass the
//! structural checks and every rubric line, and a ledger mutated in each of
//! the ways the checks exist for has to fail the one check that names it.
//!
//! Segment ids are `00000000-0000-0000-0000-000000000NNN`, `NNN` the 1-based
//! turn number in the transcript fixture, so a citation in the expected
//! ledger can be read against the transcript without a lookup.

use super::analytics::{merge_turns, talk_metrics, AnalyticsSegment, MeetingNotesTemplate};
use super::import_formats::{parse_transcript_export, resolve_spans};
use super::ledger::{
    self, fold, CheckFailure, LedgerFirmness, LedgerPage, LedgerPageInput, LedgerReceipt,
    LedgerThreadState, MeetingLedger,
};
use super::processing::{validate_ledger_output, RawLedgerOutput};
use super::store::{ArtifactEvidence, MeetingEvidence};
use super::types::{CitationKind, MeetingCitation, MeetingSessionId, SpeakerId, TranscriptSegmentId};
use std::collections::HashMap;
use uuid::Uuid;

const TRANSCRIPT: &str = include_str!("fixtures/ledger_evals/messy_two_party.json");
const EXPECTED: &str = include_str!("fixtures/ledger_evals/messy_two_party.ledger.json");

/// The clock, in milliseconds, of each turn the rubric names. The transcript
/// fixture carries upstream's `m:ss` headers, so these are readable off it.
const SMALL_TALK_ENDS_MS: u64 = 14_000;
const TRIAL_QUESTION_MS: u64 = 62_000;
const ONBOARDING_EMAILS_MS: u64 = 109_000;
const COMPARISON_TABLE_MS: u64 = 184_000;
const LOOP_BACK_MS: u64 = 211_000;
const SIGN_OFF_MS: u64 = 264_000;

fn segment_id(turn: usize) -> TranscriptSegmentId {
    TranscriptSegmentId::from_uuid(
        Uuid::parse_str(&format!("00000000-0000-0000-0000-{turn:012}")).expect("turn id"),
    )
}

/// The transcript fixture, read the way an import reads it and held in both
/// shapes the ledger pass needs: the evidence the model is shown, and the
/// diarized segments the page is measured from.
struct Fixture {
    segments: Vec<AnalyticsSegment>,
    evidence: ArtifactEvidence,
    speaker_names: HashMap<SpeakerId, String>,
}

fn fixture(session_id: MeetingSessionId) -> Fixture {
    let imported = parse_transcript_export("messy_two_party", TRANSCRIPT).expect("fixture parses");
    let spans = resolve_spans(&imported.segments);
    let mut speakers: HashMap<String, SpeakerId> = HashMap::new();
    let mut segments = Vec::new();
    let mut transcript = Vec::new();
    for (index, (segment, (start_ms, end_ms))) in imported.segments.iter().zip(spans).enumerate() {
        let name = segment.speaker.clone().expect("every turn is attributed");
        let next = speakers.len() + 1;
        let speaker_id = *speakers
            .entry(name)
            .or_insert_with(|| SpeakerId::from_uuid(Uuid::from_u128(next as u128)));
        let segment_id = segment_id(index + 1);
        let start_offset_ns = start_ms * 1_000_000;
        let end_offset_ns = end_ms * 1_000_000;
        segments.push(AnalyticsSegment {
            segment_id,
            speaker_id,
            start_offset_ns,
            end_offset_ns,
            text: segment.text.clone(),
        });
        transcript.push(MeetingEvidence {
            citation: MeetingCitation {
                kind: CitationKind::Transcript,
                session_id,
                entity_id: segment_id.uuid().to_string(),
                start_offset_ns: Some(start_offset_ns),
                end_offset_ns: Some(end_offset_ns),
            },
            text: segment.text.clone(),
        });
    }
    Fixture {
        segments,
        evidence: ArtifactEvidence {
            transcript,
            manual_notes: Vec::new(),
            user_notes: String::new(),
            template: MeetingNotesTemplate::General,
        },
        speaker_names: speakers
            .into_iter()
            .map(|(name, speaker_id)| (speaker_id, name))
            .collect(),
    }
}

impl Fixture {
    fn haystack(&self) -> String {
        ledger::fold_haystack(self.evidence.transcript.iter().map(|item| item.text.as_str()))
    }

    /// The page this ledger renders as, built the way the exporter builds it.
    fn page(&self, ledger: &MeetingLedger) -> LedgerPage {
        self.page_over(ledger, &self.segments)
    }

    fn page_over(&self, ledger: &MeetingLedger, segments: &[AnalyticsSegment]) -> LedgerPage {
        let segment_speakers: HashMap<TranscriptSegmentId, SpeakerId> = segments
            .iter()
            .map(|segment| (segment.segment_id, segment.speaker_id))
            .collect();
        ledger::build_page(LedgerPageInput {
            title: "Pricing sync",
            kind: "Meeting",
            date: None,
            duration_ns: segments
                .iter()
                .map(|segment| segment.end_offset_ns)
                .max()
                .unwrap_or(0),
            ledger,
            talk: &talk_metrics(segments),
            turns: &merge_turns(segments),
            speaker_names: &self.speaker_names,
            segment_speakers: &segment_speakers,
        })
    }

    /// The hand-written answer, through the same validation a generated one
    /// gets, so its timestamps are derived from its citations and never
    /// written by hand.
    fn expected(&self) -> MeetingLedger {
        let raw: RawLedgerOutput = serde_json::from_str(EXPECTED).expect("expected ledger parses");
        validate_ledger_output(&raw, &self.evidence.transcript).expect("expected ledger validates")
    }
}

// ── the rubric ──────────────────────────────────────────────────────────────
//
// Upstream's pass rubric, one line each, graded on the ledger and on the page
// it renders as. Threads are found by the moment they cite or the words they
// quote rather than by their label, because a label is the model's own.

struct Subject<'a> {
    ledger: &'a MeetingLedger,
    page: &'a LedgerPage,
    haystack: &'a str,
}

#[derive(Clone, Copy, Debug)]
enum Rubric {
    Structural,
    LoopBack,
    Decision,
    Unanswered,
    Dropped,
    Action,
    Verbatim,
    Stance,
    SmallTalk,
}

impl Rubric {
    const ALL: [Self; 9] = [
        Self::Structural,
        Self::LoopBack,
        Self::Decision,
        Self::Unanswered,
        Self::Dropped,
        Self::Action,
        Self::Verbatim,
        Self::Stance,
        Self::SmallTalk,
    ];

    const fn line(self) -> &'static str {
        match self {
            Self::Structural => "check_ledger.py exits 0",
            Self::LoopBack => "Pricing tiers -> open, with two segments on the timeline",
            Self::Decision => "Annual versus monthly -> decided or agreed, with its receipt",
            Self::Unanswered => "Which tier does the trial convert into? -> unanswered, in open loops",
            Self::Dropped => "Onboarding email copy -> dropped, in open loops",
            Self::Action => "Tier comparison table -> action, owner Amir, firm",
            Self::Verbatim => "Receipts keep the disfluencies",
            Self::Stance => "stances records that Amir agreed to annual-only",
            Self::SmallTalk => "Small talk and the sign-off are substantive: false",
        }
    }

    fn holds(self, subject: &Subject<'_>) -> Result<(), String> {
        let ledger = subject.ledger;
        let threads_at = |at_ms: u64, until_ms: u64| {
            ledger
                .threads
                .iter()
                .filter(move |thread| (at_ms..until_ms).contains(&thread.receipt.t_ms))
        };
        let loops_mentioning = |word: &str| {
            ledger
                .open_loops
                .iter()
                .any(|loop_| fold(&loop_.question).contains(word) || fold(&loop_.instead).contains(word))
        };
        match self {
            Self::Structural => {
                let failures = ledger::check(ledger, subject.page, subject.haystack);
                if failures.is_empty() {
                    Ok(())
                } else {
                    Err(format!("{failures:?}"))
                }
            }
            Self::LoopBack => {
                let looped = ledger
                    .threads
                    .iter()
                    .zip(&subject.page.topics)
                    .any(|(thread, topic)| {
                        thread.state == LedgerThreadState::Open
                            && topic.segs.iter().any(|seg| {
                                (SMALL_TALK_ENDS_MS / 1_000..TRIAL_QUESTION_MS / 1_000).contains(&seg.0)
                            })
                            && topic.segs.iter().any(|seg| {
                                (LOOP_BACK_MS / 1_000..SIGN_OFF_MS / 1_000).contains(&seg.0)
                            })
                    });
                looped.then_some(()).ok_or_else(|| {
                    "no open thread cites both the opening pricing stretch and the loop-back".to_string()
                })
            }
            Self::Decision => {
                let landed = ledger.threads.iter().any(|thread| {
                    matches!(
                        thread.state,
                        LedgerThreadState::Decided | LedgerThreadState::Agreed
                    ) && {
                        let quote = fold(&thread.receipt.quote);
                        quote.contains("let's do annual only at launch")
                            || quote.contains("annual only, monthly in q3")
                    }
                });
                landed
                    .then_some(())
                    .ok_or_else(|| "no decided or agreed thread quotes the annual-only decision".to_string())
            }
            Self::Unanswered => {
                let asked: Vec<_> = threads_at(TRIAL_QUESTION_MS, ONBOARDING_EMAILS_MS)
                    .filter(|thread| {
                        fold(&thread.receipt.quote).contains("which tier does the trial convert into")
                    })
                    .collect();
                if asked.is_empty() {
                    return Err("no thread quotes the trial question".to_string());
                }
                if let Some(thread) = asked.iter().find(|thread| {
                    matches!(
                        thread.state,
                        LedgerThreadState::Agreed | LedgerThreadState::Closed
                    )
                }) {
                    return Err(format!("the trial question is {:?}; hard fail", thread.state));
                }
                if !asked
                    .iter()
                    .any(|thread| thread.state == LedgerThreadState::Unanswered)
                {
                    return Err("the trial question is not unanswered".to_string());
                }
                loops_mentioning("trial")
                    .then_some(())
                    .ok_or_else(|| "the trial question never reached open loops".to_string())
            }
            Self::Dropped => {
                let dropped = threads_at(ONBOARDING_EMAILS_MS, ONBOARDING_EMAILS_MS + 19_000)
                    .any(|thread| thread.state == LedgerThreadState::Dropped)
                    || ledger.threads.iter().any(|thread| {
                        thread.state == LedgerThreadState::Dropped
                            && fold(&thread.receipt.quote).contains("onboarding")
                    });
                if !dropped {
                    return Err("no dropped thread cites the onboarding emails".to_string());
                }
                (loops_mentioning("onboarding") || loops_mentioning("email"))
                    .then_some(())
                    .ok_or_else(|| "the onboarding emails never reached open loops".to_string())
            }
            Self::Action => {
                let owned = ledger.threads.iter().any(|thread| {
                    thread.state == LedgerThreadState::Action
                        && thread.owner.as_deref().is_some_and(|owner| fold(owner).contains("amir"))
                        && ((COMPARISON_TABLE_MS..LOOP_BACK_MS).contains(&thread.receipt.t_ms)
                            || fold(&thread.receipt.quote).contains("feature matrix"))
                });
                if !owned {
                    return Err("no action thread owned by Amir cites the comparison table".to_string());
                }
                let committed = ledger.commitments.iter().any(|commitment| {
                    fold(&commitment.who).contains("amir")
                        && commitment.firmness == LedgerFirmness::Firm
                        && {
                            let what = fold(&commitment.what);
                            what.contains("comparison") || what.contains("table")
                        }
                });
                committed
                    .then_some(())
                    .ok_or_else(|| "no firm commitment by Amir for the comparison table".to_string())
            }
            Self::Verbatim => {
                let receipts: Vec<&LedgerReceipt> = ledger
                    .threads
                    .iter()
                    .map(|thread| &thread.receipt)
                    .chain(ledger.commitments.iter().map(|commitment| &commitment.receipt))
                    .collect();
                let quotes: Vec<String> = receipts.iter().map(|receipt| fold(&receipt.quote)).collect();
                if !quotes.iter().any(|quote| quote.contains("we keep, we keep circling it")) {
                    return Err("no receipt keeps \"we keep, we keep circling it\"".to_string());
                }
                if let Some(tidied) = quotes.iter().find(|quote| {
                    quote.contains("because we keep circling it")
                        || (quote.contains("mostly formatting")
                            && !quote.contains("it's mostly, it's mostly formatting"))
                }) {
                    return Err(format!("a receipt was tidied: {tidied:?}"));
                }
                Ok(())
            }
            Self::Stance => ledger
                .stances
                .iter()
                .any(|stance| {
                    fold(&stance.from).contains("amir")
                        && (fold(&stance.what).contains("annual")
                            || stance.note.as_deref().is_some_and(|note| fold(note).contains("annual")))
                })
                .then_some(())
                .ok_or_else(|| "no stance records Amir taking up annual-only".to_string()),
            Self::SmallTalk => {
                for (name, at_ms, until_ms) in [
                    ("the opening", 0, SMALL_TALK_ENDS_MS),
                    ("the sign-off", SIGN_OFF_MS, u64::MAX),
                ] {
                    let mut threads = threads_at(at_ms, until_ms).peekable();
                    if threads.peek().is_none() {
                        return Err(format!("no thread is cited at {name}"));
                    }
                    if threads.any(|thread| thread.substantive) {
                        return Err(format!("{name} is marked substantive"));
                    }
                }
                Ok(())
            }
        }
    }
}

fn subject_holds(fixture: &Fixture, ledger: &MeetingLedger, rubric: Rubric) -> Result<(), String> {
    let page = fixture.page(ledger);
    let haystack = fixture.haystack();
    rubric.holds(&Subject {
        ledger,
        page: &page,
        haystack: &haystack,
    })
}

// ── offline ─────────────────────────────────────────────────────────────────

#[test]
fn the_transcript_reads_as_the_conversation_upstream_wrote() {
    let fixture = fixture(MeetingSessionId::new());
    let page = fixture.page(&fixture.expected());
    // Upstream: turn count is around 30, not 100+; both took a similar number
    // of turns; talk share leans to Dana. Sona shares by span rather than by
    // words, which is why the lean is looser here than upstream's 75/25.
    assert_eq!(page.turns.len(), 30);
    assert_eq!(page.talk_share[0].name, "Dana Whitfield");
    assert!((600..=850).contains(&page.talk_share[0].share_permille));
    assert_eq!(page.talk_share[0].turn_count, 15);
    assert_eq!(page.talk_share[1].turn_count, 15);
}

#[test]
fn the_expected_ledger_passes_every_structural_check() {
    let fixture = fixture(MeetingSessionId::new());
    let expected = fixture.expected();
    let page = fixture.page(&expected);
    assert_eq!(ledger::check(&expected, &page, &fixture.haystack()), Vec::new());
}

#[test]
fn the_loop_back_thread_has_two_segments_on_the_timeline() {
    let fixture = fixture(MeetingSessionId::new());
    let expected = fixture.expected();
    assert_eq!(subject_holds(&fixture, &expected, Rubric::LoopBack), Ok(()));
    // Two bars, not one: the subject was left and came back.
    let page = fixture.page(&expected);
    let pricing = page
        .topics
        .iter()
        .find(|topic| topic.label == "Pricing tiers")
        .expect("pricing thread");
    assert_eq!(pricing.segs.len(), 2);
}

#[test]
fn a_landed_decision_exists_with_its_receipt() {
    let fixture = fixture(MeetingSessionId::new());
    assert_eq!(subject_holds(&fixture, &fixture.expected(), Rubric::Decision), Ok(()));
}

#[test]
fn the_unanswered_question_is_in_open_loops() {
    let fixture = fixture(MeetingSessionId::new());
    assert_eq!(subject_holds(&fixture, &fixture.expected(), Rubric::Unanswered), Ok(()));
}

#[test]
fn the_dropped_thread_is_in_open_loops() {
    let fixture = fixture(MeetingSessionId::new());
    assert_eq!(subject_holds(&fixture, &fixture.expected(), Rubric::Dropped), Ok(()));
}

#[test]
fn the_comparison_table_is_a_firm_action_owned_by_amir() {
    let fixture = fixture(MeetingSessionId::new());
    assert_eq!(subject_holds(&fixture, &fixture.expected(), Rubric::Action), Ok(()));
}

#[test]
fn the_messy_quote_is_kept_verbatim() {
    let fixture = fixture(MeetingSessionId::new());
    assert_eq!(subject_holds(&fixture, &fixture.expected(), Rubric::Verbatim), Ok(()));
}

#[test]
fn the_stance_records_amir_taking_up_annual_only() {
    let fixture = fixture(MeetingSessionId::new());
    assert_eq!(subject_holds(&fixture, &fixture.expected(), Rubric::Stance), Ok(()));
}

#[test]
fn small_talk_and_the_sign_off_are_not_substantive() {
    let fixture = fixture(MeetingSessionId::new());
    assert_eq!(subject_holds(&fixture, &fixture.expected(), Rubric::SmallTalk), Ok(()));
}

// ── mutations ───────────────────────────────────────────────────────────────
//
// Each one breaks the expected ledger in the way one check exists for, and
// has to be caught by that check and named.

#[test]
fn an_invented_quote_fails_the_verbatim_check() {
    let fixture = fixture(MeetingSessionId::new());
    let mut mutated = fixture.expected();
    let pricing = mutated
        .threads
        .iter_mut()
        .find(|thread| thread.topic == "Pricing tiers")
        .expect("pricing thread");
    // Reads better, and is not what was said.
    pricing.receipt.quote = "because we keep circling it and then running out of time".to_string();
    let failures = ledger::check(&mutated, &fixture.page(&mutated), &fixture.haystack());
    assert_eq!(
        failures,
        vec![CheckFailure::UnverifiedReceipt {
            label: "Pricing tiers".to_string(),
        }]
    );
    assert!(subject_holds(&fixture, &mutated, Rubric::Verbatim).is_err());
}

#[test]
fn a_dropped_thread_missing_from_open_loops_fails_the_unlisted_check() {
    let fixture = fixture(MeetingSessionId::new());
    let mut mutated = fixture.expected();
    mutated
        .open_loops
        .retain(|loop_| !loop_.question.contains("onboarding"));
    let failures = ledger::check(&mutated, &fixture.page(&mutated), &fixture.haystack());
    assert_eq!(failures, vec![CheckFailure::UnlistedUnresolved { count: 1 }]);
    assert!(failures[0].caveat().is_some_and(|caveat| caveat.contains("1")));
    assert!(subject_holds(&fixture, &mutated, Rubric::Dropped).is_err());
}

#[test]
fn a_cue_shaped_transcript_fails_the_density_check() {
    let fixture = fixture(MeetingSessionId::new());
    let expected = fixture.expected();
    let haystack = fixture.haystack();
    let (dana, amir) = (fixture.segments[0].speaker_id, fixture.segments[1].speaker_id);
    // Every turn as fifteen cues, the way a subtitle export arrives.
    let cues = |jitter: bool| -> Vec<AnalyticsSegment> {
        fixture
            .segments
            .iter()
            .flat_map(|turn| {
                let length = (turn.end_offset_ns - turn.start_offset_ns) / 15;
                (0..15_u64).map(move |cue| AnalyticsSegment {
                    segment_id: TranscriptSegmentId::new(),
                    // A jittery diarizer hands alternate cues to the other
                    // speaker, which is what stops them merging back.
                    speaker_id: if jitter && cue % 2 == 1 {
                        if turn.speaker_id == dana {
                            amir
                        } else {
                            dana
                        }
                    } else {
                        turn.speaker_id
                    },
                    start_offset_ns: turn.start_offset_ns + cue * length,
                    // The last cue ends where the turn did, so the axis and
                    // the duration stay the fixture's.
                    end_offset_ns: if cue == 14 {
                        turn.end_offset_ns
                    } else {
                        turn.start_offset_ns + (cue + 1) * length
                    },
                    text: "cue".to_string(),
                })
            })
            .collect()
    };
    // Cues that are attributed correctly merge back into turns before the
    // page is measured, which is the merge upstream's script exists to demand.
    let merged = fixture.page_over(&expected, &cues(false));
    assert_eq!(merged.turns.len(), 30);
    assert_eq!(ledger::check(&expected, &merged, &haystack), Vec::new());
    // Cues that cannot merge are what the density bound catches.
    let unmerged = fixture.page_over(&expected, &cues(true));
    assert_eq!(unmerged.turns.len(), 450);
    let failures = ledger::check(&expected, &unmerged, &haystack);
    assert_eq!(
        failures,
        vec![CheckFailure::TurnDensity {
            turns: 450,
            seconds: 272,
        }]
    );
    assert!(failures[0]
        .caveat()
        .is_some_and(|caveat| caveat.contains("cue-shaped") && caveat.contains("450")));
}

#[test]
fn a_citation_past_the_duration_fails_the_geometry_check() {
    let fixture = fixture(MeetingSessionId::new());
    let mut mutated = fixture.expected();
    let trial = mutated
        .threads
        .iter_mut()
        .find(|thread| thread.state == LedgerThreadState::Unanswered)
        .expect("trial thread");
    trial.receipt.citations[0].end_offset_ns = 999_000_000_000;
    let failures = ledger::check(&mutated, &fixture.page(&mutated), &fixture.haystack());
    assert_eq!(
        failures,
        vec![CheckFailure::Geometry {
            label: "Which tier the trial converts into".to_string(),
            from: 62,
            to: 999,
        }]
    );
    assert_eq!(failures[0].caveat(), None);
}

#[test]
fn a_missing_headline_fails() {
    let fixture = fixture(MeetingSessionId::new());
    let mut mutated = fixture.expected();
    mutated.headline = "  ".to_string();
    let failures = ledger::check(&mutated, &fixture.page(&mutated), &fixture.haystack());
    assert_eq!(failures, vec![CheckFailure::MissingHeadline]);
}
