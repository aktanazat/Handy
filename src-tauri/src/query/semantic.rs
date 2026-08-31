//! Semantic recall for meetings: the dictation index, widened.
//!
//! The model, the similarity floor and the vector encoding all come from
//! `managers::history::semantic` — the same static embedding table, the same
//! measured floor, the same little-endian lanes. Nothing about the maths is
//! new here. What is new is the corpus: a meeting's summary and its transcript,
//! which FTS5 reaches only by literal word (and the summary not at all, because
//! generated notes were never written into `meeting_search_documents`).
//!
//! # Where the vectors live
//!
//! In the meeting database, beside the words they were derived from. Putting
//! them in `history.db` next to the dictation index would have been fewer
//! tables and one more copy of transcript text living outside the retention
//! sweep, the encryption key, and the cascade that deletes a meeting — a
//! meeting the user deleted would have kept its sentences in another file. The
//! model stays where it is; only the storage follows the corpus.
//!
//! # When they are built
//!
//! At artifact completion, by [`index_after_artifact`] — the moment the words a
//! reader will search for become final. Meetings that finished before this
//! index existed are picked up a couple at a time by [`top_up_index`] on
//! search, which terminates because every pass writes an index-state row, even
//! for a meeting with nothing embeddable in it. Correctness never depends on
//! the push: the state row records *what* was indexed, so a missed
//! notification costs latency, not accuracy.

use crate::managers::history::semantic::{
    cosine_similarity, encode_vector, SemanticModel, SIMILARITY_FLOOR,
};
use crate::managers::history::HistoryManager;
use crate::meeting::store::query_plane::MeetingQueryCandidate;
use crate::meeting::store::{MeetingStore, StoreError};
use crate::meeting::types::MeetingSessionId;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// Characters of transcript per chunk.
///
/// A static embedding mean-pools its tokens, so the unit matters twice over: a
/// whole meeting in one vector averages every subject into none of them, and a
/// single transcript segment is often five words of back-channel. A few
/// sentences is the granularity a person actually remembers and asks about.
const TARGET_CHUNK_CHARS: usize = 480;

/// Index one session's text, replacing whatever was there.
///
/// Returns whether the session had anything to index — `false` means it has no
/// current transcript revision or has been deleted, which is not a failure.
pub(crate) fn index_session(
    store: &MeetingStore,
    model: &SemanticModel,
    session_id: MeetingSessionId,
) -> Result<bool, StoreError> {
    let Some(inputs) = store.semantic_index_inputs(session_id)? else {
        return Ok(false);
    };
    let mut chunks = Vec::new();
    // Summaries first, each on its own: the headline and the notes summary are
    // already one distilled thought apiece, and merging them with transcript
    // text would dilute both.
    for text in inputs
        .summaries
        .iter()
        .cloned()
        .chain(chunk_transcript(&inputs.transcript))
    {
        if let Some(vector) = model.encode(&text) {
            chunks.push((text, encode_vector(&vector)));
        }
    }
    // Written even when `chunks` is empty. That row is what stops the backfill
    // from selecting a wordless meeting on every search for the rest of time.
    store.replace_semantic_chunks(
        session_id,
        &inputs.key,
        model.revision(),
        utc_now_ms(),
        &chunks,
    )?;
    Ok(true)
}

/// The artifact-completion hook.
///
/// Called with the store already in hand, on the processing job's own thread:
/// embedding a meeting is tokenize-and-look-up, not inference, and this is
/// already the background pass that just spent minutes transcribing. Failure is
/// logged and dropped — an unindexed meeting is still fully searchable by word,
/// and no receipt may wait on a cache.
pub fn index_after_artifact(
    app: Option<&AppHandle>,
    store: &MeetingStore,
    session_id: MeetingSessionId,
) {
    let Some(app) = app else {
        return;
    };
    let Some(history) = app.try_state::<Arc<HistoryManager>>() else {
        return;
    };
    // No fetch is started here. Whether this machine downloads the recall model
    // is dictation search's decision to make, and finishing a meeting is not
    // consent to a network round trip. `top_up_index` collects this session
    // once the model does arrive.
    let Some(model) = history.semantic_model() else {
        return;
    };
    match index_session(store, &model, session_id) {
        Ok(_) => {}
        Err(error) => log::warn!("Meeting semantic index skipped {session_id:?}: {error:?}"),
    }
}

/// Build the index for up to `limit` meetings that need it. Best effort by
/// design: this runs inside a search, and a search must answer.
pub(crate) fn top_up_index(store: &MeetingStore, model: &SemanticModel, limit: usize) {
    let targets = match store.semantic_index_targets(model.revision(), limit) {
        Ok(targets) => targets,
        Err(error) => {
            log::warn!("Meeting semantic backfill could not list targets: {error:?}");
            return;
        }
    };
    for session_id in targets {
        if let Err(error) = index_session(store, model, session_id) {
            log::warn!("Meeting semantic backfill skipped {session_id:?}: {error:?}");
        }
    }
}

/// Meetings recalled by meaning rather than by word.
///
/// One row per meeting — its best-scoring chunk — so a meeting that circles a
/// subject for an hour does not crowd out every other answer. Rows below the
/// floor are not weak matches, they are absent: the floor is what keeps
/// "everything is a little bit similar to everything" out of a search box.
pub(crate) fn meeting_matches(
    store: &MeetingStore,
    model: &SemanticModel,
    query: &str,
    before_utc_ms: Option<i64>,
    limit: usize,
) -> Result<Vec<MeetingQueryCandidate>, StoreError> {
    let Some(vector) = model.encode(query) else {
        return Ok(Vec::new());
    };
    let rows = store.query_semantic_chunk_vectors(model.revision(), before_utc_ms)?;
    let mut best: HashMap<MeetingSessionId, (f32, i64, i64)> = HashMap::new();
    for row in rows {
        let Some(score) = cosine_similarity(&row.embedding, &vector) else {
            continue;
        };
        if score < SIMILARITY_FLOOR {
            continue;
        }
        let entry = best
            .entry(row.session_id)
            .or_insert((score, row.chunk_id, row.when_utc_ms));
        if score > entry.0 {
            *entry = (score, row.chunk_id, row.when_utc_ms);
        }
    }
    let mut ranked = best.into_iter().collect::<Vec<_>>();
    // Recency picks which matches fit on the page, because recency is the page
    // order; the floor above is what decided they belong on it at all.
    ranked.sort_by(|(left_id, left), (right_id, right)| {
        right
            .2
            .cmp(&left.2)
            .then_with(|| left_id.uuid().cmp(&right_id.uuid()))
    });
    ranked.truncate(limit);
    let chunk_ids = ranked
        .iter()
        .map(|(_, (_, chunk_id, _))| *chunk_id)
        .collect::<Vec<_>>();
    store.query_meetings_by_chunk(&chunk_ids)
}

/// Consecutive transcript segments joined up to [`TARGET_CHUNK_CHARS`].
///
/// Segments are never split: a chunk overshoots rather than cutting a sentence
/// in half, because half a sentence embeds to half a meaning.
fn chunk_transcript(segments: &[String]) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for segment in segments {
        let segment = segment.trim();
        if segment.is_empty() {
            continue;
        }
        if !current.is_empty() {
            if current.chars().count() >= TARGET_CHUNK_CHARS {
                chunks.push(std::mem::take(&mut current));
            } else {
                current.push(' ');
            }
        }
        current.push_str(segment);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn utc_now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcript_chunks_join_segments_without_splitting_one() {
        let segments = vec![
            "a".repeat(TARGET_CHUNK_CHARS - 10),
            "the pricing tier question came back".to_string(),
            "b".repeat(TARGET_CHUNK_CHARS),
        ];

        let chunks = chunk_transcript(&segments);

        assert_eq!(chunks.len(), 2, "{chunks:?}");
        assert!(
            chunks[0].ends_with("the pricing tier question came back"),
            "a segment that overshoots the target still lands whole"
        );
        assert_eq!(chunks[1], "b".repeat(TARGET_CHUNK_CHARS));
    }

    #[test]
    fn empty_and_blank_segments_produce_no_chunks() {
        assert!(chunk_transcript(&[]).is_empty());
        assert!(chunk_transcript(&["   ".to_string(), "\n".to_string()]).is_empty());
    }
}
