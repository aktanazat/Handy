import React from "react";
import { useTranslation } from "react-i18next";
import { Button, Section, StatusText } from "../../ui";
import { promptTitle } from "./DetectionListeners";
import { useDetectionStore } from "./detectionStore";

/* The pre-meeting pane from §5.3 case 1, plus any prompt still waiting.
 *
 * Renders nothing when there is nothing to say, so it costs a page no vertical
 * space in the common case. Two things share one surface deliberately: a
 * countdown and a prompt are the same question at two moments, and splitting
 * them would put two competing affordances on the same screen.
 *
 * Having this card open for an event is also what §5.3 case 2 reads as prior
 * opt-in, so its visibility is load-bearing, not decorative.
 *
 * A prompt is an object with an answer attached, so it gets a surface. The
 * assurance sentence is the section description rather than per-row copy: it
 * is one promise about the whole pane, and it has to be readable before the
 * affirmative button is pressed. */
export const PreMeetingCountdownCard: React.FC = () => {
  const { t } = useTranslation();
  const status = useDetectionStore((state) => state.status);
  const prompts = useDetectionStore((state) => state.prompts);
  const answer = useDetectionStore((state) => state.answer);

  const countdown = status?.countdown ?? null;
  if (countdown === null && prompts.length === 0) return null;

  return (
    <Section
      title={t("meetings.detection.pane.title", "Starting soon")}
      description={t(
        "meetings.start.assurance",
        "Records your Mac's audio locally. Nothing joins the call.",
      )}
    >
      <ul
        className="meeting-cards"
        aria-label={t("meetings.detection.pane.title", "Starting soon")}
      >
        {countdown ? (
          <li className="meeting-card">
            <span className="min-w-0">
              <span className="meeting-card-title block">
                {countdown.eventTitle}
              </span>
              <span className="microlabel mt-0.5 block tabular-nums">
                {t(
                  "meetings.detection.pane.countdown",
                  "Starts in {{seconds}}s",
                  { seconds: Math.max(0, countdown.secondsToStart) },
                )}
              </span>
            </span>
            <StatusText tone="muted" className="flex-none self-center">
              {t("meetings.detection.pane.notYetRecording", "Not recording")}
            </StatusText>
          </li>
        ) : null}

        {prompts.map((prompt) => (
          <li key={prompt.promptId} className="meeting-card">
            <span className="min-w-0">
              <span className="meeting-card-title block">
                {promptTitle(t, prompt.prompt)}
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-[18px] text-text-secondary">
                {t(
                  "meetings.detection.prompt.body",
                  "Sona can take local notes for this call.",
                )}
              </span>
            </span>
            <span className="flex flex-none items-center gap-2 self-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void answer(prompt.promptId, false)}
              >
                {t("meetings.detection.actions.dismiss", "Dismiss")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void answer(prompt.promptId, true)}
              >
                {t("meetings.detection.actions.start", "Start transcribing")}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
};
