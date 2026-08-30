import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MeetingSuggestion, SourceKind } from "@/bindings";
import { Notice } from "@/components/settings/rows";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  MeetingPreviewCard,
  MeetingPreviewList,
  suggestionFacts,
} from "./MeetingPreviewCard";

/* Offers raised by a running meeting application.
 *
 * The suggestion payload is content-free by design — provider, bundle id,
 * evidence flags, two instants — so these cards are short, and they are short
 * honestly: there is no time row because nothing scheduled the call, and no
 * participants row because no list exists to read. The rows that do appear
 * (the app, and what the next press will record) are the ones the operator can
 * still act on.
 *
 * The section carries no description: "Sona noticed a meeting app in use" was
 * the heading again in a longer form, and the card underneath already names
 * the app it noticed.
 *
 * Skip is local, and the one sentence here says so. The backend has no
 * dismissal for an offer: an offer expires on its own clock and no offer
 * starts anything, so hiding one here changes nothing but this list. That is a
 * consequence of the control, not a restatement of it, which is why it is the
 * one line of prose this section keeps. */

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
    <MeetingPreviewList
      label={t("meetings.detected.title")}
      /* Stated before the press, not after it: skipping the last offer takes
       * this whole section with it, so a footnote that only appeared once
       * something had been skipped was unreadable in the common case of a
       * single offer. */
      footer={
        <Notice tone="muted" live={false}>
          {t(
            "meetings.preview.skippedNote",
            "Skipping hides an offer here. Sona keeps seeing the call until the offer expires.",
          )}
        </Notice>
      }
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
    </MeetingPreviewList>
  );
};
