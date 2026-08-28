import React, { useMemo, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingReviewSnapshot } from "@/bindings";
import { Alert, Button, Dialog, Section, StatusText, Textarea } from "../../ui";
import {
  CaptureCompletenessText,
  MeetingPhaseText,
  MeetingSourceList,
  ProcessingStatusText,
} from "./MeetingStatus";
import { formatMeetingOffset } from "./meetingUtils";

interface MeetingLiveProps {
  snapshot: MeetingReviewSnapshot;
  pendingAction: string | null;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDiscard: () => void;
  onCreateNote: (body: string) => void;
}

const PROGRESS_ROW_CLASSES =
  "flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5";

interface ProgressRowProps {
  label: string;
  children: React.ReactNode;
}

const ProgressRow: React.FC<ProgressRowProps> = ({ label, children }) => (
  <div className={PROGRESS_ROW_CLASSES}>
    <dt className="text-[13px] leading-[19px] font-medium text-text-primary">
      {label}
    </dt>
    <dd className="flex-none text-[12.5px] leading-[18px] text-text-secondary tabular-nums">
      {children}
    </dd>
  </div>
);

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
    <div className="settings-page">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border pb-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] leading-4 tracking-[0.045em] text-danger-strong uppercase">
            {t("meetings.live.activeCapture")}
          </p>
          <h1 className="settings-page-title mt-0.5">
            {snapshot.session.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <MeetingPhaseText phase={snapshot.session.phase} />
            <CaptureCompletenessText
              completeness={snapshot.session.capture_completeness}
            />
          </div>
        </div>
        <dl className="flex flex-none items-baseline gap-2">
          <dt className="text-[12px] leading-4 text-text-secondary">
            {t("meetings.live.elapsed")}
          </dt>
          <dd className="font-mono text-[19px] leading-6 font-semibold text-text-primary tabular-nums">
            {formatMeetingOffset(elapsedOffsetNs)}
          </dd>
        </dl>
      </header>

      {systemAudioLimited ? (
        <Alert variant="warning">
          {t("meetings.live.microphoneOnlyPartial")}
        </Alert>
      ) : snapshot.session.capture_completeness === "partial" ? (
        <Alert variant="warning">{t("meetings.live.partialCapture")}</Alert>
      ) : null}

      <Section
        title={t("meetings.live.inputs")}
        description={t("meetings.live.inputsDescription")}
      >
        <MeetingSourceList
          sources={snapshot.session.sources}
          label={t("meetings.live.inputs")}
          elapsedOffsetNs={elapsedOffsetNs}
          showTelemetry
        />
      </Section>

      <Section
        title={t("meetings.live.progress")}
        description={t("meetings.live.progressDescription")}
      >
        <div className="settings-group-panel">
          <dl>
            <ProgressRow label={t("meetings.live.transcript")}>
              {latestTranscriptOffsetNs === null
                ? t("meetings.live.noTranscriptCheckpoint")
                : t("meetings.live.transcriptThrough", {
                    time: formatMeetingOffset(latestTranscriptOffsetNs),
                  })}
            </ProgressRow>
            <ProgressRow label={t("meetings.live.asrLag")}>
              {transcriptLagNs === null
                ? t("meetings.live.notReported")
                : t("meetings.live.behind", {
                    duration: formatMeetingOffset(transcriptLagNs),
                  })}
            </ProgressRow>
            <ProgressRow label={t("meetings.live.storage")}>
              <StatusText tone={storageAvailable ? "muted" : "danger"}>
                {storageAvailable
                  ? t("meetings.live.storageHealthy")
                  : t("meetings.live.storageUnavailable")}
              </StatusText>
            </ProgressRow>
            <ProgressRow label={t("meetings.live.processing")}>
              <ProcessingStatusText
                status={snapshot.session.processing_status}
                live="polite"
              />
            </ProgressRow>
          </dl>
        </div>
      </Section>

      <Section
        title={t("meetings.live.manualNote")}
        description={t("meetings.live.manualNoteDescription", {
          time: formatMeetingOffset(elapsedOffsetNs),
        })}
      >
        <Textarea
          value={noteBody}
          onChange={(event) => setNoteBody(event.target.value)}
          placeholder={t("meetings.live.notePlaceholder")}
          aria-label={t("meetings.live.manualNote")}
          disabled={isMutating}
          className="w-full"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[11px] leading-4 text-text-secondary tabular-nums">
            {t("meetings.live.timestamp", {
              time: formatMeetingOffset(elapsedOffsetNs),
            })}
          </span>
          <Button
            type="button"
            variant="secondary"
            onClick={addNote}
            disabled={noteBody.trim().length === 0 || isMutating}
          >
            {t("meetings.live.addNote")}
          </Button>
        </div>
      </Section>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="danger-ghost"
          onClick={() => setDiscardOpen(true)}
          disabled={!canDiscard || isMutating}
        >
          {t("meetings.actions.discard")}
        </Button>
        {isPaused ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onResume}
            disabled={!canResume || isMutating}
          >
            <Play size={14} aria-hidden="true" />
            {t("meetings.actions.resume")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            onClick={onPause}
            disabled={!canPause || isMutating}
          >
            <Pause size={14} aria-hidden="true" />
            {t("meetings.actions.pause")}
          </Button>
        )}
        <Button
          type="button"
          variant="danger"
          onClick={onStop}
          disabled={!canStop || isMutating}
        >
          <Square size={13} aria-hidden="true" />
          {t("meetings.actions.stop")}
        </Button>
      </div>

      <Dialog
        open={discardOpen}
        title={t("meetings.discard.liveTitle")}
        description={t("meetings.discard.liveDescription")}
        closeLabel={t("common.cancel")}
        onOpenChange={setDiscardOpen}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDiscardOpen(false)}
            >
              {t("meetings.discard.keepRecording")}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setDiscardOpen(false);
                onDiscard();
              }}
            >
              {t("meetings.discard.stopAndDiscard")}
            </Button>
          </>
        }
      >
        <p>{t("meetings.discard.explainsData")}</p>
      </Dialog>
    </div>
  );
};
