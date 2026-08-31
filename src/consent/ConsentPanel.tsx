"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  events,
  type DetectionPromptEvent,
  type DetectionStatus,
  type MeetingConsentPanelSessionState,
} from "@/bindings";
import { Button } from "@/components/vg/button";
import { Checkbox } from "@/components/vg/checkbox";
import { consentFor } from "@/components/settings/meetings/MeetingStartGate";
import type { MeetingStartOptions } from "@/components/settings/meetings/meetingTypes";
import { elapsedLabel } from "./elapsed";

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

export default function ConsentPanel() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<DetectionPromptEvent | null>(null);
  const [status, setStatus] = useState<DetectionStatus | null>(null);
  const [active, setActive] = useState<MeetingConsentPanelSessionState | null>(
    null,
  );
  const [alwaysRecord, setAlwaysRecord] = useState(false);
  const [starting, setStarting] = useState(false);
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
  }, []);

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
        if (event.payload.delivery !== "panel" || activeRef.current !== null) {
          return;
        }
        setPrompt(event.payload);
        setAlwaysRecord(false);
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
    if (active === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

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
      });
      if (result.status === "error") {
        console.error("Could not start the meeting", result.error);
        setPrompt(null);
        return;
      }
      if (result.data.snapshot.phase === "capturing_recording") {
        await refreshActive();
      }
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

  if (active !== null) {
    return (
      <main className="m-2 flex h-[calc(100%-1rem)] flex-col gap-3 rounded-lg border border-border bg-raised p-4 text-gray-1000 shadow-lg">
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

  if (prompt === null) return null;
  const calendarPrompt = prompt.prompt.kind === "CalendarEvent";
  return (
    <main className="m-2 flex h-[calc(100%-1rem)] flex-col gap-3 rounded-lg border border-border bg-raised p-4 text-gray-1000 shadow-lg">
      {/* The one block that gives way when copy runs long: a wrapped title
       * loses its tail rather than pushing the checkbox and the buttons out
       * of a window whose height was decided before this text was measured. */}
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
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            className="border-gray-700"
            checked={alwaysRecord}
            onCheckedChange={(checked) => setAlwaysRecord(checked === true)}
          />
          <span>{t("consentPanel.alwaysRecord")}</span>
        </label>
      ) : null}
      <div className="flex items-end justify-between gap-3">
        <p className="max-w-[215px] text-xs leading-4 text-gray-900">
          {t(
            "meetings.start.assurance",
            "Only start after everyone in the meeting has agreed to be recorded.",
          )}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={ignore}>
            {t("consentPanel.ignore")}
          </Button>
          <Button type="button" size="sm" disabled={starting} onClick={record}>
            {t("consentPanel.record")}
          </Button>
        </div>
      </div>
    </main>
  );
}
