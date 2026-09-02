import React, { useEffect } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { events } from "@/bindings";
import {
  attachDetectionListeners,
  useDetectionStore,
  type DetectionPromptKind,
} from "./detectionStore";

/* App-level detection wiring. Renders nothing.
 *
 * Two jobs, both of which have to survive the operator being on any screen:
 *   - keep the detection store fed, so the pre-meeting card and the settings
 *     section always show current state;
 *   - put a prompt somewhere visible when the native notification could not be
 *     delivered. Without that fallback, a denied notification grant would make
 *     detection look broken rather than degraded. */
export const DetectionListeners: React.FC = () => {
  const { t } = useTranslation();
  const answer = useDetectionStore((state) => state.answer);
  const refresh = useDetectionStore((state) => state.refresh);
  const clearPrompt = useDetectionStore((state) => state.clearPrompt);

  useEffect(() => {
    void refresh().catch(() => {
      /* Detection is optional. A failed first read leaves the card and the
       * settings section on their loading state until the next event. */
    });
  }, [refresh]);

  useEffect(() => {
    const detach = attachDetectionListeners();
    return () => {
      void detach.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const subscription = events.detectionPromptRetracted.listen((event) => {
      clearPrompt(event.payload.promptId);
      toast.dismiss(promptToastId(event.payload.promptId));
    });
    return () => {
      void subscription.then((stop) => stop());
    };
  }, [clearPrompt]);

  useEffect(() => {
    const subscriptions = Promise.all([
      events.meetingRitual.listen((event) => {
        if (event.payload.delivery !== "in_app_only") return;
        toast(event.payload.notificationTitle, {
          id: ritualToastId(event.payload.ritualId),
        });
      }),
      events.meetingRitualRetracted.listen((event) => {
        toast.dismiss(ritualToastId(event.payload.ritualId));
      }),
    ]);
    return () => {
      void subscriptions.then((stops) => stops.forEach((stop) => stop()));
    };
  }, []);

  useEffect(() => {
    /* Subscribing rather than reading: this effect has to fire for every prompt,
     * including ones that arrive while the window is hidden. */
    return useDetectionStore.subscribe((state, previous) => {
      if (state.prompts === previous.prompts) return;
      const added = state.prompts.filter(
        (prompt) => !previous.prompts.includes(prompt),
      );
      for (const prompt of added) {
        if (prompt.delivery !== "in_app_only") continue;
        toast(promptTitle(t, prompt.prompt), {
          id: promptToastId(prompt.promptId),
          description: t(
            "meetings.detection.prompt.body",
            "Sona can take local notes for this call.",
          ),
          action: {
            label: t("meetings.detection.actions.start", "Start transcribing"),
            onClick: () => void answer(prompt.promptId, true),
          },
          cancel: {
            label: t("meetings.detection.actions.dismiss", "Dismiss"),
            onClick: () => void answer(prompt.promptId, false),
          },
        });
      }
    });
  }, [answer, t]);

  return null;
};

const promptToastId = (promptId: string): string =>
  `detection-prompt:${promptId}`;

const ritualToastId = (ritualId: string): string =>
  `meeting-ritual:${ritualId}`;

/* A name the payload actually supplied.
 *
 * The parameter admits `undefined` because the wire once disagreed with the
 * frontend's declaration of it: interpolating a missing name produced a card
 * whose only content was an app icon and two buttons, and reading `.trim()`
 * off an absent field would have turned that blank card into a render crash.
 * `DetectionPromptKind` is generated from the Rust enum now, so that exact
 * disagreement cannot recur — but a payload from an older or newer build
 * still can, and this stays cheap. */
const named = (value: string | undefined): string | null =>
  value === undefined || value.trim() === "" ? null : value;

/* The §5.4 copy pattern, localized. The native notification carries the same
 * sentences in English; this is the in-app rendering of the same decision.
 *
 * Total by construction: every arm returns a sentence even when the name it
 * would interpolate is missing, because the card this titles carries a Start
 * recording button and an untitled offer to record is not an offer. */
export const promptTitle = (
  t: TFunction,
  prompt: DetectionPromptKind,
): string => {
  switch (prompt.kind) {
    case "CalendarEvent": {
      const title = named(prompt.eventTitle);
      if (title !== null) {
        return t("meetings.detection.prompt.calendar", "{{title}} starting", {
          title,
        });
      }
      /* The calendar is still the honest attribution even with no title on the
       * event, so this one names its source rather than falling through. */
      return t(
        "meetings.detection.prompt.calendarUntitled",
        "Calendar event starting",
      );
    }
    case "AppMeeting": {
      const app = named(prompt.appName);
      if (app !== null) {
        return t("meetings.detection.prompt.app", "{{app}} meeting detected", {
          app,
        });
      }
      break;
    }
    case "AppCall": {
      const app = named(prompt.appName);
      if (app !== null) {
        return t("meetings.detection.prompt.call", "{{app}} call detected", {
          app,
        });
      }
      break;
    }
    case "AppHuddle": {
      const app = named(prompt.appName);
      if (app !== null) {
        return t(
          "meetings.detection.prompt.huddle",
          "{{app}} huddle detected",
          { app },
        );
      }
      break;
    }
    case "BrowserCall": {
      const app = named(prompt.appName);
      if (app !== null) {
        return t(
          "meetings.detection.prompt.browser",
          "Call detected in {{app}}",
          { app },
        );
      }
      break;
    }
    case "UnknownMicSource":
      return t(
        "meetings.detection.prompt.unknown",
        "Microphone activity detected",
      );
  }
  /* One sentence for both ways a prompt can arrive unnameable: an app the
   * platform would not name, and — once, in the field — a `kind` this build
   * could not read after the Rust enum's serde tagging drifted from the
   * frontend's copy of it. Either way the detection was real, so it gets a
   * sentence rather than a blank header: silent detection is
   * indistinguishable from broken detection, and this card carries a Start
   * recording button. */
  return t("meetings.detection.prompt.generic", "Meeting detected");
};
