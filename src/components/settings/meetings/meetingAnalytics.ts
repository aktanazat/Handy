import { invoke } from "@tauri-apps/api/core";

/* Talk metrics, keyword trackers and the user's own notes layer.
 *
 * The commands are invoked by name with the same camelCase argument keys the
 * generated client uses, following the `read_history_audio_chunk` precedent.
 * The types below mirror src-tauri/src/meeting/analytics.rs exactly, so this
 * module is the single place naming the analytics wire shapes. */

export type MeetingNotesTemplate =
  | "general"
  | "one_on_one"
  | "interview"
  | "sales_call"
  | "standup";

export const MEETING_NOTES_TEMPLATES: MeetingNotesTemplate[] = [
  "general",
  "one_on_one",
  "interview",
  "sales_call",
  "standup",
];

export interface SpeakerTalkShare {
  speaker_id: string;
  speaking_ns: number;
  share_permille: number;
  turn_count: number;
  longest_monologue_ns: number;
}

export interface MeetingTalkMetrics {
  segment_count: number;
  turn_count: number;
  interaction_count: number;
  total_speaking_ns: number;
  speakers: SpeakerTalkShare[];
  longest_monologue_ns: number;
  longest_monologue_speaker_id: string | null;
  median_switch_gap_ms: number | null;
}

export interface KeywordTracker {
  name: string;
  patterns: string[];
}

export interface TrackerResult {
  name: string;
  hit_count: number;
  segment_ids: string[];
}

export interface MeetingAnalytics {
  talk: MeetingTalkMetrics;
  trackers: TrackerResult[];
}

export interface MeetingActionItemState {
  artifact_id: string;
  action_index: number;
  done: boolean;
}

export interface MeetingUserNotes {
  session_id: string;
  body: string;
  template: MeetingNotesTemplate;
  revision: number;
  updated_at_utc_ms: number;
}

export interface MeetingAnalyticsSnapshot {
  session_id: string;
  input_revision: number;
  computed_at_utc_ms: number;
  analytics: MeetingAnalytics;
  action_items: MeetingActionItemState[];
  notes: MeetingUserNotes;
}

export type MeetingCatchUpState =
  | "ready"
  | "no_transcript_yet"
  | "model_unavailable"
  | "failed";

export interface MeetingCatchUp {
  state: MeetingCatchUpState;
  bullets: string[];
  through_offset_ns: number | null;
  segment_count: number;
  /** Read from the transcript Sona recognized while the meeting was running,
   *  rather than from the stored one written after the stop. */
  provisional: boolean;
}

/** How long the notes pane waits after the last keystroke before saving. */
export const NOTES_AUTOSAVE_DELAY_MS = 1_200;

export const getMeetingAnalytics = (sessionId: string) =>
  invoke<MeetingAnalyticsSnapshot>("get_meeting_analytics", { sessionId });

export const getMeetingUserNotes = (sessionId: string) =>
  invoke<MeetingUserNotes>("get_meeting_user_notes", { sessionId });

export const saveMeetingUserNotes = (request: {
  session_id: string;
  body: string;
  template: MeetingNotesTemplate;
  expected_note_revision: number;
}) => invoke<MeetingUserNotes>("save_meeting_user_notes", { request });

export const setActionItemDone = (request: {
  session_id: string;
  artifact_id: string;
  action_index: number;
  done: boolean;
}) => invoke<MeetingActionItemState[]>("set_action_item_done", { request });

export const reenhanceMeetingWithNotes = (request: {
  operation_id: string;
  session_id: string;
  expected_revision: number;
  body: string;
  template: MeetingNotesTemplate;
  expected_note_revision: number;
}) => invoke<unknown>("reenhance_meeting_with_notes", { request });

export const meetingCatchUp = (sessionId: string) =>
  invoke<MeetingCatchUp>("meeting_catch_up", { sessionId });

export const listKeywordTrackers = () =>
  invoke<KeywordTracker[]>("list_keyword_trackers");

export const saveKeywordTrackers = (trackers: KeywordTracker[]) =>
  invoke<KeywordTracker[]>("save_keyword_trackers", { trackers });

/** Per-mille to a whole percent, which is the only precision a strip needs. */
export const formatTalkShare = (sharePermille: number) =>
  `${Math.round(sharePermille / 10)}%`;

/** Durations under a minute read in seconds; longer ones read as m:ss. */
export const formatTalkDuration = (durationNs: number) => {
  const seconds = Math.max(0, Math.round(durationNs / 1_000_000_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

/** Patience is a sub-second judgement, so it keeps one decimal place. */
export const formatPatience = (gapMs: number | null) => {
  if (gapMs === null) return "—";
  if (gapMs < 1_000) return `${gapMs}ms`;
  return `${(gapMs / 1_000).toFixed(1)}s`;
};

/** The key of one action item's tick, unique across regenerated revisions. */
export const actionItemKey = (artifactId: string, actionIndex: number) =>
  `${artifactId}:${actionIndex}`;
