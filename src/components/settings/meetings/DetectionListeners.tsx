import React, { useEffect } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
    /* Subscribing rather than reading: this effect has to fire for every prompt,
     * including ones that arrive while the window is hidden. */
    return useDetectionStore.subscribe((state, previous) => {
      if (state.prompts === previous.prompts) return;
      const added = state.prompts.filter(
        (prompt) => !previous.prompts.includes(prompt),
      );
      for (const prompt of added) {
        if (prompt.notified) continue;
        toast(promptTitle(t, prompt.prompt), {
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

/* The §5.4 copy pattern, localized. The native notification carries the same
 * sentences in English; this is the in-app rendering of the same decision. */
export const promptTitle = (
  t: TFunction,
  prompt: DetectionPromptKind,
): string => {
  switch (prompt.kind) {
    case "CalendarEvent":
      return t("meetings.detection.prompt.calendar", "{{title}} starting", {
        title: prompt.eventTitle,
      });
    case "AppMeeting":
      return t("meetings.detection.prompt.app", "{{app}} meeting detected", {
        app: prompt.appName,
      });
    case "AppHuddle":
      return t("meetings.detection.prompt.huddle", "{{app}} huddle detected", {
        app: prompt.appName,
      });
    case "BrowserCall":
      return t(
        "meetings.detection.prompt.browser",
        "Call detected in {{app}}",
        {
          app: prompt.appName,
        },
      );
    case "UnknownMicSource":
      return t(
        "meetings.detection.prompt.unknown",
        "Microphone activity detected",
      );
  }
};
