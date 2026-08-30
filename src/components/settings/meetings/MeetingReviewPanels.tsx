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
  Microlabel,
  Notice,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Checkbox } from "@/components/vg/checkbox";
import { Input } from "@/components/vg/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { Textarea } from "@/components/vg/textarea";
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
 * whole reason the backend attaches citations at all.
 *
 * Every panel is one card of hairline rows under a mono label. The section
 * descriptions are gone: each of them restated the label above it or the
 * control below it. */

/** DOM id prefix for transcript rows, so a citation can find its segment. */
const SEGMENT_DOM_PREFIX = "meeting-transcript-segment-";

/** A measurement inside a row: mono, tabular, quiet. */
const MONO_FACT = "font-mono text-[11px] tabular-nums text-gray-700";

const ANSWER_STATE_CLASSES = {
  supported: "text-gray-700",
  insufficient_evidence: "text-amber-900",
  unavailable: "text-amber-900",
  out_of_date: "text-amber-900",
  forgotten: "text-gray-700",
} as const satisfies Record<MeetingAnswerState, string>;

const ARTIFACT_STATE_CLASSES = {
  current: "text-gray-700",
  out_of_date: "text-amber-900",
  failed: "text-red-900",
} as const satisfies Record<MeetingArtifactState, string>;

export interface SegmentJump {
  segmentId: string;
  /** Bumped on every jump so repeating the same citation scrolls again. */
  nonce: number;
}

export interface CitationJumpProps {
  startOffsetNs: number | null;
  segmentId: string | null;
  onJump: (segmentId: string) => void;
}

/* A citation is a jump, so it looks like the thing that jumps: the accent
 * colour with the timestamp kept monospaced and tabular. It degrades to plain
 * text when it points at a manual note or the title, which have no transcript
 * row to scroll to. */
export const CitationJump: React.FC<CitationJumpProps> = ({
  startOffsetNs,
  segmentId,
  onJump,
}) => {
  const { t } = useTranslation();
  const label = t("meetings.review.citation", {
    time: formatMeetingOffset(startOffsetNs),
  });

  if (segmentId === null) {
    return (
      <span className="px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-gray-700">
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onJump(segmentId)}
      className="rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-blue-900 transition-colors hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
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
  <div className="flex flex-col gap-1">
    <p className="text-[13px] leading-5 text-pretty text-gray-1000">
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
      <SettingsSection label={t("meetings.review.exactSearch")}>
        <div className="flex flex-col gap-3 p-4">
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
              className="max-w-[320px]"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={searching || searchQuery.trim().length === 0}
            >
              <Search aria-hidden="true" className="size-3.5" />
              {searching
                ? t("meetings.review.searching", "Searching…")
                : t("meetings.review.search")}
            </Button>
          </form>
          {searchHits !== null && searchHits.length === 0 ? (
            <Notice tone="muted">{t("meetings.review.noSearchResults")}</Notice>
          ) : null}
        </div>
        {searchHits === null || searchHits.length === 0 ? null : (
          <ul
            role="list"
            aria-label={t("meetings.review.exactSearch")}
            className="divide-y divide-gray-alpha-400"
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
      </SettingsSection>

      <SettingsSection
        label={t("meetings.review.speakers")}
        action={
          <span className="font-mono text-[11px] text-gray-700">
            {t(`meetings.diarization.${snapshot.diarization.status}`)}
          </span>
        }
      >
        {snapshot.speakers.length === 0 ? (
          <div className="px-4 py-3">
            <Notice tone="muted" live={false}>
              {t("meetings.review.noSpeakers")}
            </Notice>
          </div>
        ) : (
          <>
            <ul
              role="list"
              aria-label={t("meetings.review.speakers")}
              className="divide-y divide-gray-alpha-400"
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
      </SettingsSection>

      <SettingsSection label={t("meetings.review.transcript")}>
        {snapshot.transcript.length === 0 ? (
          <div className="px-4 py-3">
            <Notice tone="muted" live={false}>
              {t("meetings.review.noTranscript")}
            </Notice>
          </div>
        ) : (
          <ol
            role="list"
            aria-label={t("meetings.review.transcript")}
            className="divide-y divide-gray-alpha-400"
          >
            {snapshot.transcript.map((segment) => {
              const text = segment.replacement_text ?? segment.base.text;
              const highlighted = jump?.segmentId === segment.base.segment_id;
              return (
                <li
                  key={segment.base.segment_id}
                  id={`${SEGMENT_DOM_PREFIX}${segment.base.segment_id}`}
                  className={`flex flex-col gap-1.5 px-4 py-3 ${highlighted ? "bg-gray-alpha-100" : ""}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="flex min-w-0 items-baseline gap-2">
                      <span className={MONO_FACT}>
                        {formatMeetingOffset(segment.base.start_offset_ns)}
                      </span>
                      <span className="truncate text-sm text-gray-900">
                        {speakerNames[segment.assigned_speaker_id] ??
                          t("meetings.review.unknownSpeaker")}
                      </span>
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-red-900 hover:text-red-900"
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
                    defaultValue={text}
                    aria-label={t("meetings.review.transcriptSegment")}
                    disabled={disabled}
                    onBlur={(event) => {
                      const nextText = event.target.value.trim();
                      if (nextText !== text && nextText.length > 0) {
                        onSegmentEdit(segment.base.segment_id, nextText, false);
                      }
                    }}
                    className={`min-h-[46px] resize-none ${segment.removed ? "line-through" : ""}`}
                  />
                </li>
              );
            })}
          </ol>
        )}
      </SettingsSection>

      <SettingsSection label={t("meetings.review.status")}>
        <MeetingSourceList
          sources={snapshot.session.sources}
          label={t("meetings.review.status")}
        />
        <div className="px-4 py-3">
          <ProcessingStatusText
            status={snapshot.session.processing_status}
            className="block"
          />
        </div>
      </SettingsSection>

      <SettingsSection label={t("meetings.review.timeline")}>
        {snapshot.gaps.length === 0 ? (
          <div className="px-4 py-3">
            <Notice tone="muted" live={false}>
              {t("meetings.review.noGaps")}
            </Notice>
          </div>
        ) : (
          <ul
            role="list"
            aria-label={t("meetings.review.timeline")}
            className="divide-y divide-gray-alpha-400"
          >
            {snapshot.gaps.map((gap) => (
              <li
                key={`${gap.track_id}:${gap.epoch}:${gap.start_offset_ns ?? "start"}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5"
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="text-[13px] leading-5 text-gray-1000">
                    {t(`meetings.gaps.${gap.reason}`)}
                  </span>
                  <span className={MONO_FACT}>
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
                  <span className={`flex-none ${MONO_FACT}`}>
                    {t(
                      "meetings.review.droppedFrames",
                      "Dropped frames: {{total}}",
                      { total: gap.dropped_frames },
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
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
        <span className={MONO_FACT}>
          {formatMeetingOffset(hit.start_offset_ns)}
        </span>
        <Microlabel>{kindLabel}</Microlabel>
      </span>
      <span className="line-clamp-2 block text-[13px] leading-5 text-gray-1000">
        {hit.excerpt}
      </span>
    </>
  );

  if (hit.kind !== "transcript") {
    return <li className="flex flex-col gap-1 px-4 py-3">{body}</li>;
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onJump(hit.entity_id)}
        className="flex w-full cursor-pointer flex-col gap-1 px-4 py-3 text-start transition-colors hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
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
    <li className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <Input
        value={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        aria-label={t("meetings.review.speakerName")}
        disabled={disabled}
        className="h-8 min-w-0 flex-1"
      />
      <Button
        type="button"
        variant="outline"
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
    <div className="flex flex-wrap items-end gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
        <label
          className="text-[13px] text-gray-900"
          htmlFor={`${fieldId}-source`}
        >
          {t("meetings.review.mergeSource")}
        </label>
        <Select value={source} onValueChange={setSource} disabled={disabled}>
          <SelectTrigger id={`${fieldId}-source`} size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {speakers.map((speaker) => (
              <SelectItem key={speaker.speaker_id} value={speaker.speaker_id}>
                {speaker.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
        <label
          className="text-[13px] text-gray-900"
          htmlFor={`${fieldId}-target`}
        >
          {t("meetings.review.mergeTarget")}
        </label>
        <Select value={target} onValueChange={setTarget} disabled={disabled}>
          <SelectTrigger id={`${fieldId}-target`} size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {speakers.map((speaker) => (
              <SelectItem key={speaker.speaker_id} value={speaker.speaker_id}>
                {speaker.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
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

      <SettingsSection label={t("meetings.review.manualNotes")}>
        <div className="flex flex-col gap-2 p-4">
          <Textarea
            value={newNote}
            onChange={(event) => onNewNoteChange(event.target.value)}
            placeholder={t("meetings.review.notePlaceholder")}
            aria-label={t("meetings.review.newNote")}
            disabled={disabled}
            rows={3}
            className="resize-none"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCreateNote}
              disabled={disabled || newNote.trim().length === 0}
            >
              {t("meetings.review.addNote")}
            </Button>
          </div>
        </div>
        {snapshot.notes.length === 0 ? (
          <div className="px-4 py-3">
            <Notice tone="muted" live={false}>
              {t("meetings.review.noNotes")}
            </Notice>
          </div>
        ) : (
          <ul
            role="list"
            aria-label={t("meetings.review.manualNotes")}
            className="divide-y divide-gray-alpha-400"
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
      </SettingsSection>

      <SettingsSection
        label={t("meetings.review.generatedNotes")}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={busy || !canRegenerate}
          >
            <RefreshCcw aria-hidden="true" className="size-3.5" />
            {t("meetings.review.regenerate")}
          </Button>
        }
      >
        {remoteUnavailable ? (
          <div className="px-4 py-3">
            <Notice tone="danger">
              {t(
                "meetings.review.remoteProcessingUnavailable",
                "The remote destination never became available, so nothing was generated. Regenerating runs on this Mac.",
              )}
            </Notice>
          </div>
        ) : null}
        {snapshot.artifacts.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-4 py-6">
            <h3 className="text-[13px] leading-5 text-gray-1000">
              {processing
                ? t(
                    "meetings.review.processingTitle",
                    "Sona is still processing this meeting",
                  )
                : t("meetings.review.noGeneratedNotes")}
            </h3>
            <Notice tone="muted" live={false}>
              {processing
                ? t(
                    "meetings.review.processingDescription",
                    "Generated notes and local answers appear once the transcript is complete.",
                  )
                : t(
                    "meetings.review.noGeneratedNotesDescription",
                    "Generated notes are derived from the transcript, so they can be rebuilt at any time.",
                  )}
            </Notice>
            {/* Regenerate is already on the section label line; the wait is
             * the only state with a control of its own. */}
            {processing ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onRefresh()}
                disabled={busy}
              >
                {t("meetings.actions.refresh")}
              </Button>
            ) : null}
          </div>
        ) : (
          snapshot.artifacts.map((artifact) => (
            <MeetingArtifactPanel
              key={artifact.artifact_id}
              artifact={artifact}
              doneActionItems={doneActionItems}
              actionsDisabled={busy}
              onJump={onJumpToSegment}
              onActionItemToggle={onActionItemToggle}
            />
          ))
        )}
      </SettingsSection>
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
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <Microlabel>
        {note.start_offset_ns === null
          ? t("meetings.review.noTimestamp")
          : t("meetings.review.timestamp", {
              time: formatMeetingOffset(note.start_offset_ns),
            })}
      </Microlabel>
      <Textarea
        value={draftBody}
        onChange={(event) => setDraftBody(event.target.value)}
        aria-label={t("meetings.review.manualNote")}
        disabled={disabled}
        rows={2}
        className="resize-none"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-red-900 hover:text-red-900"
          onClick={() => onDelete(note)}
          disabled={disabled}
        >
          {t("common.delete")}
        </Button>
        <Button
          type="button"
          variant="outline"
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
    <article className="flex flex-col gap-4 px-4 py-4">
      {/* The template names the artifact; the state word answers the only
       * question the version and source revision were there to answer, and
       * answered it in the same breath as a second "Template". */}
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="min-w-0 text-[13px] leading-5 font-medium text-gray-1000">
          {t("meetings.review.template", { template: artifact.template_id })}
        </h3>
        <span
          className={`flex-none font-mono text-[11px] ${ARTIFACT_STATE_CLASSES[artifact.state]}`}
        >
          {t(`meetings.artifactState.${artifact.state}`)}
        </span>
      </header>
      {content === null ? (
        <Notice tone="muted" live={false}>
          {t("meetings.review.artifactUnavailable")}
        </Notice>
      ) : (
        <>
          <ArtifactBlock title={t("meetings.review.summary")}>
            <CitedText value={content.summary} onJump={onJump} />
          </ArtifactBlock>
          <ArtifactBlock title={t("meetings.review.topics")}>
            {content.outline.length === 0 ? (
              <EmptyBlock />
            ) : (
              <ul className="flex flex-col gap-2.5">
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
              <EmptyBlock />
            ) : (
              <ul className="flex flex-col gap-2.5">
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
              <EmptyBlock />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {content.action_items.map((action, index) => {
                  const key = actionItemKey(artifact.artifact_id, index);
                  const done = doneActionItems.has(key);
                  return (
                    <li key={key} className="flex items-start gap-2.5">
                      <Checkbox
                        checked={done}
                        disabled={actionsDisabled}
                        onCheckedChange={(checked) =>
                          onActionItemToggle(
                            artifact.artifact_id,
                            index,
                            checked === true,
                          )
                        }
                        aria-label={t(
                          "meetings.review.actionDone",
                          "Mark this action item done",
                        )}
                        className="mt-1"
                      />
                      <div
                        className={`min-w-0 flex-1 ${done ? "line-through opacity-60" : ""}`}
                      >
                        <CitedText value={action.text} onJump={onJump} />
                        {/* Mono, but not uppercased: the owner is somebody's
                         * name and a microlabel would shout it. */}
                        <span className="mt-0.5 block font-mono text-[11px] text-gray-700">
                          {t("meetings.review.actionMeta", {
                            owner:
                              action.owner_text ??
                              t("meetings.review.unassigned"),
                            due:
                              action.due_text ?? t("meetings.review.noDueDate"),
                          })}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </ArtifactBlock>
          <ArtifactBlock title={t("meetings.review.keyQuestions")}>
            {content.key_questions.length === 0 ? (
              <EmptyBlock />
            ) : (
              <ul className="flex flex-col gap-2.5">
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
              <EmptyBlock />
            ) : (
              <ul className="flex flex-col gap-2.5">
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
        </>
      )}
    </article>
  );
};

/** A generated block the model returned nothing for. */
const EmptyBlock: React.FC = () => {
  const { t } = useTranslation();

  return (
    <span className="text-sm text-gray-700">{t("meetings.review.none")}</span>
  );
};

interface ArtifactBlockProps {
  title: string;
  children: React.ReactNode;
}

const ArtifactBlock: React.FC<ArtifactBlockProps> = ({ title, children }) => (
  <section className="flex flex-col gap-1.5">
    <h4>
      <Microlabel>{title}</Microlabel>
    </h4>
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
    <SettingsSection label={t("meetings.review.questions")}>
      <div className="flex flex-col gap-2 p-4">
        {/* The one sentence this surface keeps: where the answer comes from
         * is not inferable from a text box and a button. */}
        <p className="text-sm text-gray-700">
          {t("meetings.review.questionsDescription")}
        </p>
        <Textarea
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder={t("meetings.review.questionPlaceholder")}
          aria-label={t("meetings.review.questions")}
          disabled={!canAskQuestion || askingQuestion}
          rows={2}
          className="resize-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Notice tone="muted">
            {!canAskQuestion
              ? t(
                  "meetings.review.askUnavailable",
                  "Asking needs a finished local transcript.",
                )
              : askingQuestion
                ? t("meetings.review.asking", "Asking this meeting…")
                : null}
          </Notice>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ms-auto"
            onClick={onAskQuestion}
            disabled={
              !canAskQuestion || askingQuestion || question.trim().length === 0
            }
          >
            {t("meetings.review.ask")}
          </Button>
        </div>
      </div>

      {snapshot.questions.length === 0 ? (
        <div className="px-4 py-3">
          <Notice tone="muted" live={false}>
            {t("meetings.review.noQuestions")}
          </Notice>
        </div>
      ) : (
        <ul
          role="list"
          aria-label={t("meetings.review.questions")}
          className="divide-y divide-gray-alpha-400"
        >
          {snapshot.questions.map((answer) => (
            <li
              key={`${answer.question_id}:${answer.revision}`}
              className="flex flex-col gap-3 px-4 py-3"
            >
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Microlabel>
                    {t("meetings.review.youAsked", "You asked")}
                  </Microlabel>
                  <span
                    className={`flex-none font-mono text-[11px] ${ANSWER_STATE_CLASSES[answer.state]}`}
                  >
                    {t(`meetings.answerState.${answer.state}`)}
                  </span>
                </div>
                <p className="text-[13px] leading-5 font-medium text-pretty text-gray-1000">
                  {answer.question ?? t("meetings.review.question")}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <Microlabel>
                  {t("meetings.review.sonaAnswered", "Sona answered")}
                </Microlabel>
                <p className="text-[13px] leading-5 text-pretty text-gray-900">
                  {answer.answer ?? t("meetings.review.insufficientEvidence")}
                </p>
                {answer.citations.length > 0 ? (
                  <AnswerCitations
                    citations={answer.citations}
                    onJump={onJumpToSegment}
                  />
                ) : null}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
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
    </SettingsSection>
  );
};
