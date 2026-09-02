"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  commands,
  events,
  type DetectionPromptEvent,
  type DetectionStatus,
  type MeetingConsentPanelSessionState,
  type MeetingPrepCard,
  type MeetingRecordingCard,
  type MeetingRitualAction,
  type MeetingRitualEvent,
  type MeetingWrapCard,
} from "@/bindings";
import { Button } from "@/components/vg/button";
import { Checkbox } from "@/components/vg/checkbox";
import { consentFor } from "@/components/settings/meetings/MeetingStartGate";
import type { MeetingStartOptions } from "@/components/settings/meetings/meetingTypes";
import {
  followUpDraftText,
  meetingFollowUpDraft,
} from "@/components/settings/meetings/review/followUpDraft";
import { elapsedLabel } from "./elapsed";

const panelClass =
  "m-2 flex h-[calc(100%-1rem)] flex-col gap-3 rounded-lg border border-border bg-raised p-4 text-gray-1000 shadow-lg";

const startOptions = (prompt: DetectionPromptEvent): MeetingStartOptions => ({
  title:
    prompt.prompt.kind === "CalendarEvent"
      ? prompt.prompt.eventTitle
      : prompt.notificationTitle,
  origin: "suggestion",
  suggestionId: null,
  calendarEventKey:
    prompt.prompt.kind === "CalendarEvent" ? prompt.prompt.eventKey : null,
  sources: ["microphone", "system_audio"],
  degradedStartPolicy: "abort_if_required_source_fails",
  destination: { kind: "local" },
  preview: null,
});

type PrepCardProps = {
  card: MeetingPrepCard;
  onAction: (action: MeetingRitualAction) => void;
  t: TFunction;
  now?: number;
};

export function PrepCard({
  card,
  onAction,
  t,
  now = Date.now(),
}: PrepCardProps) {
  const minutes = Math.max(1, Math.ceil((card.startUtcMs - now) / 60_000));
  const participants = card.participants
    .map((participant) => {
      const meetings = t("meetings.prep.participantMeetings", {
        count: participant.meetingsCount,
      });
      return [participant.name, meetings, participant.organization]
        .filter(Boolean)
        .join(" · ");
    })
    .join("; ");

  return (
    <main className={panelClass} data-testid="prep-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-800">
            {t("meetings.prep.label")}
          </p>
          <h1 className="truncate text-base font-semibold tracking-tight">
            {t("meetings.prep.title", { title: card.title, count: minutes })}
          </h1>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-mr-2 -mt-2 px-2 text-gray-800"
          aria-label={t("meetings.prep.dismiss")}
          onClick={() => onAction("prep_dismiss")}
        >
          ×
        </Button>
      </div>

      <p className="line-clamp-2 text-sm text-gray-900">
        <span className="font-medium text-gray-1000">
          {t("meetings.prep.lastTime")}
        </span>{" "}
        {card.headline}
      </p>

      {card.mineOpenLoopCount > 0 ? (
        <div className="min-h-0 text-sm">
          <p className="font-medium">
            {t("meetings.prep.myOpenLoops", {
              count: card.mineOpenLoopCount,
            })}
          </p>
          <ul className="mt-0.5 space-y-0.5 text-gray-900">
            {card.mineOpenLoops.slice(0, 2).map((loop) => (
              <li className="truncate" key={loop}>
                · {loop}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.waitingOnCount > 0 ? (
        <p className="text-sm text-gray-900">
          {t("meetings.prep.waitingOn", { count: card.waitingOnCount })}
        </p>
      ) : null}

      {participants !== "" ? (
        <p className="line-clamp-2 text-xs leading-4 text-gray-900">
          <span className="font-medium text-gray-1000">
            {t("meetings.prep.participants")}
          </span>{" "}
          {participants}
        </p>
      ) : null}

      <div className="mt-auto flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onAction("prep_open_brief")}
        >
          {t("meetings.prep.openBrief")}
        </Button>
        {card.canRecordWhenStarts ? (
          <Button
            type="button"
            size="sm"
            onClick={() => onAction("prep_record_when_starts")}
          >
            {t("meetings.prep.recordWhenStarts")}
          </Button>
        ) : null}
      </div>
    </main>
  );
}

type WrapCardProps = {
  card: MeetingWrapCard;
  copied: boolean;
  onAction: (action: MeetingRitualAction) => void;
  onCopy: () => void;
  t: TFunction;
};

export function WrapCard({ card, copied, onAction, onCopy, t }: WrapCardProps) {
  const waiting =
    card.waitingOnCount === 0
      ? null
      : card.waitingOnNames.length === 1
        ? t("consentPanel.wrap.waitingOnPerson", {
            count: card.waitingOnCount,
            name: card.waitingOnNames[0],
          })
        : t("consentPanel.wrap.waitingOn", { count: card.waitingOnCount });
  const delta = [
    card.followUpCount > 0
      ? t("consentPanel.wrap.followUps", { count: card.followUpCount })
      : null,
    waiting,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className={panelClass} data-testid="wrap-card">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-800">
          {t("consentPanel.wrap.label")}
        </p>
        <h1 className="truncate text-base font-semibold tracking-tight">
          {t("consentPanel.wrap.title", { title: card.title })}
        </h1>
      </div>
      <p className="line-clamp-2 text-sm text-gray-900">{card.headline}</p>
      {delta !== "" ? <p className="text-sm text-gray-900">{delta}</p> : null}
      <div className="mt-auto flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onAction("wrap_open_notes")}
        >
          {t("consentPanel.wrap.openNotes")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCopy}>
          {copied
            ? t("consentPanel.wrap.copied")
            : t("consentPanel.wrap.copyFollowUp")}
        </Button>
        <Button type="button" size="sm" onClick={() => onAction("wrap_done")}>
          {t("consentPanel.wrap.done")}
        </Button>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? t("consentPanel.wrap.copied") : ""}
      </span>
    </main>
  );
}

type RecordingCardProps = {
  card: MeetingRecordingCard;
  onAction: (action: MeetingRitualAction) => void;
  t: TFunction;
  now: number;
};

/* What an auto-started call looks like while it runs.
 *
 * The two actions are the whole point of the card: an operator who did not ask
 * for this recording out loud can end it, and can end the standing grant that
 * produced it, without going to Settings first. */
export function RecordingCard({ card, onAction, t, now }: RecordingCardProps) {
  return (
    <main className={panelClass} data-testid="recording-card">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-red-700" aria-hidden="true" />
        <strong className="text-sm font-semibold">
          {t("consentPanel.recordingStarted")}
        </strong>
        <span className="ml-auto text-sm tabular-nums text-gray-900">
          {elapsedLabel(card.startedAtUtcMs, now)}
        </span>
      </div>
      <p className="truncate text-base font-medium">{card.appName}</p>
      <div className="mt-auto flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onAction("recording_forget_app")}
        >
          {t("consentPanel.forgetApp")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onAction("recording_stop")}
        >
          {t("consentPanel.stop")}
        </Button>
      </div>
    </main>
  );
}

export default function ConsentPanel() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<DetectionPromptEvent | null>(null);
  const [ritual, setRitual] = useState<MeetingRitualEvent | null>(null);
  const [status, setStatus] = useState<DetectionStatus | null>(null);
  const [active, setActive] = useState<MeetingConsentPanelSessionState | null>(
    null,
  );
  const [alwaysRecord, setAlwaysRecord] = useState(false);
  const [announceInChat, setAnnounceInChat] = useState(false);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const activeRef = useRef<MeetingConsentPanelSessionState | null | undefined>(
    undefined,
  );

  const refreshActive = useCallback(async () => {
    const result = await commands.meetingConsentPanelActiveState();
    if (result.status === "error") {
      console.error("Could not refresh the active meeting", result.error);
      return;
    }
    activeRef.current = result.data;
    setActive(result.data);
    if (result.data !== null) {
      setPrompt(null);
      /* The recording card is *about* the active session, so an active session
       * is not a reason to drop it. A *different* active session is: the card's
       * capture ended and the operator started another, and Stop on the stale
       * card would name a capture that is gone. Its own retraction event ends
       * it otherwise. */
      const activeSessionId = result.data.snapshot.session_id;
      setRitual((current) =>
        current?.ritual.kind === "recording" &&
        current.ritual.card.sessionId === activeSessionId
          ? current
          : null,
      );
    }
  }, []);

  /* The disclosure is posted from here because the words come from the i18next
   * catalog and the backend cannot reach it. The backend decides whether one is
   * owed and records what the paste did, so this fires once per recording even
   * though the live state is re-read on every change to the meeting. */
  useEffect(() => {
    if (active?.disclosure.kind !== "pending") return;
    const sessionId = active.snapshot.session_id;
    const line = t("consentPanel.announceLine", {
      name: active.disclosure.notetaker,
    });
    void commands
      .meetingAnnounceDisclosure(sessionId, line)
      .then(() => refreshActive())
      .catch((error) => {
        console.error("Could not announce the recording", error);
      });
  }, [active, refreshActive, t]);

  useEffect(() => {
    void commands
      .detectionStatusGet()
      .then(setStatus)
      .catch((error) => {
        console.error("Could not refresh meeting detection", error);
      });
    void refreshActive();
    const listeners = Promise.all([
      events.detectionPrompt.listen((event) => {
        if (event.payload.delivery !== "panel") {
          setPrompt((current) =>
            current?.promptId === event.payload.promptId ? null : current,
          );
          return;
        }
        if (activeRef.current !== null && activeRef.current !== undefined)
          return;
        setRitual(null);
        setPrompt(event.payload);
        setAlwaysRecord(false);
        setAnnounceInChat(event.payload.announceInChat);
        void commands
          .detectionPromptPanelAck(event.payload.promptId)
          .catch((error) => {
            console.error("Could not acknowledge the consent panel", error);
          });
      }),
      events.detectionPromptRetracted.listen((event) =>
        setPrompt((current) =>
          current?.promptId === event.payload.promptId ? null : current,
        ),
      ),
      events.meetingRitual.listen((event) => {
        if (event.payload.delivery !== "panel") {
          setRitual((current) =>
            current?.ritualId === event.payload.ritualId ? null : current,
          );
          return;
        }
        /* Same exception as `refreshActive`: the recording card names the
         * capture that is running, so it is delivered during one by design. */
        if (
          event.payload.ritual.kind !== "recording" &&
          activeRef.current !== null &&
          activeRef.current !== undefined
        )
          return;
        setPrompt(null);
        setCopied(false);
        setRitual(event.payload);
        void commands
          .meetingRitualPanelAck(event.payload.ritualId)
          .catch((error) => {
            console.error("Could not acknowledge the meeting ritual", error);
          });
      }),
      events.meetingRitualRetracted.listen((event) =>
        setRitual((current) =>
          current?.ritualId === event.payload.ritualId ? null : current,
        ),
      ),
      events.detectionStatus.listen((event) => setStatus(event.payload)),
      events.meetingSessionChanged.listen(() => void refreshActive()),
    ]).catch((error) => {
      console.error("Could not subscribe to consent panel events", error);
      return [];
    });
    return () => {
      void listeners.then((stops) => stops.forEach((stop) => stop()));
    };
  }, [refreshActive]);

  useEffect(() => {
    if (
      active === null &&
      ritual?.ritual.kind !== "prep" &&
      ritual?.ritual.kind !== "recording"
    )
      return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, ritual]);

  const briefing = useMemo(() => {
    if (prompt?.prompt.kind !== "CalendarEvent") return null;
    const countdown = status?.countdown;
    if (countdown?.event.eventKey !== prompt.prompt.eventKey) return null;
    const person = countdown.briefing[0];
    if (person === undefined) return null;
    const loops = countdown.briefing.reduce(
      (total, row) => total + row.open_loops.length,
      0,
    );
    return t("consentPanel.seriesBrief", {
      nth: person.meetings_count + 1,
      person: person.display_name,
      count: loops,
    });
  }, [prompt, status, t]);

  const title = useMemo(() => {
    if (prompt === null) return "";
    switch (prompt.prompt.kind) {
      case "AppCall":
        return t("consentPanel.appCallTitle", { app: prompt.prompt.appName });
      case "CalendarEvent":
        return t("consentPanel.calendarTitle", {
          title: prompt.prompt.eventTitle,
        });
      case "AppMeeting":
      case "AppHuddle":
      case "BrowserCall":
        return t("consentPanel.appTitle", { app: prompt.prompt.appName });
      case "UnknownMicSource":
        return t("consentPanel.genericTitle");
    }
  }, [prompt, t]);

  const ritualAction = async (action: MeetingRitualAction) => {
    if (ritual === null) return;
    const result = await commands.meetingRitualRespond(ritual.ritualId, action);
    if (
      result.status === "ok" &&
      result.data &&
      action !== "wrap_follow_up_copied"
    ) {
      setRitual(null);
    }
  };

  const copyFollowUp = async () => {
    if (ritual?.ritual.kind !== "wrap") return;
    try {
      const draft = await meetingFollowUpDraft(
        crypto.randomUUID(),
        ritual.ritual.card.sessionId,
      );
      await navigator.clipboard.writeText(followUpDraftText(draft, t));
      setCopied(true);
      await ritualAction("wrap_follow_up_copied");
    } catch (error: unknown) {
      console.error("Could not copy the meeting follow-up", error);
    }
  };

  const record = async () => {
    if (prompt === null) return;
    setStarting(true);
    const options = startOptions(prompt);
    try {
      const result = await commands.meetingConsentPanelStart({
        prompt_id: prompt.promptId,
        operation_id: crypto.randomUUID(),
        consent: consentFor(options, [], false),
        always_record_series: alwaysRecord,
        announce_in_chat: announceInChat,
      });
      if (result.status === "error") {
        console.error("Could not start the meeting", result.error);
        setPrompt(null);
        return;
      }
      if (result.data.snapshot.phase === "capturing_recording")
        await refreshActive();
      setPrompt(null);
    } catch (error: unknown) {
      console.error("Could not start the meeting", error);
      setPrompt(null);
    } finally {
      setStarting(false);
    }
  };

  const ignore = async () => {
    if (prompt === null) return;
    const promptId = prompt.promptId;
    setPrompt(null);
    try {
      await commands.detectionPromptRespond(promptId, false);
    } catch (error: unknown) {
      console.error("Could not dismiss the detection prompt", error);
    }
  };

  const stop = async () => {
    if (active === null) return;
    const result = await commands.meetingStop({
      operation_id: crypto.randomUUID(),
      session_id: active.snapshot.session_id,
      expected_revision: active.snapshot.revision,
    });
    if (result.status === "error") {
      console.error("Could not stop the meeting", result.error);
      return;
    }
    await refreshActive();
  };

  const forgetSeries = async () => {
    if (active === null) return;
    const result = await commands.meetingConsentPanelForgetSeries(
      active.snapshot.session_id,
    );
    if (result.status === "error") {
      console.error("Could not forget the standing consent", result.error);
      return;
    }
    setActive({ ...active, standing_series_key: null });
  };

  /* Ahead of the generic pill below: this card names the app whose standing
   * grant started the capture, and offers to take that grant back. The pill
   * knows neither. */
  if (ritual?.ritual.kind === "recording") {
    return (
      <RecordingCard
        card={ritual.ritual.card}
        onAction={(action) => void ritualAction(action)}
        t={t}
        now={now}
      />
    );
  }

  if (active !== null) {
    return (
      <main className={panelClass}>
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-red-700" aria-hidden="true" />
          <strong className="text-sm font-semibold">
            {t("consentPanel.recording")}
          </strong>
          <span className="ml-auto text-sm tabular-nums text-gray-900">
            {elapsedLabel(active.snapshot.started_at_utc_ms, now)}
          </span>
        </div>
        <p className="truncate text-base font-medium">
          {active.snapshot.title}
        </p>
        {/* A disclosure the target would not take is worth saying once, quietly:
         * the recording is running either way, and the room was not told. */}
        {active.disclosure.kind === "attempted" &&
        active.disclosure.receipt.outcome === "definitely_not_dispatched" ? (
          <p
            className="text-xs leading-4 text-gray-900"
            data-slot="consent-announce-refused"
          >
            {t("consentPanel.announceRefused")}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          {active.standing_series_key !== null ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={forgetSeries}
            >
              {t("consentPanel.forgetSeries")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={stop}>
            {t("consentPanel.stop")}
          </Button>
        </div>
      </main>
    );
  }

  if (prompt !== null) {
    const calendarPrompt = prompt.prompt.kind === "CalendarEvent";
    return (
      <main className={panelClass}>
        <div className="min-h-0 overflow-hidden">
          <h1 className="text-base font-semibold tracking-tight">{title}</h1>
          {prompt.showIntroduction ? (
            <p className="mt-1 text-sm text-gray-900">
              {t("consentPanel.introduction")}
            </p>
          ) : null}
          {briefing !== null ? (
            <p className="mt-1 text-sm text-gray-900">{briefing}</p>
          ) : null}
        </div>
        {calendarPrompt ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                className="border-gray-700"
                checked={alwaysRecord}
                onCheckedChange={(checked) => setAlwaysRecord(checked === true)}
              />
              <span>{t("consentPanel.alwaysRecord")}</span>
            </label>
            {/* Remembered per series, like the decision above it. */}
            <label
              className="flex items-center gap-2 text-sm"
              data-slot="consent-announce"
            >
              <Checkbox
                className="border-gray-700"
                checked={announceInChat}
                onCheckedChange={(checked) =>
                  setAnnounceInChat(checked === true)
                }
              />
              <span>{t("consentPanel.announceInChat")}</span>
            </label>
          </>
        ) : null}
        <div className="flex items-end justify-between gap-3">
          <p className="max-w-[215px] text-xs leading-4 text-gray-900">
            {t(
              "meetings.start.assurance",
              "Records your Mac's audio locally. Nothing joins the call.",
            )}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={ignore}>
              {t("consentPanel.ignore")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={starting}
              onClick={record}
            >
              {t("consentPanel.record")}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (ritual?.ritual.kind === "prep") {
    return (
      <PrepCard
        card={ritual.ritual.card}
        onAction={(action) => void ritualAction(action)}
        t={t}
        now={now}
      />
    );
  }
  if (ritual?.ritual.kind === "wrap") {
    return (
      <WrapCard
        card={ritual.ritual.card}
        copied={copied}
        onAction={(action) => void ritualAction(action)}
        onCopy={() => void copyFollowUp()}
        t={t}
      />
    );
  }
  return null;
}
