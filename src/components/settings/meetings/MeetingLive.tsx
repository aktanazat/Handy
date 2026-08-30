import React, { useId, useMemo, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingReviewSnapshot } from "@/bindings";
import {
  FactChip,
  Notice,
  SettingsCard,
  SettingsField,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/vg/dialog";
import { Textarea } from "@/components/vg/textarea";
import {
  MeetingPhaseText,
  MeetingSourceList,
  ProcessingStatusText,
} from "./MeetingStatus";
import { formatMeetingOffset } from "./meetingUtils";
import { MeetingNotesPane } from "./MeetingNotesPane";

/* Capture, while it runs.
 *
 * The state is named once — the phase word on the title line — and the clock
 * is a measurement, not a sentence. Everything the old page said twice (a
 * badge and a phase word for the same state, the anchor time above the note
 * box and again on a chip inside it) is gone: what is left is the state, the
 * clock, what capture is hearing, and the three controls. */

/** Measurements sit in mono so a column of them lines up. */
const MONO_VALUE = "font-mono text-[12px] tabular-nums text-gray-1000";

interface MeetingLiveProps {
  snapshot: MeetingReviewSnapshot;
  pendingAction: string | null;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDiscard: () => void;
  onCreateNote: (body: string) => void;
}

export const MeetingLive: React.FC<MeetingLiveProps> = ({
  snapshot,
  pendingAction,
  onPause,
  onResume,
  onStop,
  onDiscard,
  onCreateNote,
}) => {
  const { t } = useTranslation();
  const [noteBody, setNoteBody] = useState("");
  const noteFieldId = useId();
  const [discardOpen, setDiscardOpen] = useState(false);
  const latestTranscriptOffsetNs = useMemo(() => {
    let latest = 0;
    for (const segment of snapshot.transcript) {
      if (!segment.removed) {
        latest = Math.max(latest, segment.base.end_offset_ns);
      }
    }
    return latest > 0 ? latest : null;
  }, [snapshot.transcript]);
  const elapsedOffsetNs = snapshot.session.elapsed_offset_ns;
  const transcriptLagNs =
    latestTranscriptOffsetNs === null || elapsedOffsetNs === null
      ? null
      : Math.max(0, elapsedOffsetNs - latestTranscriptOffsetNs);
  const systemAudio = snapshot.session.sources.find(
    (source) => source.source_kind === "system_audio",
  );
  const systemAudioLimited =
    systemAudio === undefined ||
    systemAudio.availability !== "available" ||
    systemAudio.health === "failed" ||
    systemAudio.health === "degraded";
  const storageAvailable = snapshot.session.storage === "available";
  const canPause = snapshot.session.allowed_actions.includes("pause");
  const canResume = snapshot.session.allowed_actions.includes("resume");
  const canStop = snapshot.session.allowed_actions.includes("stop");
  const canDiscard = snapshot.session.allowed_actions.includes("discard");
  const isPaused = snapshot.session.phase === "capturing_paused";
  const isMutating = pendingAction !== null;

  const addNote = () => {
    const body = noteBody.trim();
    if (body.length === 0) {
      return;
    }

    onCreateNote(body);
    setNoteBody("");
  };

  return (
    <SettingsPage
      title={snapshot.session.title}
      actions={
        <div className="flex flex-none items-center gap-4">
          <MeetingPhaseText phase={snapshot.session.phase} />
          <FactChip
            label={t("meetings.live.elapsed")}
            value={formatMeetingOffset(elapsedOffsetNs)}
          />
        </div>
      }
    >
      {/* One warning, and it is the consequence of the source state rather
       * than a second reading of it: the inputs below name the source. */}
      {systemAudioLimited ? (
        <Notice tone="warning">
          {t("meetings.live.microphoneOnlyPartial")}
        </Notice>
      ) : snapshot.session.capture_completeness === "partial" ? (
        <Notice tone="warning">{t("meetings.live.partialCapture")}</Notice>
      ) : null}

      <SettingsSection label={t("meetings.live.inputs")}>
        <MeetingSourceList
          sources={snapshot.session.sources}
          label={t("meetings.live.inputs")}
          elapsedOffsetNs={elapsedOffsetNs}
          showTelemetry
        />
      </SettingsSection>

      <SettingsSection label={t("meetings.live.progress")}>
        <SettingsRow label={t("meetings.live.transcript")}>
          <span className={MONO_VALUE}>
            {latestTranscriptOffsetNs === null
              ? t("meetings.live.notReported")
              : formatMeetingOffset(latestTranscriptOffsetNs)}
          </span>
        </SettingsRow>
        <SettingsRow label={t("meetings.live.asrLag")}>
          <span className={MONO_VALUE}>
            {transcriptLagNs === null
              ? t("meetings.live.notReported")
              : formatMeetingOffset(transcriptLagNs)}
          </span>
        </SettingsRow>
        <SettingsRow label={t("meetings.live.storage")}>
          <span
            className={
              storageAvailable
                ? "text-sm text-gray-900"
                : "text-sm text-red-900"
            }
          >
            {storageAvailable
              ? t("meetings.live.storageHealthy")
              : t("meetings.live.storageUnavailable")}
          </span>
        </SettingsRow>
        <SettingsRow label={t("meetings.live.processing")}>
          <ProcessingStatusText
            status={snapshot.session.processing_status}
            live="polite"
          />
        </SettingsRow>
      </SettingsSection>

      {/* One wide control on its own is a field in a card, not a section: the
       * note box and the notes pane below it are the same shape. The note is
       * anchored at the clock on the title line, which is why no timestamp is
       * printed here — the button says what the press does. */}
      <SettingsCard>
        <SettingsField
          label={t("meetings.live.manualNote")}
          controlId={noteFieldId}
          disabled={isMutating}
        >
          <Textarea
            id={noteFieldId}
            value={noteBody}
            onChange={(event) => setNoteBody(event.target.value)}
            placeholder={t("meetings.live.notePlaceholder")}
            disabled={isMutating}
            rows={3}
            className="resize-none"
          />
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addNote}
              disabled={noteBody.trim().length === 0 || isMutating}
            >
              {t("meetings.live.addNote")}
            </Button>
          </div>
        </SettingsField>
      </SettingsCard>

      <MeetingNotesPane
        sessionId={snapshot.session.session_id}
        revision={snapshot.session.revision}
        variant="live"
        disabled={isMutating}
      />

      {/* Stop is the one filled control on the page. Discard is bordered and
       * set in red: a text action with no border reads as a caption, and this
       * one destroys the recording. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="text-red-900 hover:text-red-900"
          onClick={() => setDiscardOpen(true)}
          disabled={!canDiscard || isMutating}
        >
          {t("meetings.actions.discard")}
        </Button>
        <div className="ms-auto flex items-center gap-2">
          {isPaused ? (
            <Button
              type="button"
              variant="outline"
              onClick={onResume}
              disabled={!canResume || isMutating}
            >
              <Play aria-hidden="true" className="size-3.5" />
              {t("meetings.actions.resume")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={onPause}
              disabled={!canPause || isMutating}
            >
              <Pause aria-hidden="true" className="size-3.5" />
              {t("meetings.actions.pause")}
            </Button>
          )}
          <Button
            type="button"
            onClick={onStop}
            disabled={!canStop || isMutating}
          >
            <Square aria-hidden="true" className="size-3" />
            {t("meetings.actions.stop")}
          </Button>
        </div>
      </div>

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("meetings.discard.liveTitle")}</DialogTitle>
            <DialogDescription>
              {t("meetings.discard.explainsData")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDiscardOpen(false)}
            >
              {t("meetings.discard.keepRecording")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setDiscardOpen(false);
                onDiscard();
              }}
            >
              {t("meetings.discard.stopAndDiscard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
};
