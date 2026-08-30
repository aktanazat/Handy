import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Notice,
  SettingsField,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Switch } from "@/components/vg/switch";
import { Textarea } from "@/components/vg/textarea";
import {
  useDetectionStore,
  type DetectionSettings,
  type DetectionSuppressReason,
} from "./detectionStore";

const SUPPRESS_REASON_COPY = {
  detection_disabled: ["meetings.detection.why.disabled", "Detection is off."],
  sona_holds_input_device: [
    "meetings.detection.why.sonaHoldsMic",
    "Sona is using the microphone, so nothing else can be identified right now.",
  ],
  capture_already_active: [
    "meetings.detection.why.captureActive",
    "A meeting is already being captured.",
  ],
  no_qualifying_signal: [
    "meetings.detection.why.noSignal",
    "Nothing is using the microphone yet.",
  ],
  attendee_floor_not_met: [
    "meetings.detection.why.soloEvent",
    "The next event has fewer than two attendees, so it reads as blocked time.",
  ],
  unknown_mic_source: [
    "meetings.detection.why.unknownApp",
    "Something is using the microphone, but it is not a known meeting app.",
  ],
  browser_title_unreadable: [
    "meetings.detection.why.browserUnreadable",
    "A browser is in front, but its tab title cannot be read.",
  ],
  browser_title_not_meeting: [
    "meetings.detection.why.browserNotMeeting",
    "A browser is in front and its tab is not a call.",
  ],
} satisfies Record<DetectionSuppressReason, [string, string]>;

/** One degraded path, named. `live` belongs only to the line that changes on a
 *  tick rather than on something the operator did. */
interface DetectionStateLine {
  id: string;
  tone: "muted" | "warning";
  live: boolean;
  text: string;
}

/* Detection's whole operator surface.
 *
 * One section, read top to bottom as the escalation the design deliberately
 * makes visible: the master switch in the heading, then the calendar path
 * behind its own permission, then the two choices that widen what counts as
 * evidence, then the allowlist. It was two headings and eight sentences; the
 * headings said what the switches say, so the switches kept them.
 *
 * "What detection can see" is the second and last section, because silent
 * detection is otherwise indistinguishable from broken detection — and it only
 * exists when there is a degraded path to name. */
export const MeetingDetectionSettings: React.FC = () => {
  const { t } = useTranslation();
  const status = useDetectionStore((state) => state.status);
  const save = useDetectionStore((state) => state.save);
  const requestCalendarAccess = useDetectionStore(
    (state) => state.requestCalendarAccess,
  );
  const [saving, setSaving] = useState(false);
  const [appsDraft, setAppsDraft] = useState<string | null>(null);

  const settings = status?.settings ?? null;

  const patch = useCallback(
    async (change: Partial<DetectionSettings>) => {
      if (settings === null) return;
      setSaving(true);
      try {
        await save({ ...settings, ...change });
      } finally {
        setSaving(false);
      }
    },
    [save, settings],
  );

  /* Turning the calendar path on is what triggers the EventKit request, and
   * reading events needs full access. Asking first and only writing the setting
   * on success keeps the toggle from claiming a path that cannot run. */
  const enableCalendar = useCallback(
    async (enabled: boolean) => {
      if (!enabled) {
        await patch({ calendarEnabled: false });
        return;
      }
      setSaving(true);
      try {
        const access = await requestCalendarAccess();
        if (access === "authorized") await patch({ calendarEnabled: true });
      } finally {
        setSaving(false);
      }
    },
    [patch, requestCalendarAccess],
  );

  if (settings === null || status === null) {
    return (
      <SettingsSection label={t("meetings.detection.title", "Detect meetings")}>
        <div className="px-4 py-3">
          <Notice tone="muted">
            {t("meetings.detection.loading", "Reading detection state…")}
          </Notice>
        </div>
      </SettingsSection>
    );
  }

  const suppression = status.suppressReason;
  const calendarBlocked =
    settings.calendarEnabled && status.calendarAccess !== "authorized";

  const stateLines: DetectionStateLine[] = [];
  if (calendarBlocked) {
    stateLines.push({
      id: "calendar",
      tone: "warning",
      live: false,
      text: t(
        "meetings.detection.state.calendarDenied",
        "Calendar access was not granted, so only the microphone path runs.",
      ),
    });
  }
  if (status.notificationAccess === "denied") {
    stateLines.push({
      id: "notifications",
      tone: "warning",
      live: false,
      text: t(
        "meetings.detection.state.notificationsDenied",
        "Notifications are off for Sona, so prompts appear in the app only.",
      ),
    });
  }
  if (status.inputDeviceReportingSuspect) {
    stateLines.push({
      id: "bluetooth",
      tone: "muted",
      live: false,
      text: t(
        "meetings.detection.state.bluetoothCaveat",
        "A meeting app is open but nothing reports using the microphone. Bluetooth headsets often do not, so start the meeting yourself if one is running.",
      ),
    });
  }
  if (suppression) {
    stateLines.push({
      id: "suppression",
      tone: "muted",
      live: true,
      text: t(
        SUPPRESS_REASON_COPY[suppression][0],
        SUPPRESS_REASON_COPY[suppression][1],
      ),
    });
  }
  if (!status.availableStopTriggers.includes("silence")) {
    stateLines.push({
      id: "stopTriggers",
      tone: "muted",
      live: false,
      text: t(
        "meetings.detection.state.noSilenceStop",
        "Captures stop on the event end, the app quitting, sleep, or your own stop. The silence timer needs live transcription, which runs after a meeting ends.",
      ),
    });
  }

  return (
    <>
      {/* The master switch sits in the section header rather than in a row of
       * its own: it owns everything below it, and repeating "Detect meetings"
       * as both a heading and the first row's label said it twice. */}
      <SettingsSection
        label={t("meetings.detection.title", "Detect meetings")}
        action={
          <Switch
            checked={settings.enabled}
            onCheckedChange={(enabled) => void patch({ enabled })}
            disabled={saving}
            aria-label={t("meetings.detection.title", "Detect meetings")}
          />
        }
      >
        <SettingsRow
          label={t("meetings.detection.calendar.label", "Use my calendar")}
          /* The one thing about this switch nobody can infer from it: macOS
           * has no read-only calendar grant, so turning it on asks for the
           * whole calendar. */
          hint={t(
            "meetings.detection.calendar.description",
            "Shows a countdown a minute before events with two or more attendees. macOS asks for full calendar access the first time, because Apple offers no read-only grant.",
          )}
          controlId="detection-calendar"
          disabled={!settings.enabled}
        >
          <Switch
            id="detection-calendar"
            checked={settings.calendarEnabled}
            onCheckedChange={(enabled) => void enableCalendar(enabled)}
            disabled={!settings.enabled || saving}
          />
        </SettingsRow>

        <SettingsRow
          label={t(
            "meetings.detection.anyMic.label",
            "Ask on any microphone use",
          )}
          controlId="detection-any-mic"
          disabled={!settings.enabled}
        >
          <Switch
            id="detection-any-mic"
            checked={settings.anyMicActivity}
            onCheckedChange={(anyMicActivity) => void patch({ anyMicActivity })}
            disabled={!settings.enabled || saving}
          />
        </SettingsRow>

        <SettingsRow
          label={t(
            "meetings.detection.autoStart.label",
            "Open the meeting when its countdown is showing",
          )}
          controlId="detection-auto-start"
          disabled={!settings.enabled || !settings.calendarEnabled}
        >
          <Switch
            id="detection-auto-start"
            checked={settings.autoStartOnOpenPane}
            onCheckedChange={(autoStartOnOpenPane) =>
              void patch({ autoStartOnOpenPane })
            }
            disabled={!settings.enabled || !settings.calendarEnabled || saving}
          />
        </SettingsRow>

        <SettingsField
          label={t("meetings.detection.apps.label", "Meeting apps")}
          /* A format the control cannot state for itself, plus the reason a
           * stale identifier is harmless. */
          hint={t(
            "meetings.detection.apps.description",
            "One bundle identifier per line. An entry only counts while that app is running, so a renamed identifier is inert rather than wrong.",
          )}
          controlId="detection-apps"
          disabled={!settings.enabled}
        >
          <Textarea
            id="detection-apps"
            rows={5}
            className="font-mono text-[12px]"
            value={appsDraft ?? settings.meetingApps.join("\n")}
            onChange={(event) => setAppsDraft(event.target.value)}
            disabled={!settings.enabled || saving}
            spellCheck={false}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Notice tone="muted" live={false}>
              {status.runningMeetingApps.length === 0
                ? t(
                    "meetings.detection.apps.noneRunning",
                    "None of these are running right now.",
                  )
                : t(
                    "meetings.detection.apps.running",
                    "Running now: {{apps}}",
                    {
                      apps: status.runningMeetingApps.join(", "),
                    },
                  )}
            </Notice>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={appsDraft === null || saving}
              onClick={() => {
                const meetingApps = (appsDraft ?? "")
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => line.length > 0);
                setAppsDraft(null);
                void patch({ meetingApps });
              }}
            >
              {t("common.save")}
            </Button>
          </div>
        </SettingsField>
      </SettingsSection>

      {/* Silent detection is indistinguishable from broken detection, so every
       * degraded path names itself here. With nothing degraded there is nothing
       * to say, and an empty bordered box saying it would be worse than
       * silence. */}
      {stateLines.length === 0 ? null : (
        <SettingsSection
          label={t("meetings.detection.state.title", "What detection can see")}
        >
          <div className="flex flex-col gap-1.5 px-4 py-3">
            {stateLines.map((line) => (
              <Notice key={line.id} tone={line.tone} live={line.live}>
                {line.text}
              </Notice>
            ))}
          </div>
        </SettingsSection>
      )}
    </>
  );
};
