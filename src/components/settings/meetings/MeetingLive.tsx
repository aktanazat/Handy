import React, { useMemo, useState } from "react";
import { CirclePause, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingReviewSnapshot } from "@/bindings";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import {
  CaptureCompletenessBadge,
  MeetingPhaseBadge,
  ProcessingStatusLine,
  SourceHealthCard,
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
    <div className="meetings-page meetings-live">
      <header className="meeting-live-header">
        <div className="meeting-live-identity">
          <div>
            <p>{t("meetings.live.activeCapture")}</p>
            <h1>{snapshot.session.title}</h1>
          </div>
          <div className="meeting-live-statuses">
            <MeetingPhaseBadge phase={snapshot.session.phase} />
            <CaptureCompletenessBadge
              completeness={snapshot.session.capture_completeness}
            />
          </div>
        </div>
        <dl className="meeting-live-timer">
          <dt>{t("meetings.live.elapsed")}</dt>
          <dd>{formatMeetingOffset(elapsedOffsetNs)}</dd>
        </dl>
      </header>

      {systemAudioLimited ? (
        <Alert variant="warning" contained>
          {t("meetings.live.microphoneOnlyPartial")}
        </Alert>
      ) : snapshot.session.capture_completeness === "partial" ? (
        <Alert variant="warning" contained>
          {t("meetings.live.partialCapture")}
        </Alert>
      ) : null}

      <section aria-labelledby="meeting-live-inputs">
        <div className="meeting-section-heading">
          <div>
            <h2 id="meeting-live-inputs">{t("meetings.live.inputs")}</h2>
            <p>{t("meetings.live.inputsDescription")}</p>
          </div>
        </div>
        <div className="meeting-source-grid">
          {snapshot.session.sources.map((source) => (
            <SourceHealthCard
              key={source.source_kind}
              source={source}
              elapsedOffsetNs={elapsedOffsetNs}
              showTelemetry
            />
          ))}
        </div>
      </section>

      <section className="meeting-live-progress" aria-labelledby="meeting-progress">
        <div className="meeting-section-heading">
          <div>
            <h2 id="meeting-progress">{t("meetings.live.progress")}</h2>
            <p>{t("meetings.live.progressDescription")}</p>
          </div>
        </div>
        <dl>
          <div>
            <dt>{t("meetings.live.transcript")}</dt>
            <dd>
              {latestTranscriptOffsetNs === null
                ? t("meetings.live.noTranscriptCheckpoint")
                : t("meetings.live.transcriptThrough", {
                    time: formatMeetingOffset(latestTranscriptOffsetNs),
                  })}
            </dd>
          </div>
          <div>
            <dt>{t("meetings.live.asrLag")}</dt>
            <dd>
              {transcriptLagNs === null
                ? t("meetings.live.notReported")
                : t("meetings.live.behind", {
                    duration: formatMeetingOffset(transcriptLagNs),
                  })}
            </dd>
          </div>
          <div>
            <dt>{t("meetings.live.storage")}</dt>
            <dd>
              {snapshot.session.storage === "available"
                ? t("meetings.live.storageHealthy")
                : t("meetings.live.storageUnavailable")}
            </dd>
          </div>
          <div>
            <dt>{t("meetings.live.processing")}</dt>
            <dd>
              <ProcessingStatusLine status={snapshot.session.processing_status} />
            </dd>
          </div>
        </dl>
      </section>

      <section className="meeting-manual-note" aria-labelledby="meeting-manual-note-title">
        <div className="meeting-section-heading">
          <div>
            <h2 id="meeting-manual-note-title">{t("meetings.live.manualNote")}</h2>
            <p>
              {t("meetings.live.manualNoteDescription", {
                time: formatMeetingOffset(elapsedOffsetNs),
              })}
            </p>
          </div>
        </div>
        <textarea
          value={noteBody}
          onChange={(event) => setNoteBody(event.target.value)}
          placeholder={t("meetings.live.notePlaceholder")}
          aria-label={t("meetings.live.manualNote")}
          disabled={isMutating}
        />
        <div className="meeting-note-actions">
          <span>
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
      </section>

      <div className="meeting-live-actions">
        {isPaused ? (
          <Button
            type="button"
            variant="secondary"
            onClick={onResume}
            disabled={!canResume || isMutating}
          >
            <CirclePause size={15} aria-hidden="true" />
            {t("meetings.actions.resume")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={onPause}
            disabled={!canPause || isMutating}
          >
            <CirclePause size={15} aria-hidden="true" />
            {t("meetings.actions.pause")}
          </Button>
        )}
        <Button
          type="button"
          onClick={onStop}
          disabled={!canStop || isMutating}
        >
          <Square size={14} aria-hidden="true" />
          {t("meetings.actions.stop")}
        </Button>
        <Button
          type="button"
          variant="danger-ghost"
          onClick={() => setDiscardOpen(true)}
          disabled={!canDiscard || isMutating}
        >
          {t("meetings.actions.discard")}
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
