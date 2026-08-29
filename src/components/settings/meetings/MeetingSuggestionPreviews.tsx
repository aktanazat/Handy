import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MeetingSuggestion, SourceKind } from "@/bindings";
import { Section, StatusText } from "../../ui";
import { useSettingsStore } from "@/stores/settingsStore";
import { MeetingPreviewCard, suggestionFacts } from "./MeetingPreviewCard";

/* Offers raised by a running meeting application.
 *
 * The suggestion payload is content-free by design — provider, bundle id,
 * evidence flags, two instants — so these cards are short, and they are short
 * honestly: there is no time row because nothing scheduled the call, and no
 * participants row because no list exists to read. The rows that do appear
 * (the app, and what the next press will record) are the ones the operator can
 * still act on.
 *
 * Skip is local, and says so. The backend has no dismissal for an offer: an
 * offer expires on its own clock and no offer starts anything, so hiding one
 * here changes nothing but this list. That is stated under the list rather
 * than implied, because a Skip that quietly meant something larger — or
 * smaller — is the kind of control people stop trusting. */

export interface MeetingSuggestionPreviewsProps {
  suggestions: MeetingSuggestion[];
  sources: SourceKind[];
  starting: boolean;
  onSourcesChange: (sources: SourceKind[]) => void;
  onStartSuggestion: (suggestion: MeetingSuggestion) => void;
}

export const MeetingSuggestionPreviews: React.FC<
  MeetingSuggestionPreviewsProps
> = ({
  suggestions,
  sources,
  starting,
  onSourcesChange,
  onStartSuggestion,
}) => {
  const { t } = useTranslation();
  const [skipped, setSkipped] = useState<string[]>([]);
  const notesTemplate = useSettingsStore(
    (state) => state.settings?.meeting_notes_template ?? null,
  );

  const visible = suggestions.filter(
    (suggestion) => !skipped.includes(suggestion.offer_id),
  );
  if (visible.length === 0) return null;

  const toggleSource = (source: SourceKind) =>
    onSourcesChange(
      sources.includes(source)
        ? sources.filter((candidate) => candidate !== source)
        : [...sources, source],
    );

  return (
    <Section
      title={t("meetings.detected.title")}
      description={t(
        "meetings.detected.description",
        "Sona noticed a meeting app in use.",
      )}
    >
      <ul
        className="meeting-previews"
        aria-label={t("meetings.detected.title")}
      >
        {visible.map((suggestion) => (
          <MeetingPreviewCard
            key={suggestion.offer_id}
            facts={suggestionFacts(suggestion, t)}
            recording={{
              armed: sources,
              onToggle: toggleSource,
              disabled: starting,
            }}
            notesTemplate={notesTemplate}
            starting={starting}
            onStart={() => onStartSuggestion(suggestion)}
            onSkip={() => setSkipped([...skipped, suggestion.offer_id])}
          />
        ))}
      </ul>
      {/* Stated before the press, not after it: skipping the last offer takes
       * this whole section with it, so a footnote that only appeared once
       * something had been skipped was unreadable in the common case of a
       * single offer. */}
      <StatusText tone="muted" className="mt-2 block">
        {t(
          "meetings.preview.skippedNote",
          "Skipping hides an offer here. Sona keeps seeing the call until the offer expires.",
        )}
      </StatusText>
    </Section>
  );
};
