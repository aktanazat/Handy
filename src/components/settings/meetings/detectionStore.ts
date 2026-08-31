import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type {
  DetectionPromptEvent,
  DetectionPromptKind,
  PersonBriefingRow,
} from "@/bindings";

/* Detection's frontend contract.
 *
 * The commands are invoked by name with camelCase argument keys, the same
 * precedent `read_history_audio_chunk` follows, so this store is the one place
 * that names detection's wire shapes. Every type below mirrors a Rust type in
 * src-tauri/src/meeting/detection.rs, which serializes camelCase.
 *
 * The two prompt shapes are the exception, and re-exported rather than
 * mirrored: `DetectionPromptEvent` is registered with the specta builder in
 * lib.rs, so bindings.ts generates it and the union it carries straight from
 * the Rust definitions. A hand mirror of them drifted once already — serde's
 * container `rename_all` renamed the variants instead of their fields, the
 * union matched no arm, and the pane rendered prompt cards with no title on
 * them. Generated types cannot drift, so these two no longer can. */

export type { DetectionPromptEvent, DetectionPromptKind };

export type CalendarAccess =
  | "not_determined"
  | "authorized"
  | "denied"
  | "unavailable";

export type NotificationAccess =
  | "not_determined"
  | "authorized"
  | "denied"
  | "unavailable";

export type DetectionSuppressReason =
  | "detection_disabled"
  | "sona_holds_input_device"
  | "capture_already_active"
  | "no_qualifying_signal"
  | "attendee_floor_not_met"
  | "unknown_mic_source"
  | "browser_title_unreadable"
  | "browser_title_not_meeting";

export type DetectionStopTrigger =
  | "sleep_boundary"
  | "event_end"
  | "trigger_app_exited"
  | "input_device_idle"
  | "silence";

export interface DetectionSettings {
  enabled: boolean;
  calendarEnabled: boolean;
  anyMicActivity: boolean;
  autoStartOnOpenPane: boolean;
  silenceStopMinutes: number;
  meetingApps: string[];
}

/** How one participant answered, when EventKit reports an answer at all. */
export type ParticipationStatus =
  | "unknown"
  | "pending"
  | "accepted"
  | "declined"
  | "tentative";

export interface CalendarAttendee {
  name: string;
  status: ParticipationStatus;
  isSelf: boolean;
}

/* Mirrors machine::CalendarEventSummary. Every field below `endUtcMs` is
 * serde-defaulted on the Rust side and absent whenever the calendar did not
 * supply it, which is what lets the pre-meeting card omit a row instead of
 * rendering an empty one. */
export interface CalendarEventSummary {
  eventKey: string;
  title: string;
  /** Includes participants EventKit refused to name, so it can exceed
   * `attendees.length`. */
  attendeeCount: number;
  startUtcMs: number;
  endUtcMs: number;
  attendees: CalendarAttendee[];
  notes: string | null;
  calendarName: string | null;
  url: string | null;
}

export interface DetectionCountdown {
  event: CalendarEventSummary;
  secondsToStart: number;
  briefing: PersonBriefingRow[];
}

export interface DetectionStatus {
  eventSchemaVersion: number;
  settings: DetectionSettings;
  calendarAccess: CalendarAccess;
  notificationAccess: NotificationAccess;
  inputDeviceActive: boolean;
  sonaHoldsInputDevice: boolean;
  suppressReason: DetectionSuppressReason | null;
  countdown: DetectionCountdown | null;
  runningMeetingApps: string[];
  availableStopTriggers: DetectionStopTrigger[];
  inputDeviceReportingSuspect: boolean;
}

/* What an offer is *about*, as opposed to which delivery of it this is.
 *
 * The backend mints a fresh prompt id on every raise
 * (detection.rs `raise`) and re-arms an application's claim every time the
 * input device goes idle (detection.rs `publish_status`), so the same app
 * across three microphone episodes legitimately produces three prompt ids for
 * one subject. Keyed by id alone, all three stacked into three identical
 * cards that nothing ever removed. */
const promptSubject = (entry: DetectionPromptEvent): string => {
  const prompt = entry.prompt;
  switch (prompt.kind) {
    case "CalendarEvent":
      return `event:${prompt.eventKey}`;
    case "AppMeeting":
    case "AppHuddle":
    case "BrowserCall":
      return `app:${prompt.bundleId}`;
    case "UnknownMicSource":
      return "mic";
  }
  /* A kind this build does not know is no evidence that two prompts are the
   * same offer, so key it by id, which never merges two distinct ones. */
  return entry.promptId;
};

interface DetectionStore {
  status: DetectionStatus | null;
  /* Prompts still waiting for an answer, oldest first. One entry per subject:
   * a re-raise supersedes the earlier offer rather than joining it. */
  prompts: DetectionPromptEvent[];
  setStatus: (status: DetectionStatus) => void;
  addPrompt: (prompt: DetectionPromptEvent) => void;
  clearPrompt: (promptId: string) => void;
  refresh: () => Promise<void>;
  answer: (promptId: string, accepted: boolean) => Promise<void>;
  save: (settings: DetectionSettings) => Promise<void>;
  requestCalendarAccess: () => Promise<CalendarAccess>;
  requestNotificationAccess: () => Promise<NotificationAccess>;
}

export const useDetectionStore = create<DetectionStore>()((set, get) => ({
  status: null,
  prompts: [],
  setStatus: (status) =>
    set((state) => ({
      status,
      /* An offer to record a call is live only while something holds the
       * microphone. The device going idle is the same signal detection's own
       * auto-stop reads as `input_device_idle` and the same moment the backend
       * re-arms the app's claim, so an unanswered ad-hoc prompt from that
       * episode is a stale offer rather than a pending one. Calendar prompts
       * outlive the device deliberately: they are raised at T-60s, before
       * anyone has opened a microphone. Statuses arrive on change only, so
       * this is one prune per episode, and the untouched case keeps the array
       * identity the prompt subscription compares on. */
      prompts: status.inputDeviceActive
        ? state.prompts
        : state.prompts.filter(
            (entry) => entry.prompt.kind === "CalendarEvent",
          ),
    })),
  addPrompt: (prompt) =>
    set((state) => {
      const subject = promptSubject(prompt);
      return {
        prompts: [
          ...state.prompts.filter((entry) => promptSubject(entry) !== subject),
          prompt,
        ],
      };
    }),
  clearPrompt: (promptId) =>
    set((state) => ({
      prompts: state.prompts.filter((entry) => entry.promptId !== promptId),
    })),

  /* Both status paths go through `setStatus`, so the rule about which prompts a
   * status leaves standing lives in exactly one place. */
  refresh: async () => {
    const status = await invoke<DetectionStatus>("detection_status_get");
    get().setStatus(status);
  },

  answer: async (promptId, accepted) => {
    /* Clear locally first: the card must stop offering a decision the operator
     * has already made, and the backend drops an unknown prompt id anyway. */
    get().clearPrompt(promptId);
    await invoke("detection_prompt_respond", { promptId, accepted });
  },

  save: async (settings) => {
    const status = await invoke<DetectionStatus>("detection_settings_set", {
      settings,
    });
    get().setStatus(status);
  },

  requestCalendarAccess: async () => {
    const access = await invoke<CalendarAccess>(
      "detection_calendar_access_request",
    );
    await get().refresh();
    return access;
  },

  requestNotificationAccess: async () => {
    const access = await invoke<NotificationAccess>(
      "detection_notification_access_request",
    );
    await get().refresh();
    return access;
  },
}));

/* Wires the two detection events into the store. Returns the detach function.
 *
 * Called once from the app shell, not per page: a prompt that arrives while the
 * operator is on another screen still has to reach the store, or clicking
 * "Start Transcribing" on a notification would silently do nothing. */
export const attachDetectionListeners = async (): Promise<() => void> => {
  const { setStatus, addPrompt } = useDetectionStore.getState();
  const unlisten = await Promise.all([
    listen<DetectionStatus>("detection-status", (event) => {
      setStatus(event.payload);
    }),
    listen<DetectionPromptEvent>("detection-prompt", (event) => {
      addPrompt(event.payload);
    }),
  ]);
  return () => {
    for (const detach of unlisten) detach();
  };
};
