import React, { useEffect, useId, useState } from "react";
import { RefreshCcw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  CitedArtifactText,
  ManualNote,
  MeetingAnswerState,
  MeetingArtifactRevision,
  MeetingArtifactState,
  MeetingCitation,
  MeetingReviewSnapshot,
  MeetingSearchHit,
  SpeakerId,
} from "@/bindings";
import {
  Button,
  EmptyState,
  Input,
  Section,
  StatusText,
  Textarea,
  type StatusTone,
} from "../../ui";
import { MeetingSourceList, ProcessingStatusText } from "./MeetingStatus";
import { formatMeetingOffset } from "./meetingUtils";
import { MeetingAnalyticsStrip } from "./MeetingAnalyticsStrip";
import { MeetingNotesPane } from "./MeetingNotesPane";
import { actionItemKey, type MeetingAnalytics } from "./meetingAnalytics";

/* The three panels behind the review tabs. They are separate from the review
 * shell because none of them knows about the others: the shell owns the tab,
 * the pending jump and every mutation callback.
 *
 * A citation is a jump. Anything that points at a transcript segment renders
 * as a control that scrolls that segment into view and marks it, which is the
 * whole reason the backend attaches citations at all. */

/** DOM id prefix for transcript rows, so a citation can find its segment. */
const SEGMENT_DOM_PREFIX = "meeting-transcript-segment-";

const CAPTION_CLASSES = "microlabel";

const ANSWER_STATE_TONES = {
  supported: "muted",
  insufficient_evidence: "warning",
  unavailable: "warning",
  out_of_date: "warning",
  forgotten: "muted",
} as const satisfies Record<MeetingAnswerState, StatusTone>;

const ARTIFACT_STATE_TONES = {
  current: "muted",
  out_of_date: "warning",
  failed: "danger",
} as const satisfies Record<MeetingArtifactState, StatusTone>;

export interface SegmentJump {
  segmentId: string;
  /** Bumped on every jump so repeating the same citation scrolls again. */
  nonce: number;
}

interface CitationJumpProps {
  startOffsetNs: number | null;
  segmentId: string | null;
  onJump: (segmentId: string) => void;
}

/* A citation is a jump, so it looks like the thing that jumps: a link in the
 * accent colour with the timestamp kept monospaced and tabular. It degrades to
 * plain text when it points at a manual note or the title, which have no
 * transcript row to scroll to. */
const CitationJump: React.FC<CitationJumpProps> = ({
  startOffsetNs,
  segmentId,
  onJump,
}) => {
  const { t } = useTranslation();
  const label = t("meetings.review.citation", {
    time: formatMeetingOffset(startOffsetNs),
  });

  if (segmentId === null) {
    return <span className="meeting-citation-static">{label}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => onJump(segmentId)}
      className="meeting-citation"
    >
      {label}
    </button>
  );
};

interface CitedTextProps {
  value: CitedArtifactText;
  onJump: (segmentId: string) => void;
}

const CitedText: React.FC<CitedTextProps> = ({ value, onJump }) => (
  <div className="space-y-1">
    <p className="text-[13px] leading-5 text-text-primary text-pretty">
      {value.text}
    </p>
    {value.citations.length > 0 ? (
      <div className="-ms-1.5 flex flex-wrap items-center gap-1">
        {value.citations.map((citation) => (
          <CitationJump
            key={citation.segment_id}
            startOffsetNs={citation.start_offset_ns}
            segmentId={citation.segment_id}
            onJump={onJump}
          />
        ))}
      </div>
    ) : null}
  </div>
);

interface AnswerCitationsProps {
  citations: MeetingCitation[];
  onJump: (segmentId: string) => void;
}

const AnswerCitations: React.FC<AnswerCitationsProps> = ({
  citations,
  onJump,
}) => (
  <div className="-ms-1.5 flex flex-wrap items-center gap-1">
    {citations.map((citation) => (
      <CitationJump
        key={`${citation.kind}:${citation.entity_id}`}
        startOffsetNs={citation.start_offset_ns}
        segmentId={citation.kind === "transcript" ? citation.entity_id : null}
        onJump={onJump}
      />
    ))}
  </div>
);

export interface TranscriptTabProps {
  snapshot: MeetingReviewSnapshot;
  speakerNames: Record<string, string>;
  busy: boolean;
  editable: boolean;
  jump: SegmentJump | null;
  searchQuery: string;
  searchHits: MeetingSearchHit[] | null;
  searching: boolean;
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void;
  onJumpToSegment: (segmentId: string) => void;
  onSegmentEdit: (
    segmentId: string,
    replacementText: string,
    removed: boolean,
  ) => void;
  onSpeakerRename: (speakerId: SpeakerId, displayName: string) => void;
  onSpeakerMerge: (
    sourceSpeakerId: SpeakerId,
    targetSpeakerId: SpeakerId,
  ) => void;
}

export const TranscriptTab: React.FC<TranscriptTabProps> = ({
  snapshot,
  speakerNames,
  busy,
  editable,
  jump,
  searchQuery,
  searchHits,
  searching,
  onSearchQueryChange,
  onSearch,
  onJumpToSegment,
  onSegmentEdit,
  onSpeakerRename,
  onSpeakerMerge,
}) => {
  const { t } = useTranslation();
  const disabled = busy || !editable;

  useEffect(() => {
    if (jump === null) return;
    const target = document.getElementById(
      `${SEGMENT_DOM_PREFIX}${jump.segmentId}`,
    );
    if (target === null) return;
    target.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [jump]);

  return (
    <>
      <Section
        title={t("meetings.review.exactSearch")}
        description={t("meetings.review.exactSearchDescription")}
      >
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch();
          }}
        >
          <Input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={t("meetings.review.searchPlaceholder")}
            aria-label={t("meetings.review.exactSearch")}
            className="w-full max-w-[320px]"
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={searching || searchQuery.trim().length === 0}
          >
            <Search size={14} aria-hidden="true" />
            {searching
              ? t("meetings.review.searching", "Searching…")
              : t("meetings.review.search")}
          </Button>
        </form>
        {searching ? (
          <StatusText tone="muted" live="polite" className="mt-2 block">
            {t("meetings.review.searching", "Searching…")}
          </StatusText>
        ) : searchHits === null ? null : searchHits.length === 0 ? (
          <StatusText tone="muted" live="polite" className="mt-2 block">
            {t("meetings.review.noSearchResults")}
          </StatusText>
        ) : (
          <ul
            role="list"
            aria-label={t("meetings.review.exactSearch")}
            className="meeting-rows mt-3"
          >
            {searchHits.map((hit) => (
              <MeetingSearchHitRow
                key={`${hit.kind}:${hit.entity_id}:${hit.start_offset_ns ?? "start"}`}
                hit={hit}
                onJump={onJumpToSegment}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={t("meetings.review.speakers")}
        description={t("meetings.review.speakersDescription")}
      >
        <StatusText tone="muted" className="mb-2 block">
          {t(`meetings.diarization.${snapshot.diarization.status}`)}
        </StatusText>
        {snapshot.speakers.length === 0 ? (
          <StatusText tone="muted" className="block">
            {t("meetings.review.noSpeakers")}
          </StatusText>
        ) : (
          <>
            <ul
              role="list"
              aria-label={t("meetings.review.speakers")}
              className="meeting-rows"
            >
              {snapshot.speakers.map((speaker) => (
                <SpeakerRow
                  key={`${speaker.speaker_id}:${speaker.revision}:${speaker.display_name}`}
                  speakerId={speaker.speaker_id}
                  name={speaker.display_name}
                  disabled={disabled}
                  onRename={onSpeakerRename}
                />
              ))}
            </ul>
            {snapshot.speakers.length > 1 ? (
              <MeetingSpeakerMerge
                key={snapshot.speakers
                  .map((speaker) => `${speaker.speaker_id}:${speaker.revision}`)
                  .join("|")}
                speakers={snapshot.speakers}
                disabled={disabled}
                onMerge={onSpeakerMerge}
              />
            ) : null}
          </>
        )}
      </Section>

      <Section
        title={t("meetings.review.transcript")}
        description={t("meetings.review.transcriptDescription")}
      >
        {snapshot.transcript.length === 0 ? (
          <StatusText tone="muted" className="block">
            {t("meetings.review.noTranscript")}
          </StatusText>
        ) : (
          <ol
            role="list"
            aria-label={t("meetings.review.transcript")}
            className="meeting-rows"
          >
            {snapshot.transcript.map((segment) => {
              const text = segment.replacement_text ?? segment.base.text;
              const highlighted = jump?.segmentId === segment.base.segment_id;
              return (
                <li
                  key={segment.base.segment_id}
                  id={`${SEGMENT_DOM_PREFIX}${segment.base.segment_id}`}
                  className={`meeting-row-stacked ${highlighted ? "bg-subtle" : ""}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="flex min-w-0 items-baseline gap-2">
                      <span className="microlabel tabular-nums">
                        {formatMeetingOffset(segment.base.start_offset_ns)}
                      </span>
                      <span className="truncate text-[12.5px] leading-[18px] font-medium text-text-secondary">
                        {speakerNames[segment.assigned_speaker_id] ??
                          t("meetings.review.unknownSpeaker")}
                      </span>
                    </p>
                    <Button
                      type="button"
                      variant="danger-ghost"
                      size="sm"
                      onClick={() =>
                        onSegmentEdit(segment.base.segment_id, text, true)
                      }
                      disabled={disabled || segment.removed}
                    >
                      {t("meetings.review.removeSegment")}
                    </Button>
                  </div>
                  <Textarea
                    key={`${segment.base.segment_id}:${segment.edit_revision ?? "base"}`}
                    variant="compact"
                    defaultValue={text}
                    aria-label={t("meetings.review.transcriptSegment")}
                    disabled={disabled}
                    onBlur={(event) => {
                      const nextText = event.target.value.trim();
                      if (nextText !== text && nextText.length > 0) {
                        onSegmentEdit(segment.base.segment_id, nextText, false);
                      }
                    }}
                    className={`mt-1.5 min-h-[46px] w-full ${segment.removed ? "line-through" : ""}`}
                  />
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      <Section
        title={t("meetings.review.status")}
        description={t("meetings.review.statusDescription")}
      >
        <div className="space-y-3">
          <MeetingSourceList
            sources={snapshot.session.sources}
            label={t("meetings.review.status")}
          />
          <ProcessingStatusText
            status={snapshot.session.processing_status}
            className="block"
          />
        </div>
      </Section>

      <Section
        title={t("meetings.review.timeline")}
        description={t("meetings.review.timelineDescription")}
      >
        {snapshot.gaps.length === 0 ? (
          <StatusText tone="muted" className="block">
            {t("meetings.review.noGaps")}
          </StatusText>
        ) : (
          <ul
            role="list"
            aria-label={t("meetings.review.timeline")}
            className="meeting-rows"
          >
            {snapshot.gaps.map((gap) => (
              <li
                key={`${gap.track_id}:${gap.epoch}:${gap.start_offset_ns ?? "start"}`}
                className="meeting-row"
              >
                <span className="min-w-0">
                  <p className="meeting-row-label">
                    {t(`meetings.gaps.${gap.reason}`)}
                  </p>
                  <span className="microlabel tabular-nums">
                    {gap.start_offset_ns === null
                      ? t("meetings.review.timeUnknown")
                      : formatMeetingOffset(gap.start_offset_ns)}
                    {" – "}
                    {gap.end_offset_ns === null
                      ? t("meetings.review.timeUnknown")
                      : formatMeetingOffset(gap.end_offset_ns)}
                  </span>
                </span>
                {gap.dropped_frames === null ? null : (
                  <StatusText tone="muted" className="meeting-row-value">
                    {t(
                      "meetings.review.droppedFrames",
                      "Dropped frames: {{total}}",
                      { total: gap.dropped_frames },
                    )}
                  </StatusText>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
};

interface MeetingSearchHitRowProps {
  hit: MeetingSearchHit;
  onJump: (segmentId: string) => void;
}

/* A transcript hit is a jump; a note or title hit is a fact about where the
 * match lives, because neither has a transcript row to scroll to. */
const MeetingSearchHitRow: React.FC<MeetingSearchHitRowProps> = ({
  hit,
  onJump,
}) => {
  const { t } = useTranslation();
  const kindLabel =
    hit.kind === "transcript"
      ? t("meetings.review.hitKind.transcript", "Transcript")
      : hit.kind === "manual_note"
        ? t("meetings.review.hitKind.manualNote", "Manual note")
        : t("meetings.review.hitKind.title", "Meeting title");
  const body = (
    <>
      <span className="flex items-baseline gap-2">
        <span className="microlabel tabular-nums">
          {formatMeetingOffset(hit.start_offset_ns)}
        </span>
        <span className="microlabel">{kindLabel}</span>
      </span>
      <span className="mt-0.5 line-clamp-2 block text-[13px] leading-5 text-text-primary">
        {hit.excerpt}
      </span>
    </>
  );

  if (hit.kind !== "transcript") {
    return <li className="meeting-row-stacked">{body}</li>;
  }

  return (
    <li className="meeting-row-stacked meeting-row-flush">
      <button
        type="button"
        onClick={() => onJump(hit.entity_id)}
        className="w-full cursor-pointer rounded-control px-2 py-3 text-start outline-offset-[-2px] transition-[background-color] duration-150 ease-out hover:bg-hover active:bg-pressed"
      >
        {body}
      </button>
    </li>
  );
};

interface SpeakerRowProps {
  speakerId: SpeakerId;
  name: string;
  disabled: boolean;
  onRename: (speakerId: SpeakerId, name: string) => void;
}

const SpeakerRow: React.FC<SpeakerRowProps> = ({
  speakerId,
  name,
  disabled,
  onRename,
}) => {
  const { t } = useTranslation();
  const [draftName, setDraftName] = useState(name);
  const trimmedName = draftName.trim();
  const canSave = trimmedName.length > 0 && trimmedName !== name;

  return (
    <li className="meeting-row-stacked flex flex-wrap items-center gap-2">
      <Input
        variant="compact"
        value={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        aria-label={t("meetings.review.speakerName")}
        disabled={disabled}
        className="min-w-0 flex-1"
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onRename(speakerId, trimmedName)}
        disabled={disabled || !canSave}
      >
        {t("common.save")}
      </Button>
    </li>
  );
};

interface MeetingSpeakerMergeProps {
  speakers: MeetingReviewSnapshot["speakers"];
  disabled: boolean;
  onMerge: (sourceSpeakerId: SpeakerId, targetSpeakerId: SpeakerId) => void;
}

const MeetingSpeakerMerge: React.FC<MeetingSpeakerMergeProps> = ({
  speakers,
  disabled,
  onMerge,
}) => {
  const { t } = useTranslation();
  const fieldId = useId();
  const [source, setSource] = useState<SpeakerId>(
    speakers[0]?.speaker_id ?? "",
  );
  const [target, setTarget] = useState<SpeakerId>(
    speakers[1]?.speaker_id ?? "",
  );
  const canMerge =
    !disabled && source.length > 0 && target.length > 0 && source !== target;

  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-40">
        <label
          className="mb-1 block text-[12px] leading-4 text-text-secondary"
          htmlFor={`${fieldId}-source`}
        >
          {t("meetings.review.mergeSource")}
        </label>
        <select
          id={`${fieldId}-source`}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          disabled={disabled}
          className="w-full"
        >
          {speakers.map((speaker) => (
            <option key={speaker.speaker_id} value={speaker.speaker_id}>
              {speaker.display_name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0 flex-1 basis-40">
        <label
          className="mb-1 block text-[12px] leading-4 text-text-secondary"
          htmlFor={`${fieldId}-target`}
        >
          {t("meetings.review.mergeTarget")}
        </label>
        <select
          id={`${fieldId}-target`}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          disabled={disabled}
          className="w-full"
        >
          {speakers.map((speaker) => (
            <option key={speaker.speaker_id} value={speaker.speaker_id}>
              {speaker.display_name}
            </option>
          ))}
        </select>
      </div>
      <Button
        type="button"
        variant="secondary"
        onClick={() => onMerge(source, target)}
        disabled={!canMerge}
      >
        {t("meetings.review.merge")}
      </Button>
    </div>
  );
};

export interface InsightsTabProps {
  snapshot: MeetingReviewSnapshot;
  busy: boolean;
  editable: boolean;
  canRegenerate: boolean;
  newNote: string;
  /** Conversation metrics, or null until the first read lands. */
  analytics: MeetingAnalytics | null;
  speakerNames: Record<string, string>;
  /** Ticked action items, keyed by artifact id and index. */
  doneActionItems: Set<string>;
  onNewNoteChange: (value: string) => void;
  onCreateNote: () => void;
  onNoteUpdate: (note: ManualNote, body: string) => void;
  onNoteDelete: (note: ManualNote) => void;
  onRegenerate: () => void;
  onJumpToSegment: (segmentId: string) => void;
  onActionItemToggle: (
    artifactId: string,
    actionIndex: number,
    done: boolean,
  ) => void;
  onRefresh: () => Promise<void>;
  onAnalyticsRefresh: () => Promise<void>;
}

export const InsightsTab: React.FC<InsightsTabProps> = ({
  snapshot,
  busy,
  editable,
  canRegenerate,
  newNote,
  analytics,
  speakerNames,
  doneActionItems,
  onNewNoteChange,
  onCreateNote,
  onNoteUpdate,
  onNoteDelete,
  onRegenerate,
  onJumpToSegment,
  onActionItemToggle,
  onRefresh,
  onAnalyticsRefresh,
}) => {
  const { t } = useTranslation();
  const disabled = busy || !editable;
  const processingStatus = snapshot.session.processing_status;
  const processing =
    processingStatus.kind === "pending" || processingStatus.kind === "running";
  /* Remote processing is modelled end to end and every destination resolves to
   * RemoteUnavailable today, so the failure gets named instead of leaving an
   * empty panel behind a route that never completes. */
  const remoteUnavailable =
    processingStatus.kind === "failed" &&
    processingStatus.reason === "remote_unavailable";

  return (
    <>
      {analytics === null ? null : (
        <MeetingAnalyticsStrip
          analytics={analytics}
          speakerNames={speakerNames}
          onJumpToSegment={onJumpToSegment}
        />
      )}

      <MeetingNotesPane
        sessionId={snapshot.session.session_id}
        revision={snapshot.session.revision}
        variant="review"
        disabled={busy}
        onEnhanced={async () => {
          await onRefresh();
          await onAnalyticsRefresh();
        }}
      />

      <Section
        title={t("meetings.review.manualNotes")}
        description={t("meetings.review.manualNotesDescription")}
      >
        <Textarea
          value={newNote}
          onChange={(event) => onNewNoteChange(event.target.value)}
          placeholder={t("meetings.review.notePlaceholder")}
          aria-label={t("meetings.review.newNote")}
          disabled={disabled}
          className="w-full"
        />
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCreateNote}
            disabled={disabled || newNote.trim().length === 0}
          >
            {t("meetings.review.addNote")}
          </Button>
        </div>
        {snapshot.notes.length === 0 ? (
          <StatusText tone="muted" className="mt-2 block">
            {t("meetings.review.noNotes")}
          </StatusText>
        ) : (
          <ul
            role="list"
            aria-label={t("meetings.review.manualNotes")}
            className="meeting-rows mt-3"
          >
            {snapshot.notes.map((note) => (
              <ManualNoteEditor
                key={`${note.note_id}:${note.revision}:${note.body}`}
                note={note}
                disabled={disabled}
                onUpdate={onNoteUpdate}
                onDelete={onNoteDelete}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={t("meetings.review.generatedNotes")}
        description={t("meetings.review.generatedNotesDescription")}
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRegenerate}
            disabled={busy || !canRegenerate}
          >
            <RefreshCcw size={14} aria-hidden="true" />
            {t("meetings.review.regenerate")}
          </Button>
        }
      >
        {remoteUnavailable ? (
          <StatusText tone="danger" className="mb-2 block">
            {t(
              "meetings.review.remoteProcessingUnavailable",
              "The remote destination never became available, so nothing was generated. Regenerating runs on this Mac.",
            )}
          </StatusText>
        ) : null}
        {snapshot.artifacts.length === 0 ? (
          processing ? (
            <EmptyState
              title={t(
                "meetings.review.processingTitle",
                "Sona is still processing this meeting",
              )}
              description={t(
                "meetings.review.processingDescription",
                "Generated notes and local answers appear once the transcript is complete.",
              )}
              action={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void onRefresh()}
                  disabled={busy}
                >
                  {t("meetings.actions.refresh")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={t("meetings.review.noGeneratedNotes")}
              description={t(
                "meetings.review.noGeneratedNotesDescription",
                "Generated notes are derived from the transcript, so they can be rebuilt at any time.",
              )}
              action={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onRegenerate}
                  disabled={busy || !canRegenerate}
                >
                  {t("meetings.review.regenerate")}
                </Button>
              }
            />
          )
        ) : (
          <div className="space-y-4">
            {snapshot.artifacts.map((artifact) => (
              <MeetingArtifactPanel
                key={artifact.artifact_id}
                artifact={artifact}
                doneActionItems={doneActionItems}
                actionsDisabled={busy}
                onJump={onJumpToSegment}
                onActionItemToggle={onActionItemToggle}
              />
            ))}
          </div>
        )}
      </Section>
    </>
  );
};

interface ManualNoteEditorProps {
  note: ManualNote;
  disabled: boolean;
  onUpdate: (note: ManualNote, body: string) => void;
  onDelete: (note: ManualNote) => void;
}

const ManualNoteEditor: React.FC<ManualNoteEditorProps> = ({
  note,
  disabled,
  onUpdate,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [draftBody, setDraftBody] = useState(note.body);
  const trimmedBody = draftBody.trim();
  const canSave = trimmedBody.length > 0 && trimmedBody !== note.body;

  return (
    <li className="meeting-row-stacked">
      <p className="microlabel tabular-nums">
        {note.start_offset_ns === null
          ? t("meetings.review.noTimestamp")
          : t("meetings.review.timestamp", {
              time: formatMeetingOffset(note.start_offset_ns),
            })}
      </p>
      <Textarea
        variant="compact"
        value={draftBody}
        onChange={(event) => setDraftBody(event.target.value)}
        aria-label={t("meetings.review.manualNote")}
        disabled={disabled}
        className="mt-1.5 w-full"
      />
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="danger-ghost"
          size="sm"
          onClick={() => onDelete(note)}
          disabled={disabled}
        >
          {t("common.delete")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onUpdate(note, trimmedBody)}
          disabled={disabled || !canSave}
        >
          {t("common.save")}
        </Button>
      </div>
    </li>
  );
};

interface MeetingArtifactPanelProps {
  artifact: MeetingArtifactRevision;
  doneActionItems: Set<string>;
  actionsDisabled: boolean;
  onJump: (segmentId: string) => void;
  onActionItemToggle: (
    artifactId: string,
    actionIndex: number,
    done: boolean,
  ) => void;
}

const MeetingArtifactPanel: React.FC<MeetingArtifactPanelProps> = ({
  artifact,
  doneActionItems,
  actionsDisabled,
  onJump,
  onActionItemToggle,
}) => {
  const { t } = useTranslation();
  const content = artifact.content;

  return (
    <article className="meeting-artifact">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-[13px] leading-[19px] font-semibold text-text-primary">
            {t("meetings.review.template", { template: artifact.template_id })}
          </h3>
          <StatusText tone="muted" className="block tabular-nums">
            {t("meetings.review.artifactRevision", {
              templateVersion: artifact.template_version,
              revision: artifact.input_revision,
            })}
          </StatusText>
        </div>
        <StatusText
          tone={ARTIFACT_STATE_TONES[artifact.state]}
          className="flex-none font-medium"
        >
          {t(`meetings.artifactState.${artifact.state}`)}
        </StatusText>
      </header>
      {content === null ? (
        <p className="mt-2 text-[12.5px] leading-[18px] text-text-secondary">
          {t("meetings.review.artifactUnavailable")}
        </p>
      ) : (
        <div className="mt-3">
          <ArtifactBlock title={t("meetings.review.summary")}>
            <CitedText value={content.summary} onJump={onJump} />
          </ArtifactBlock>
          <ArtifactBlock title={t("meetings.review.topics")}>
            {content.outline.length === 0 ? (
              <StatusText tone="muted">{t("meetings.review.none")}</StatusText>
            ) : (
              <ul className="space-y-2.5">
                {content.outline.map((topic, index) => (
                  <li key={`${artifact.artifact_id}:topic:${index}`}>
                    <CitedText value={topic.title} onJump={onJump} />
                    {topic.detail ? (
                      <div className="mt-1 ps-3">
                        <CitedText value={topic.detail} onJump={onJump} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </ArtifactBlock>
          <ArtifactBlock title={t("meetings.review.decisions")}>
            {content.decisions.length === 0 ? (
              <StatusText tone="muted">{t("meetings.review.none")}</StatusText>
            ) : (
              <ul className="space-y-2.5">
                {content.decisions.map((decision, index) => (
                  <li key={`${artifact.artifact_id}:decision:${index}`}>
                    <CitedText value={decision} onJump={onJump} />
                  </li>
                ))}
              </ul>
            )}
          </ArtifactBlock>
          <ArtifactBlock title={t("meetings.review.actions")}>
            {content.action_items.length === 0 ? (
              <StatusText tone="muted">{t("meetings.review.none")}</StatusText>
            ) : (
              <ul className="space-y-2.5">
                {content.action_items.map((action, index) => {
                  const key = actionItemKey(artifact.artifact_id, index);
                  const done = doneActionItems.has(key);
                  return (
                    <li key={key} className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={done}
                        disabled={actionsDisabled}
                        onChange={(event) =>
                          onActionItemToggle(
                            artifact.artifact_id,
                            index,
                            event.target.checked,
                          )
                        }
                        aria-label={t(
                          "meetings.review.actionDone",
                          "Mark this action item done",
                        )}
                        className="meeting-check"
                      />
                      <div
                        className={`min-w-0 flex-1 ${done ? "line-through opacity-60" : ""}`}
                      >
                        <CitedText value={action.text} onJump={onJump} />
                        <StatusText tone="muted" className="mt-0.5 block">
                          {t("meetings.review.actionMeta", {
                            owner:
                              action.owner_text ??
                              t("meetings.review.unassigned"),
                            due:
                              action.due_text ?? t("meetings.review.noDueDate"),
                          })}
                        </StatusText>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </ArtifactBlock>
          <ArtifactBlock title={t("meetings.review.keyQuestions")}>
            {content.key_questions.length === 0 ? (
              <StatusText tone="muted">{t("meetings.review.none")}</StatusText>
            ) : (
              <ul className="space-y-2.5">
                {content.key_questions.map((item, index) => (
                  <li key={`${artifact.artifact_id}:question:${index}`}>
                    <CitedText value={item} onJump={onJump} />
                  </li>
                ))}
              </ul>
            )}
          </ArtifactBlock>
          <ArtifactBlock title={t("meetings.review.risks")}>
            {content.risks.length === 0 ? (
              <StatusText tone="muted">{t("meetings.review.none")}</StatusText>
            ) : (
              <ul className="space-y-2.5">
                {content.risks.map((item, index) => (
                  <li key={`${artifact.artifact_id}:risk:${index}`}>
                    <CitedText value={item} onJump={onJump} />
                  </li>
                ))}
              </ul>
            )}
          </ArtifactBlock>
          <ArtifactBlock title={t("meetings.review.followUp")}>
            <CitedText value={content.follow_up_draft} onJump={onJump} />
          </ArtifactBlock>
        </div>
      )}
    </article>
  );
};

interface ArtifactBlockProps {
  title: string;
  children: React.ReactNode;
}

const ArtifactBlock: React.FC<ArtifactBlockProps> = ({ title, children }) => (
  <section className="meeting-artifact-block">
    <h4 className={`mb-1.5 ${CAPTION_CLASSES}`}>{title}</h4>
    {children}
  </section>
);

export interface QuestionsTabProps {
  snapshot: MeetingReviewSnapshot;
  canAskQuestion: boolean;
  question: string;
  askingQuestion: boolean;
  onQuestionChange: (value: string) => void;
  onAskQuestion: () => void;
  onForgetQuestion: (questionId: string) => void;
  onJumpToSegment: (segmentId: string) => void;
}

export const QuestionsTab: React.FC<QuestionsTabProps> = ({
  snapshot,
  canAskQuestion,
  question,
  askingQuestion,
  onQuestionChange,
  onAskQuestion,
  onForgetQuestion,
  onJumpToSegment,
}) => {
  const { t } = useTranslation();

  return (
    <Section
      title={t("meetings.review.questions")}
      description={t("meetings.review.questionsDescription")}
    >
      <Textarea
        value={question}
        onChange={(event) => onQuestionChange(event.target.value)}
        placeholder={t("meetings.review.questionPlaceholder")}
        aria-label={t("meetings.review.questions")}
        disabled={!canAskQuestion || askingQuestion}
        variant="compact"
        className="w-full"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <StatusText tone="muted" live="polite">
          {!canAskQuestion
            ? t(
                "meetings.review.askUnavailable",
                "Asking needs a finished local transcript.",
              )
            : askingQuestion
              ? t("meetings.review.asking", "Asking this meeting…")
              : null}
        </StatusText>
        <Button
          type="button"
          variant="secondary"
          onClick={onAskQuestion}
          disabled={
            !canAskQuestion || askingQuestion || question.trim().length === 0
          }
        >
          {t("meetings.review.ask")}
        </Button>
      </div>

      {snapshot.questions.length === 0 ? (
        <StatusText tone="muted" className="mt-3 block">
          {t("meetings.review.noQuestions")}
        </StatusText>
      ) : (
        <ul
          role="list"
          aria-label={t("meetings.review.questions")}
          className="mt-4"
        >
          {snapshot.questions.map((answer) => (
            <li
              key={`${answer.question_id}:${answer.revision}`}
              className="meeting-answer"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className={CAPTION_CLASSES}>
                  {t("meetings.review.youAsked", "You asked")}
                </p>
                <StatusText
                  tone={ANSWER_STATE_TONES[answer.state]}
                  className="flex-none"
                >
                  {t(`meetings.answerState.${answer.state}`)}
                </StatusText>
              </div>
              <p className="mt-1 text-[13px] leading-5 font-semibold text-text-primary text-pretty">
                {answer.question ?? t("meetings.review.question")}
              </p>
              <div className="mt-3">
                <p className={CAPTION_CLASSES}>
                  {t("meetings.review.sonaAnswered", "Sona answered")}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-text-primary text-pretty">
                  {answer.answer ?? t("meetings.review.insufficientEvidence")}
                </p>
                {answer.citations.length > 0 ? (
                  <div className="mt-1.5">
                    <AnswerCitations
                      citations={answer.citations}
                      onJump={onJumpToSegment}
                    />
                  </div>
                ) : null}
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onForgetQuestion(answer.question_id)}
                    disabled={askingQuestion || answer.state === "forgotten"}
                  >
                    {t("meetings.review.forget")}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
};
