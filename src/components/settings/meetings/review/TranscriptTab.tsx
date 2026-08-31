import React, { useEffect } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
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
import { Input } from "@/components/vg/input";
import { Textarea } from "@/components/vg/textarea";
import { MeetingSourceList, ProcessingStatusText } from "../MeetingStatus";
import { formatMeetingOffset } from "../meetingUtils";
import type { SegmentJump } from "./Citations";
import { GapTimeline } from "./GapTimeline";
import { SpeakerRoster } from "./SpeakerRoster";

/** DOM id prefix for transcript rows, so a citation can find its segment. */
const SEGMENT_DOM_PREFIX = "meeting-transcript-segment-";

/** A measurement inside a row: mono, tabular, quiet. */
const MONO_FACT = "font-mono text-[11px] tabular-nums text-gray-700";

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

      <SpeakerRoster
        speakers={snapshot.speakers}
        diarizationStatus={snapshot.diarization.status}
        disabled={disabled}
        onRename={onSpeakerRename}
        onMerge={onSpeakerMerge}
      />

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

      <GapTimeline gaps={snapshot.gaps} />
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
