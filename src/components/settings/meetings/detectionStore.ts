import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

/* Detection's frontend contract.
 *
 * The commands are invoked by name with camelCase argument keys, the same
 * precedent `read_history_audio_chunk` follows, so this store is the one place
 * that names detection's wire shapes. Every type below mirrors a Rust type in
 * src-tauri/src/meeting/detection.rs, which serializes camelCase. */

export type DetectionPromptKind =
  | { kind: "CalendarEvent"; eventKey: string; eventTitle: string }
  | { kind: "AppMeeting"; bundleId: string; appName: string }
  | { kind: "AppHuddle"; bundleId: string; appName: string }
  | { kind: "BrowserCall"; bundleId: string; appName: string }
  | { kind: "UnknownMicSource" };

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

export interface DetectionPromptEvent {
  eventSchemaVersion: number;
  promptId: string;
  prompt: DetectionPromptKind;
  notificationTitle: string;
  notified: boolean;
}

interface DetectionStore {
  status: DetectionStatus | null;
  /* Prompts still waiting for an answer, oldest first. The backend is the only
   * authority on whether a prompt is still live; this list is a mirror that a
   * click or a dismissal clears. */
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
  setStatus: (status) => set({ status }),
  addPrompt: (prompt) =>
    set((state) => ({
      /* Replacing by id keeps a re-delivered notification from stacking. */
      prompts: [
        ...state.prompts.filter((entry) => entry.promptId !== prompt.promptId),
        prompt,
      ],
    })),
  clearPrompt: (promptId) =>
    set((state) => ({
      prompts: state.prompts.filter((entry) => entry.promptId !== promptId),
    })),

  refresh: async () => {
    const status = await invoke<DetectionStatus>("detection_status_get");
    set({ status });
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
    set({ status });
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
