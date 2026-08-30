import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Section,
  StatusText,
  Switch,
  Textarea,
  ToggleSwitch,
} from "../../ui";
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

/* Detection's whole operator surface.
 *
 * The layout follows the escalation the design deliberately makes visible:
 * master switch, then the calendar path behind its own permission, then the two
 * choices that widen what counts as evidence, then the allowlist. "Why detection
 * is quiet" sits at the bottom because silent detection is otherwise
 * indistinguishable from broken detection. */
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
      <Section
        title={t("meetings.detection.title", "Detect meetings")}
        description={t(
          "meetings.detection.description",
          "Sona watches for calls and offers to take notes. It never records on its own.",
        )}
      >
        <StatusText tone="muted" live="polite">
          {t("meetings.detection.loading", "Reading detection state…")}
        </StatusText>
      </Section>
    );
  }

  const suppression = status.suppressReason;
  const calendarBlocked =
    settings.calendarEnabled && status.calendarAccess !== "authorized";

  return (
    <>
      {/* The master switch sits in the section header rather than in a row of
       * its own: it owns everything below it, and repeating "Detect meetings"
       * as both a heading and the first row's label said it twice. */}
      <Section
        title={t("meetings.detection.title", "Detect meetings")}
        description={t(
          "meetings.detection.description",
          "Sona watches for calls and offers to take notes. It never records on its own.",
        )}
        actions={
          <Switch
            checked={settings.enabled}
            onChange={(enabled) => void patch({ enabled })}
            disabled={saving}
            label={t("meetings.detection.title", "Detect meetings")}
          />
        }
      >
        <div className="settings-group-panel">
          <div className="divide-y">
            <ToggleSwitch
              grouped
              checked={settings.calendarEnabled}
              onChange={(enabled) => void enableCalendar(enabled)}
              isUpdating={saving}
              disabled={!settings.enabled}
              label={t("meetings.detection.calendar.label", "Use my calendar")}
              description={t(
                "meetings.detection.calendar.description",
                "Shows a countdown a minute before events with two or more attendees. macOS asks for full calendar access the first time, because Apple offers no read-only grant.",
              )}
              descriptionMode="inline"
            />

            <ToggleSwitch
              grouped
              checked={settings.anyMicActivity}
              onChange={(anyMicActivity) => void patch({ anyMicActivity })}
              isUpdating={saving}
              disabled={!settings.enabled}
              label={t(
                "meetings.detection.anyMic.label",
                "Ask on any microphone use",
              )}
              description={t(
                "meetings.detection.anyMic.description",
                "Includes voice memos, music apps, and anything else that opens the microphone. Off keeps prompts to known meeting apps.",
              )}
              descriptionMode="inline"
            />

            <ToggleSwitch
              grouped
              checked={settings.autoStartOnOpenPane}
              onChange={(autoStartOnOpenPane) =>
                void patch({ autoStartOnOpenPane })
              }
              isUpdating={saving}
              disabled={!settings.enabled || !settings.calendarEnabled}
              label={t(
                "meetings.detection.autoStart.label",
                "Open the meeting when its countdown is showing",
              )}
              description={t(
                "meetings.detection.autoStart.description",
                "Skips the notification when an event starts while you are already looking at its countdown. You still confirm what gets recorded.",
              )}
              descriptionMode="inline"
            />
          </div>
        </div>
      </Section>

      <Section
        title={t("meetings.detection.apps.label", "Meeting apps")}
        description={t(
          "meetings.detection.apps.description",
          "One bundle identifier per line. An entry only counts while that app is running, so a renamed identifier is inert rather than wrong.",
        )}
      >
        <div className="meeting-card">
          <Textarea
            rows={5}
            className="w-full font-mono text-[12px]"
            value={appsDraft ?? settings.meetingApps.join("\n")}
            onChange={(event) => setAppsDraft(event.target.value)}
            disabled={!settings.enabled || saving}
            aria-label={t("meetings.detection.apps.label", "Meeting apps")}
            spellCheck={false}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <StatusText tone="muted">
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
            </StatusText>
            <Button
              type="button"
              variant="secondary"
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
        </div>
      </Section>

      {/* Silent detection is indistinguishable from broken detection, so every
       * degraded path names itself here. Each line stays adjacent to the state
       * it reports and keeps its tone; the suppression line keeps its live
       * region because it changes on a tick, with no user action. */}
      <Section
        title={t("meetings.detection.state.title", "What detection can see")}
        description={t(
          "meetings.detection.state.description",
          "Detection is quiet most of the time. This is why.",
        )}
      >
        <div className="meeting-card flex flex-col items-start gap-1.5">
          {calendarBlocked ? (
            <StatusText tone="warning">
              {t(
                "meetings.detection.state.calendarDenied",
                "Calendar access was not granted, so only the microphone path runs.",
              )}
            </StatusText>
          ) : null}
          {status.notificationAccess === "denied" ? (
            <StatusText tone="warning">
              {t(
                "meetings.detection.state.notificationsDenied",
                "Notifications are off for Sona, so prompts appear in the app only.",
              )}
            </StatusText>
          ) : null}
          {status.inputDeviceReportingSuspect ? (
            <StatusText tone="muted">
              {t(
                "meetings.detection.state.bluetoothCaveat",
                "A meeting app is open but nothing reports using the microphone. Bluetooth headsets often do not, so start the meeting yourself if one is running.",
              )}
            </StatusText>
          ) : null}
          {suppression ? (
            <StatusText tone="muted" live="polite">
              {t(
                SUPPRESS_REASON_COPY[suppression][0],
                SUPPRESS_REASON_COPY[suppression][1],
              )}
            </StatusText>
          ) : null}
          {!status.availableStopTriggers.includes("silence") ? (
            <StatusText tone="muted">
              {t(
                "meetings.detection.state.noSilenceStop",
                "Captures stop on the event end, the app quitting, sleep, or your own stop. The silence timer needs live transcription, which runs after a meeting ends.",
              )}
            </StatusText>
          ) : null}
        </div>
      </Section>
    </>
  );
};
