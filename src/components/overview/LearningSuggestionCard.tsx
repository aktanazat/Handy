import React from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  commands,
  type LearningDecisionStatus,
  type LearningSuggestion,
  type LearningSuggestionEntry,
} from "@/bindings";
import { useLearningDecisions } from "@/hooks/useLearningDecisions";
import { Button } from "@/components/vg/button";
import { Microlabel, SettingsCard } from "@/components/settings/rows";

/* What Sona noticed, phrased as a question a person can answer.
 *
 * Every line is one mined suggestion with its own evidence and its own answer.
 * Nothing is filtered here: the store applies every cap and floor before a row
 * exists, so whatever arrives is meant to be read. */
const headline = (suggestion: LearningSuggestion, t: TFunction): string => {
  switch (suggestion.kind) {
    case "spoken_punctuation":
      return t("learningV2.feed.spokenPunctuation", {
        spoken: suggestion.spoken,
        written: suggestion.written,
      });
    case "vocabulary_correction":
      return t("learningV2.feed.vocabularyCorrection", {
        spoken: suggestion.spoken,
        written: suggestion.written,
      });
    case "mode_habit":
      return t("learningV2.feed.modeHabit", { mode: suggestion.mode_name });
    case "capture_advice":
      switch (suggestion.advice) {
        case "retry_rate":
          return t("learningV2.feed.retryRate", {
            subject: suggestion.subject,
            times: (suggestion.stat_permille / 1000).toFixed(1),
          });
        case "lost_capture_rate":
          return t("learningV2.feed.lostCaptureRate", {
            subject: suggestion.subject,
            times: (suggestion.stat_permille / 1000).toFixed(1),
          });
        case "input_level":
          return t("learningV2.feed.inputLevel", {
            percent: Math.round(suggestion.stat_permille / 10),
          });
        default: {
          const exhaustive: never = suggestion.advice;
          return exhaustive;
        }
      }
    default: {
      const exhaustive: never = suggestion;
      return exhaustive;
    }
  }
};

interface LearningSuggestionCardViewProps {
  entries: readonly LearningSuggestionEntry[];
  onAccept: (entry: LearningSuggestionEntry) => void;
  onDismiss: (entry: LearningSuggestionEntry) => void;
}

export const LearningSuggestionCardView: React.FC<
  LearningSuggestionCardViewProps
> = ({ entries, onAccept, onDismiss }) => {
  const { t } = useTranslation();
  if (entries.length === 0) return null;

  return (
    /* The label sits above the surface, like every other section label on this
     * page, so the first row inside the card is a row. */
    <div className="flex min-w-0 flex-col gap-2">
      <h2 id="overview-learning-suggestions">
        <Microlabel>{t("learningV2.feed.title")}</Microlabel>
      </h2>
      <SettingsCard
        aria-labelledby="overview-learning-suggestions"
        className="overflow-hidden"
      >
        <ul role="list" className="divide-y divide-gray-alpha-400">
          {entries.map((entry) => (
            <li
              key={`${entry.loop_kind}:${entry.candidate_key}`}
              data-testid="overview-learning-suggestion"
              className="flex flex-col gap-2 px-6 py-3.5"
            >
              <p className="text-[14px] leading-[21px] font-medium text-gray-1000">
                {headline(entry.suggestion, t)}
              </p>
              {entry.evidence.examples.length === 0 ? null : (
                /* The quote is the evidence, already in quotation marks in
                 * every catalogue, so it needs no second styling. */
                <ul role="list" className="flex flex-col gap-0.5">
                  {entry.evidence.examples.map((example) => (
                    <li
                      key={example}
                      className="truncate text-[13px] leading-[18px] text-gray-800"
                    >
                      {t("learningV2.feed.example", { text: example })}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex items-center gap-1">
                  {/* Advice is an observation: there is nothing to accept, only
                   * something to stop being told. */}
                  {entry.suggestion.kind === "capture_advice" ? null : (
                    <Button
                      type="button"
                      size="xs"
                      onClick={() => onAccept(entry)}
                    >
                      {t("learningV2.feed.accept")}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => onDismiss(entry)}
                  >
                    {t("learningV2.feed.dismiss")}
                  </Button>
                </div>
                {/* How often, and over how many days: the reason this question
                 * is being asked at all. */}
                <span className="ms-auto text-[13px] leading-[18px] text-gray-900 tabular-nums">
                  {t("learningV2.feed.evidence", {
                    count: entry.evidence.occurrences,
                    days: entry.evidence.distinct_days,
                  })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </SettingsCard>
    </div>
  );
};

/* What the store remembers as the answer's subject.
 *
 * Two of these are not display-only: loop 4 primes a session's ASR from the
 * accepted vocabulary lines (`accepted_display_texts_in`), so those stay the
 * bare term the reader agreed to and never a rendered sentence. Advice is the
 * one kind nothing reads back, and the one whose discriminant — `retry_rate` —
 * is not a thing to show a person, so it carries the line they actually saw. */
const displayText = (suggestion: LearningSuggestion, t: TFunction): string => {
  switch (suggestion.kind) {
    case "spoken_punctuation":
    case "vocabulary_correction":
      return suggestion.spoken;
    case "mode_habit":
      return suggestion.mode_name;
    case "capture_advice":
      return headline(suggestion, t);
    default: {
      const exhaustive: never = suggestion;
      return exhaustive;
    }
  }
};

const loadSuggestions = async (): Promise<
  readonly LearningSuggestionEntry[]
> => {
  const result = await commands.learningSuggestions();
  return result.status === "ok" ? result.data.entries : [];
};

export const LearningSuggestionCard: React.FC = () => {
  const { t } = useTranslation();
  const { entries, decide } = useLearningDecisions(loadSuggestions);

  const answer = (
    entry: LearningSuggestionEntry,
    status: LearningDecisionStatus,
  ) =>
    void decide(
      {
        loop_kind: entry.loop_kind,
        candidate_key: entry.candidate_key,
        display_text: displayText(entry.suggestion, t),
      },
      status,
    );

  return (
    <LearningSuggestionCardView
      entries={entries}
      onAccept={(entry) => answer(entry, "accepted")}
      onDismiss={(entry) => answer(entry, "dismissed")}
    />
  );
};
