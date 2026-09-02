import React, { useEffect, useState } from "react";
import { Pencil, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  MeetingReviewSnapshot,
  MeetingSearchHit,
  SpeakerId,
} from "@/bindings";
import { cn } from "@/lib/cn";
import {
  Microlabel,
  Notice,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import { Textarea } from "@/components/vg/textarea";
import { MeetingSourceList, ProcessingStatusText } from "../MeetingStatus";
import { formatMeetingOffset } from "../meetingUtils";
import type { SegmentJump } from "./Citations";
import { GapTimeline } from "./GapTimeline";
import { committedEdit, inlineEditKeys } from "./inlineEdit";
import { SpeakerRoster } from "./SpeakerRoster";

/* The transcript is a document, not a form.
 *
 * What a meeting said is the thing a person came here to read, so every turn
 * is set as prose: a tabular timestamp, who was speaking, and the words. The
 * apparatus for changing those words — the field, and the one destructive
 * action that belongs with it — exists only on the turn somebody is actually
 * correcting, and leaves when they are done. A wall of textareas with a Remove
 * button on every one is what this replaced; it made a record you could not
 * read out of a record you could not edit. */

/** DOM id prefix for transcript rows, so a citation can find its segment. */
const SEGMENT_DOM_PREFIX = "meeting-transcript-segment-";

/** A quiet tabular measurement inside a row. */
const MEASURED_FACT = "text-[11px] tabular-nums text-gray-700";

/** The turn's own type. The field that edits one is set in it too, so opening
 * an editor moves nothing on the page. */
const TURN_TEXT = "text-[13px] leading-5 text-pretty";

/** How long the segment a jump landed on stays lit. Long enough to find with
 * your eye after the scroll, short enough that it does not become the row's
 * resting state. */
const FLASH_MS = 1_200;

export interface TranscriptTabProps {
  snapshot: MeetingReviewSnapshot;
  speakerNames: Record<string, string>;
  busy: boolean;
  editable: boolean;
  jump: SegmentJump | null;
  searchQuery: string;
  searchHits: MeetingSearchHit[] | null;
  onSearchQueryChange: (value: string) => void;
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
  onSearchQueryChange,
  onSegmentEdit,
  onSpeakerRename,
  onSpeakerMerge,
}) => {
  const { t } = useTranslation();
  const disabled = busy || !editable;
  /* The nonce of the last jump whose flash has burned out. A fresh jump is lit
   * on the render that carries it, so the row is already marked when the
   * scroll arrives. */
  const [settledJump, setSettledJump] = useState<number | null>(null);
  /* One turn is open at a time, so the list owns which one — and therefore
   * owns what opening and closing an editor mean. The turn itself holds no
   * state, which is why a jump or an edit can never leave two open. */
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);

  useEffect(() => {
    if (jump === null) return;
    /* A segment that is not on screen has nothing to scroll to, but the flash
     * still has to burn out or the row would arrive already lit. */
    document
      .getElementById(`${SEGMENT_DOM_PREFIX}${jump.segmentId}`)
      ?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    const timer = window.setTimeout(() => setSettledJump(jump.nonce), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [jump]);

  const commitTurn = (segmentId: string, current: string, draft: string) => {
    setEditingSegmentId(null);
    const next = committedEdit(draft, current);
    if (next !== null) onSegmentEdit(segmentId, next, false);
  };

  const removeTurn = (segmentId: string, current: string) => {
    setEditingSegmentId(null);
    onSegmentEdit(segmentId, current, true);
  };

  /* Typing narrows the transcript to the turns that carry the words, and the
   * store's own answer is folded in beside them: its index matches what a
   * substring scan cannot, and it is the authority on what this meeting
   * contains. What it found outside the transcript has no turn to become, so
   * it stays a fact about where the match lives. */
  const query = searchQuery.trim().toLocaleLowerCase();
  const hits = searchHits ?? [];
  const hitSegmentIds = new Set(
    hits.filter((hit) => hit.kind === "transcript").map((hit) => hit.entity_id),
  );
  const elsewhere = hits.filter((hit) => hit.kind !== "transcript");
  const turns =
    query.length === 0
      ? snapshot.transcript
      : snapshot.transcript.filter(
          (segment) =>
            hitSegmentIds.has(segment.base.segment_id) ||
            (segment.replacement_text ?? segment.base.text)
              .toLocaleLowerCase()
              .includes(query),
        );

  return (
    <>
      <SpeakerRoster
        speakers={snapshot.speakers}
        diarization={snapshot.diarization}
        disabled={disabled}
        onRename={onSpeakerRename}
        onMerge={onSpeakerMerge}
      />

      <SettingsSection
        label={t("meetings.review.transcript")}
        action={
          <div className="relative min-w-40 flex-1 sm:max-w-72">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute start-2 top-1/2 size-3 -translate-y-1/2 text-gray-700"
            />
            <Input
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                onSearchQueryChange("");
              }}
              placeholder={t("meetings.review.searchPlaceholder")}
              aria-label={t("meetings.review.searchPlaceholder")}
              className="h-7 w-full ps-7 text-[13px] md:text-[13px]"
            />
          </div>
        }
      >
        {snapshot.transcript.length === 0 ? (
          <div className="px-4 py-3">
            <Notice tone="muted" live={false}>
              {t("meetings.review.noTranscript")}
            </Notice>
          </div>
        ) : (
          <>
            {elsewhere.length === 0 ? null : (
              <ul role="list" className="divide-y divide-gray-alpha-400">
                {elsewhere.map((hit) => (
                  <li
                    key={`${hit.kind}:${hit.entity_id}`}
                    data-slot="search-hit-elsewhere"
                    className="flex flex-col gap-1 px-4 py-3"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className={MEASURED_FACT}>
                        {formatMeetingOffset(hit.start_offset_ns)}
                      </span>
                      <Microlabel>
                        {hit.kind === "manual_note"
                          ? t("meetings.review.hitKind.manualNote")
                          : t("meetings.review.hitKind.title")}
                      </Microlabel>
                    </span>
                    <span className="line-clamp-2 block text-[13px] leading-5 text-gray-1000">
                      {hit.excerpt}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {turns.length > 0 ? (
              <ol
                role="list"
                aria-label={t("meetings.review.transcript")}
                className="divide-y divide-gray-alpha-400"
              >
                {turns.map((segment) => {
                  const segmentId = segment.base.segment_id;
                  const text = segment.replacement_text ?? segment.base.text;
                  const landed = jump?.segmentId === segmentId;
                  return (
                    <TranscriptTurn
                      key={segmentId}
                      segmentId={segmentId}
                      time={formatMeetingOffset(segment.base.start_offset_ns)}
                      speaker={
                        speakerNames[segment.assigned_speaker_id] ??
                        t("meetings.review.unknownSpeaker")
                      }
                      text={text}
                      query={query}
                      removed={segment.removed}
                      landed={landed}
                      flashing={
                        landed && jump !== null && settledJump !== jump.nonce
                      }
                      editing={editingSegmentId === segmentId}
                      disabled={disabled}
                      onOpenEdit={() => setEditingSegmentId(segmentId)}
                      onCommit={(draft) => commitTurn(segmentId, text, draft)}
                      onCancel={() => setEditingSegmentId(null)}
                      onRemove={() => removeTurn(segmentId, text)}
                    />
                  );
                })}
              </ol>
            ) : elsewhere.length > 0 || searchHits === null ? null : (
              /* The store's verdict, not the substring scan's: while its
               * answer to the query in the field is still on the way, the
               * surface says nothing rather than something untrue. */
              <div className="px-4 py-3">
                <Notice tone="muted" live={false}>
                  {t("meetings.review.noSearchResults")}
                </Notice>
              </div>
            )}
          </>
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

      <GapTimeline gaps={snapshot.gaps} />
    </>
  );
};

export interface TranscriptTurnProps {
  segmentId: string;
  /** Clock reading for the moment this turn starts. */
  time: string;
  speaker: string;
  text: string;
  /** Lower-cased live filter, marked inside the words. Empty marks nothing. */
  query: string;
  removed: boolean;
  /** The turn a citation jumped to, still marked after its flash burned out. */
  landed: boolean;
  flashing: boolean;
  editing: boolean;
  disabled: boolean;
  onOpenEdit: () => void;
  onCommit: (draft: string) => void;
  onCancel: () => void;
  onRemove: () => void;
}

/* One turn, reading or being corrected. It owns neither state: which turn is
 * open and what closing one means both belong to the list, so this renders
 * exactly what it is handed and can be read — or rendered by a test — in
 * either state without arranging a click first. */
export const TranscriptTurn: React.FC<TranscriptTurnProps> = ({
  segmentId,
  time,
  speaker,
  text,
  query,
  removed,
  landed,
  flashing,
  editing,
  disabled,
  onOpenEdit,
  onCommit,
  onCancel,
  onRemove,
}) => {
  const { t } = useTranslation();

  return (
    <li
      id={`${SEGMENT_DOM_PREFIX}${segmentId}`}
      data-slot="transcript-segment"
      /* Reachable by keyboard as a row, because the pencil that appears on it
       * is the second stop, not the first: Enter on the turn opens the same
       * editor the pencil does. */
      tabIndex={editing ? undefined : 0}
      onKeyDown={
        editing || disabled
          ? undefined
          : (event) => {
              if (event.key !== "Enter" || event.target !== event.currentTarget)
                return;
              event.preventDefault();
              onOpenEdit();
            }
      }
      className={cn(
        "group relative flex gap-3 px-4 py-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-700 motion-reduce:transition-none",
        flashing ? "bg-blue-alpha-200" : landed ? "bg-gray-alpha-100" : "",
      )}
    >
      <span className={cn(MEASURED_FACT, "w-10 flex-none pt-0.5")}>{time}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn(TURN_TEXT, "text-gray-700")}>{speaker}</span>
        {editing ? (
          <Textarea
            autoFocus
            rows={1}
            defaultValue={text}
            aria-label={t("meetings.review.transcriptSegment")}
            onBlur={(event) => onCommit(event.target.value)}
            onKeyDown={inlineEditKeys(onCommit, onCancel)}
            className={cn(
              TURN_TEXT,
              "min-h-0 resize-none rounded-none border-0 border-b border-gray-alpha-400 px-0 py-0 text-gray-1000 md:text-[13px]",
            )}
          />
        ) : (
          <p
            className={cn(
              TURN_TEXT,
              "text-gray-1000",
              removed ? "line-through" : "",
            )}
          >
            <MarkedText text={text} query={query} />
          </p>
        )}
        {editing && !removed ? (
          /* The one destructive action this surface has, inside the state it
           * belongs to: you cannot remove a turn you are not already editing,
           * and reading the transcript never puts it in front of anyone. */
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto self-start px-0 text-[11px] font-normal text-red-900 hover:text-red-900"
            onClick={onRemove}
          >
            {t("meetings.review.removeSegment")}
          </Button>
        ) : null}
      </div>
      {editing || disabled ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("meetings.review.editTurn")}
          title={t("meetings.review.editTurn")}
          onClick={onOpenEdit}
          className="absolute end-2 top-2 text-gray-700 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
        >
          <Pencil aria-hidden="true" />
        </Button>
      )}
    </li>
  );
};

interface MarkedTextProps {
  text: string;
  /** Already lower-cased by the caller, which also owns the empty case. */
  query: string;
}

/** The words, with every run the live filter matched marked in place. */
const MarkedText: React.FC<MarkedTextProps> = ({ text, query }) => {
  if (query.length === 0) return <>{text}</>;

  const haystack = text.toLocaleLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (
    let at = haystack.indexOf(query);
    at !== -1;
    at = haystack.indexOf(query, cursor)
  ) {
    if (at > cursor) parts.push(text.slice(cursor, at));
    parts.push(
      <mark key={at} className="bg-blue-100 text-gray-1000">
        {text.slice(at, at + query.length)}
      </mark>,
    );
    cursor = at + query.length;
  }
  if (parts.length === 0) return <>{text}</>;
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <>{parts}</>;
};
