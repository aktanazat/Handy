//! Loop 6: capture-quality statistics counted from local run receipts.
//!
//! # What the receipts can and cannot be keyed on
//!
//! The intended advice — *"your Bluetooth mic causes 3x more retries"* — needs
//! per-run input-device provenance. There is none: a run receipt carries
//! [`crate::modes::ModeReceipt`], whose measured audio fields are `input_peak`
//! and `input_rms` and nothing about which device produced them, and
//! `transcription_history.source_kind` distinguishes only microphone from file.
//! Adding a device column would be a migration in the history database plus a
//! new write at the capture seam plus an importer change — not the two-file
//! change that would justify doing it here.
//!
//! So advice is keyed on the identity receipts do carry: the transcription route
//! that produced the text (`engine_used`, falling back to the requested route on
//! a run that delivered nothing). The copy names that route, so no card claims
//! anything about a microphone. The key itself is
//! [`crate::modes::RequestedEngine::as_str`], deliberately not the serde
//! spelling: Deepgram stores `deepgram_nova3` while the wire value is
//! `deepgram_nova_3`. That key is the primary key of
//! `learning_advice_baselines`, so re-keying it would re-advise every subject a
//! user has dismissed.
//!
//! # Why re-advising does not contradict dismissal memory
//!
//! Dismissal is absolute: a dismissed candidate never returns. Advice that must
//! reappear when its statistic moves materially therefore has to become a
//! *different* candidate, and the generation in `learning_advice_baselines` is
//! what makes it one. The generation advances only when the statistic has at
//! least doubled or halved against the number last advised, so a statistic
//! drifting across a threshold cannot flip a candidate back and forth, and a
//! dismissed generation stays dismissed forever.

use super::{
    advance_corpus_cursor_in, corpus_slice_in, insert_suggestions_in, local_day,
    observation_totals_in, prune_observations_in, record_observation_in, DictationCorpus,
    MinedCandidate, ObservationTotals,
};
use crate::managers::history::{CaptureStatus, DictationRunRow};
use crate::meeting::learning_types::{CaptureAdviceKind, LearningLoopKind, LearningSuggestion};
use crate::meeting::store::StoreError;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeMap;

/// How many runs one route needs before its rate means anything.
const MIN_ROUTE_RUNS: u64 = 20;
/// How much worse than the rest of the corpus a route has to be, in parts per
/// thousand of the baseline. 2000 is twice as often.
const MIN_EXCESS_PERMILLE: u32 = 2_000;
/// How many measured captures the input-level advice needs.
const MIN_MEASURED_RUNS: u64 = 20;
/// Below this RMS a capture is quiet enough that speech may be missed, on the
/// same normalized full-scale amplitude `measure_input_level` reports.
const QUIET_RMS: f32 = 0.01;
/// What share of measured captures must be quiet, in parts per thousand.
const MIN_QUIET_SHARE_PERMILLE: u32 = 300;
/// How far a statistic must move before it is a new generation of advice.
const RE_ADVISE_FACTOR: u32 = 2;

/// Counter keys in the shared ledger: a route-scoped numerator over a
/// route-scoped denominator, so every ratio is computable from the ledger alone.
const RETRY_PREFIX: &str = "retry:";
const LOST_PREFIX: &str = "lost:";
const QUIET_KEY: &str = "quiet:all";

pub(in crate::meeting::store) fn mine_capture_advice_in(
    connection: &Connection,
    corpus: &DictationCorpus,
    now_utc_ms: i64,
) -> Result<u64, StoreError> {
    let loop_kind = LearningLoopKind::CaptureAdvice;
    let slice = corpus_slice_in(connection, loop_kind, corpus)?;
    for row in &slice {
        let day = local_day(row.completed_at_ms);
        let route = route_of(row);
        record_observation_in(
            connection,
            loop_kind,
            &format!("{RETRY_PREFIX}{route}"),
            &day,
            u64::from(row.is_retry),
            1,
            route,
            None,
        )?;
        let lost = matches!(
            row.capture_status,
            Some(CaptureStatus::Truncated) | Some(CaptureStatus::NoSpeechDetected)
        );
        record_observation_in(
            connection,
            loop_kind,
            &format!("{LOST_PREFIX}{route}"),
            &day,
            u64::from(lost),
            1,
            route,
            None,
        )?;
        if let Some(rms) = row.mode.input_rms {
            record_observation_in(
                connection,
                loop_kind,
                QUIET_KEY,
                &day,
                u64::from(rms < QUIET_RMS),
                1,
                "",
                None,
            )?;
        }
    }
    if let Some(highest) = slice.last().map(|row| row.id) {
        advance_corpus_cursor_in(connection, loop_kind, highest)?;
    }
    prune_observations_in(connection, now_utc_ms)?;

    let totals = observation_totals_in(connection, loop_kind)?;
    let mut observations = Vec::new();
    observations.extend(rate_observations(
        &totals,
        RETRY_PREFIX,
        CaptureAdviceKind::RetryRate,
    ));
    observations.extend(rate_observations(
        &totals,
        LOST_PREFIX,
        CaptureAdviceKind::LostCaptureRate,
    ));
    observations.extend(quiet_observation(&totals));
    observations.sort_by(|left, right| {
        right
            .stat_permille
            .cmp(&left.stat_permille)
            .then_with(|| left.subject_key.cmp(&right.subject_key))
    });

    let mut generations = Vec::with_capacity(observations.len());
    let mut candidates = Vec::with_capacity(observations.len());
    for observation in observations {
        let generation = generation_for_in(connection, &observation)?;
        candidates.push(MinedCandidate {
            key: format!("{}#{generation}", observation.subject_key),
            suggestion: observation.suggestion,
            evidence: observation.evidence,
        });
        generations.push((
            observation.subject_key,
            observation.stat_permille,
            generation,
        ));
    }

    let added = insert_suggestions_in(connection, loop_kind, candidates, now_utc_ms)?;
    // The baseline moves only for advice a reader will actually see, so a
    // candidate the caps dropped is still new next time.
    for (subject_key, stat_permille, generation) in generations {
        let candidate_key = format!("{subject_key}#{generation}");
        if added.contains(&candidate_key) {
            record_baseline_in(
                connection,
                &subject_key,
                stat_permille,
                generation,
                now_utc_ms,
            )?;
        }
    }
    u64::try_from(added.len()).map_err(|_| StoreError::Corrupt)
}

/// One statistic that cleared its floor, before it is given a generation.
struct AdviceObservation {
    subject_key: String,
    stat_permille: u32,
    suggestion: LearningSuggestion,
    evidence: crate::meeting::learning_types::LearningEvidence,
}

/// The transcription route this run's text came from.
fn route_of(row: &DictationRunRow) -> &'static str {
    row.mode
        .engine_used
        .unwrap_or(row.mode.engine_requested)
        .as_str()
}

/// One observation per route whose rate is at least [`MIN_EXCESS_PERMILLE`] of
/// the rate every other route managed.
fn rate_observations(
    totals: &BTreeMap<String, ObservationTotals>,
    prefix: &str,
    advice: CaptureAdviceKind,
) -> Vec<AdviceObservation> {
    let scoped = totals
        .iter()
        .filter(|(key, _)| key.starts_with(prefix))
        .collect::<Vec<_>>();
    let corpus_occurrences: u64 = scoped.iter().map(|(_, total)| total.occurrences).sum();
    let corpus_samples: u64 = scoped.iter().map(|(_, total)| total.sample_size).sum();

    scoped
        .iter()
        .filter_map(|(key, total)| {
            if total.sample_size < MIN_ROUTE_RUNS {
                return None;
            }
            let rest_occurrences = corpus_occurrences.saturating_sub(total.occurrences);
            let rest_samples = corpus_samples.saturating_sub(total.sample_size);
            // A single-route corpus has nothing to compare against, and calling
            // that an excess would be a claim about one number.
            if rest_samples < MIN_ROUTE_RUNS {
                return None;
            }
            let route_permille = total.share_permille()?;
            let rest_permille = permille(rest_occurrences, rest_samples)?;
            let excess = permille(u64::from(route_permille), u64::from(rest_permille.max(1)))?;
            (excess >= MIN_EXCESS_PERMILLE).then(|| AdviceObservation {
                subject_key: (*key).clone(),
                stat_permille: excess,
                suggestion: LearningSuggestion::CaptureAdvice {
                    advice,
                    subject: total.display_text.clone(),
                    stat_permille: excess,
                    sample_runs: total.sample_size,
                },
                evidence: total.evidence(),
            })
        })
        .collect()
}

/// The one observation that is not route-scoped: input amplitude is a property
/// of the machine and its microphone, and receipts cannot attribute it further.
fn quiet_observation(totals: &BTreeMap<String, ObservationTotals>) -> Option<AdviceObservation> {
    let total = totals.get(QUIET_KEY)?;
    if total.sample_size < MIN_MEASURED_RUNS {
        return None;
    }
    let share = total.share_permille()?;
    (share >= MIN_QUIET_SHARE_PERMILLE).then(|| AdviceObservation {
        subject_key: QUIET_KEY.to_string(),
        stat_permille: share,
        suggestion: LearningSuggestion::CaptureAdvice {
            advice: CaptureAdviceKind::InputLevel,
            subject: String::new(),
            stat_permille: share,
            sample_runs: total.sample_size,
        },
        evidence: total.evidence(),
    })
}

/// Which generation of advice this statistic belongs to.
///
/// A subject never advised is generation 0. An advised subject stays on its
/// generation until the statistic at least doubles or halves against the number
/// last advised, which is the only thing that makes it a new candidate.
fn generation_for_in(
    connection: &Connection,
    observation: &AdviceObservation,
) -> Result<u32, StoreError> {
    let baseline: Option<(i64, i64)> = connection
        .query_row(
            "SELECT stat_permille, generation FROM learning_advice_baselines
              WHERE subject_key = ?1",
            [&observation.subject_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((previous_stat, generation)) = baseline else {
        return Ok(0);
    };
    let previous = u32::try_from(previous_stat).unwrap_or(u32::MAX).max(1);
    let current = observation.stat_permille.max(1);
    let generation = u32::try_from(generation).map_err(|_| StoreError::Corrupt)?;
    let material = current >= previous.saturating_mul(RE_ADVISE_FACTOR)
        || previous >= current.saturating_mul(RE_ADVISE_FACTOR);
    Ok(if material {
        generation.saturating_add(1)
    } else {
        generation
    })
}

fn record_baseline_in(
    connection: &Connection,
    subject_key: &str,
    stat_permille: u32,
    generation: u32,
    now_utc_ms: i64,
) -> Result<(), StoreError> {
    connection.execute(
        "INSERT INTO learning_advice_baselines (
            subject_key, stat_permille, generation, advised_at_utc_ms
         ) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(subject_key) DO UPDATE SET
            stat_permille = excluded.stat_permille,
            generation = excluded.generation,
            advised_at_utc_ms = excluded.advised_at_utc_ms",
        params![
            subject_key,
            i64::from(stat_permille),
            i64::from(generation),
            now_utc_ms
        ],
    )?;
    Ok(())
}

fn permille(numerator: u64, denominator: u64) -> Option<u32> {
    (denominator > 0)
        .then(|| u32::try_from(numerator.saturating_mul(1_000) / denominator).unwrap_or(u32::MAX))
}
