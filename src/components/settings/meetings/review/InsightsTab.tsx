import React, { useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ManualNote, MeetingReviewSnapshot } from "@/bindings";
import {
  Microlabel,
  Notice,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Textarea } from "@/components/vg/textarea";
import { MeetingAnalyticsStrip } from "../MeetingAnalyticsStrip";
import { MeetingNotesPane } from "../MeetingNotesPane";
import type { MeetingAnalytics } from "../meetingAnalytics";
import { formatMeetingOffset } from "../meetingUtils";
import { MeetingArtifactPanel } from "./MeetingArtifactPanel";

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
