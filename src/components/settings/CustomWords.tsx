import React, { useId, useRef } from "react";
import { Download, RotateCcw, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/vg/button";
import { Switch } from "@/components/vg/switch";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/rows";
import { ImportPreviewDialog } from "./custom-words/ImportPreviewDialog";
import { MeetingVocabularySuggestions } from "./custom-words/MeetingVocabularySuggestions";
import { VocabularyRules } from "./vocabulary/VocabularyRules";
import { useVocabularyRules } from "./vocabulary/useVocabularyRules";

/**
 * Every text rule the app applies after a transcript.
 *
 * Four switches say which kinds of rule are in force; one list holds the rules
 * themselves, whichever store they live in. The four separate editors this
 * replaces each carried their own heading, add row, column names, save button
 * and empty line — five copies of one grammar for four lists that a reader
 * only ever reads together.
 */
export const CustomWords: React.FC = () => {
  const { t } = useTranslation();
  const spokenEditsId = useId();
  const emojiId = useId();
  const snippetsId = useId();
  const replacementsId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const state = useVocabularyRules();

  const importLabel = t("settings.advanced.customWords.import");

  return (
    <>
      <SettingsCard className="divide-y divide-gray-alpha-400">
        <SettingsRow
          label={t("settings.advanced.spokenEdits.enabledLabel")}
          hint={t("settings.advanced.spokenEdits.enabledDescription")}
          controlId={spokenEditsId}
        >
          <Switch
            id={spokenEditsId}
            checked={state.spokenEditsEnabled}
            disabled={state.busy}
            onCheckedChange={state.setSpokenEdits}
          />
        </SettingsRow>
        <SettingsRow
          label={t("modesV2.rules.toggles.emoji")}
          hint={t("settings.advanced.emoji.enabledDescription")}
          controlId={emojiId}
        >
          <Switch
            id={emojiId}
            checked={state.emojiEnabled}
            disabled={state.busy}
            onCheckedChange={state.setEmoji}
          />
        </SettingsRow>
        {/* The two kill switches the merged list inherited from the panels it
         * replaces. They are state about whether a kind of rule fires at all,
         * which is the same sentence as the two above, so they sit in the same
         * band rather than on the rows they govern. */}
        <SettingsRow
          label={t("modesV2.rules.toggles.snippet")}
          controlId={snippetsId}
        >
          <Switch
            id={snippetsId}
            checked={state.snippetsEnabled}
            disabled={state.busy}
            onCheckedChange={state.setSnippets}
          />
        </SettingsRow>
        <SettingsRow
          label={t("modesV2.rules.toggles.replacement")}
          controlId={replacementsId}
        >
          <Switch
            id={replacementsId}
            checked={state.replacementsEnabled}
            disabled={state.busy}
            onCheckedChange={state.setReplacements}
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsSection
        label={t("modesV2.rules.title")}
        action={
          <span
            role="group"
            aria-label={t("settings.advanced.customWords.actions")}
            className="flex items-center gap-1"
          >
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={state.busy}
            >
              <Upload aria-hidden="true" />
              {importLabel}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={state.exportCsv}
              disabled={state.busy || state.savedVocabularyCount === 0}
            >
              <Download aria-hidden="true" />
              {t("settings.advanced.customWords.export")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={state.restoreDefaultRewrites}
              disabled={state.busy}
              data-testid="rules-restore-rewrites"
            >
              <RotateCcw aria-hidden="true" />
              {t("modesV2.rules.restoreRewrites")}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label={importLabel}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) state.previewImport(file);
              }}
            />
          </span>
        }
      >
        <MeetingVocabularySuggestions
          entries={state.vocabularyEntries}
          onAccept={state.addSuggestion}
        />
        <VocabularyRules state={state} />
      </SettingsSection>

      <ImportPreviewDialog
        review={state.review}
        savedCount={state.savedVocabularyCount}
        saving={state.busy}
        onStep={state.setReviewStep}
        onClose={state.closeReview}
        onApply={state.applyImport}
      />
    </>
  );
};
