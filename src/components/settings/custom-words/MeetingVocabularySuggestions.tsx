import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  events,
  type VocabularyCandidate,
  type VocabularyEntry,
} from "@/bindings";
import { spokenMatchKey } from "@/lib/vocabularyDraft";
import { Button } from "@/components/vg/button";
import { Microlabel } from "@/components/settings/rows";
import {
  readVocabularyDismissals,
  writeVocabularyDismissals,
} from "./meetingVocabulary";

interface MeetingVocabularySuggestionsProps {
  entries: readonly VocabularyEntry[];
  onAccept: (text: string) => void;
}

interface MeetingVocabularySuggestionsListProps {
  candidates: readonly VocabularyCandidate[];
  onAccept: (text: string) => void;
  onDismiss: (text: string) => void;
}

export const MeetingVocabularySuggestionsList: React.FC<
  MeetingVocabularySuggestionsListProps
> = ({ candidates, onAccept, onDismiss }) => {
  const { t } = useTranslation();
  if (candidates.length === 0) return null;

  return (
    <div
      data-testid="meeting-vocabulary-suggestions"
      className="space-y-2 border-b border-gray-alpha-400 px-4 py-3"
    >
      <Microlabel>
        {t("settings.workflows.vocabularySuggestions.title")}
      </Microlabel>
      <ul role="list" className="divide-y divide-gray-alpha-400">
        {candidates.map((candidate) => (
          <li
            key={candidate.text}
            className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-2 first:pt-1 last:pb-0"
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] text-gray-1000">
                {candidate.text}
              </p>
              <p className="font-mono text-[11px] text-gray-700">
                {t("settings.workflows.vocabularySuggestions.occurrences", {
                  count: candidate.occurrences,
                })}{" "}
                ·{" "}
                {t("settings.workflows.vocabularySuggestions.meetings", {
                  count: candidate.meetings_count,
                })}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onAccept(candidate.text)}
              >
                {t("settings.workflows.vocabularySuggestions.accept")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onDismiss(candidate.text)}
              >
                {t("settings.workflows.vocabularySuggestions.dismiss")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const MeetingVocabularySuggestions: React.FC<
  MeetingVocabularySuggestionsProps
> = ({ entries, onAccept }) => {
  const [candidates, setCandidates] = useState<VocabularyCandidate[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const result = await commands.vocabularyCandidates();
      setCandidates(result.status === "ok" ? result.data.entries : []);
    } catch {
      setCandidates([]);
    }
  }, []);

  useEffect(() => {
    setDismissed(readVocabularyDismissals(window.localStorage));
    void refresh();
    const subscription = events.meetingArtifactChanged.listen(() => {
      void refresh();
    });
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, [refresh]);

  const knownTerms = useMemo(() => {
    const terms = new Set<string>();
    for (const entry of entries) {
      terms.add(spokenMatchKey(entry.spoken));
      terms.add(spokenMatchKey(entry.written));
    }
    return terms;
  }, [entries]);

  const visibleCandidates = candidates.filter(
    (candidate) =>
      !dismissed.has(candidate.text) &&
      !knownTerms.has(spokenMatchKey(candidate.text)),
  );

  const dismiss = (text: string) => {
    setDismissed((current) => {
      const next = new Set(current).add(text);
      try {
        writeVocabularyDismissals(window.localStorage, next);
      } catch {
        // The in-memory dismissal still applies when this webview denies storage.
      }
      return next;
    });
  };

  return (
    <MeetingVocabularySuggestionsList
      candidates={visibleCandidates}
      onAccept={onAccept}
      onDismiss={dismiss}
    />
  );
};
