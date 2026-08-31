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
    <SettingsCard aria-labelledby="overview-learning-suggestions">
      <h2 id="overview-learning-suggestions" className="px-4 pt-4 pb-2">
        <Microlabel>{t("learningV2.feed.title")}</Microlabel>
      </h2>
      <ul role="list" className="divide-y divide-gray-alpha-400">
        {entries.map((entry) => (
          <li
            key={`${entry.loop_kind}:${entry.candidate_key}`}
            data-testid="overview-learning-suggestion"
            className="space-y-2 px-4 py-3"
          >
            <p className="text-[13px] leading-5 text-gray-1000">
              {headline(entry.suggestion, t)}
            </p>
            {entry.evidence.examples.length === 0 ? null : (
              <ul role="list" className="space-y-0.5">
                {entry.evidence.examples.map((example) => (
                  <li
                    key={example}
                    className="truncate text-[11px] text-gray-700 italic"
                  >
                    {t("learningV2.feed.example", { text: example })}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-gray-700 tabular-nums">
              {t("learningV2.feed.evidence", {
                count: entry.evidence.occurrences,
                days: entry.evidence.distinct_days,
              })}
            </p>
            <div className="flex items-center gap-1">
              {/* Advice is an observation: there is nothing to accept, only
               * something to stop being told. */}
              {entry.suggestion.kind === "capture_advice" ? null : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onAccept(entry)}
                >
                  {t("learningV2.feed.accept")}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onDismiss(entry)}
              >
                {t("learningV2.feed.dismiss")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </SettingsCard>
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
