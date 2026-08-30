import React, { useId } from "react";
import { Download, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/vg/button";
import { Switch } from "@/components/vg/switch";
import {
  Notice,
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/rows";
import { SnippetsPanel } from "./vocabulary/SnippetsPanel";
import { ReplacementsPanel } from "./vocabulary/ReplacementsPanel";
import { ImportPreviewDialog } from "./custom-words/ImportPreviewDialog";
import { PairEditor } from "./custom-words/PairEditor";
import { useCustomWordsEditor } from "./custom-words/useCustomWordsEditor";

/* Every text rule the app applies after a transcript, in the order a user
 * meets them: the global vocabulary and its CSV transfer, text expansion,
 * replacements, spoken editing, and the emoji map. */
export const CustomWords: React.FC = () => {
  const { t } = useTranslation();
  const spokenEditsId = useId();
  const {
    entries,
    emojiReplacements,
    savedCount,
    spoken,
    written,
    emojiSpoken,
    emojiWritten,
    setSpoken,
    setWritten,
    setEmojiSpoken,
    setEmojiWritten,
    loading,
    saving,
    failure,
    review,
    vocabularyChanged,
    emojiChanged,
    vocabularyDraft,
    emojiDraft,
    vocabularyBlockers,
    emojiBlockers,
    emojiEnabled,
    spokenEditsEnabled,
    fileInputRef,
    getVocabularyRowKey,
    getEmojiRowKey,
    addEntry,
    editEntry,
    removeEntry,
    addEmojiReplacement,
    editEmojiReplacement,
    removeEmojiReplacement,
    saveEntries,
    saveEmojiReplacements,
    previewImport,
    applyImport,
    exportCsv,
    toggleEmojiReplacements,
    toggleSpokenEdits,
    setReviewStep,
    closeReview,
  } = useCustomWordsEditor();

  const vocabularyTitle = t("settings.advanced.customWords.title");
  const emojiTitle = t("settings.advanced.emoji.title");
  const importLabel = t("settings.advanced.customWords.import");

  return (
    <>
      <SettingsSection
        label={vocabularyTitle}
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
              disabled={saving}
            >
              <Upload aria-hidden="true" />
              {importLabel}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void exportCsv()}
              disabled={saving || savedCount === 0}
            >
              <Download aria-hidden="true" />
              {t("settings.advanced.customWords.export")}
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
                if (file) void previewImport(file);
              }}
            />
          </span>
        }
      >
        <PairEditor
          labels={{
            title: vocabularyTitle,
            spoken: t("settings.advanced.customWords.spoken"),
            written: t("settings.advanced.customWords.written"),
            spokenPlaceholder: t(
              "settings.advanced.customWords.spokenPlaceholder",
            ),
            writtenPlaceholder: t(
              "settings.advanced.customWords.writtenPlaceholder",
            ),
            add: t("settings.advanced.customWords.add"),
            save: t("settings.advanced.customWords.save"),
            remove: (entrySpoken) =>
              t("settings.advanced.customWords.remove", {
                spoken: entrySpoken,
              }),
            empty: t(
              "settings.advanced.customWords.empty.description",
              "Add a pair such as open ai and OpenAI, and Sona writes the exact form every time it hears the phrase.",
            ),
          }}
          entries={entries}
          draftSpoken={spoken}
          draftWritten={written}
          draftHint={vocabularyDraft.hint}
          canAdd={!saving && vocabularyDraft.addable}
          changed={vocabularyChanged}
          saving={saving}
          loading={loading}
          blockers={vocabularyBlockers}
          testId="vocabulary-editor"
          getRowKey={getVocabularyRowKey}
          onDraftSpokenChange={setSpoken}
          onDraftWrittenChange={setWritten}
          onAdd={addEntry}
          onEdit={editEntry}
          onRemove={removeEntry}
          onSave={() => void saveEntries()}
          footnote={t(
            "settings.advanced.customWords.sources",
            "Corrections you save from a transcript in Library land in this list. Rules for a single mode live in that mode's own vocabulary.",
          )}
        />
      </SettingsSection>

      {failure && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Notice tone="danger">{failure.message}</Notice>
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={failure.retry}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}

      <SnippetsPanel />

      <ReplacementsPanel />

      <SettingsCard>
        <SettingsRow
          label={t("settings.advanced.spokenEdits.enabledLabel")}
          hint={t("settings.advanced.spokenEdits.enabledDescription")}
          controlId={spokenEditsId}
        >
          <Switch
            id={spokenEditsId}
            checked={spokenEditsEnabled}
            disabled={saving}
            onCheckedChange={(enabled) => void toggleSpokenEdits(enabled)}
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsSection
        label={emojiTitle}
        action={
          <Switch
            checked={emojiEnabled}
            disabled={saving}
            onCheckedChange={(enabled) => void toggleEmojiReplacements(enabled)}
            aria-label={t("settings.advanced.emoji.enabledLabel")}
          />
        }
      >
        {emojiEnabled && (
          <PairEditor
            labels={{
              title: emojiTitle,
              spoken: t("settings.advanced.emoji.spoken"),
              written: t("settings.advanced.emoji.written"),
              spokenPlaceholder: t("settings.advanced.emoji.spokenPlaceholder"),
              writtenPlaceholder: t(
                "settings.advanced.emoji.writtenPlaceholder",
              ),
              add: t("settings.advanced.emoji.add"),
              save: t("settings.advanced.emoji.save"),
              remove: (entrySpoken) =>
                t("settings.advanced.emoji.remove", { spoken: entrySpoken }),
              empty: t(
                "settings.advanced.emoji.empty.description",
                "Map an exact spoken token such as smiley face to the emoji you want written.",
              ),
            }}
            entries={emojiReplacements}
            draftSpoken={emojiSpoken}
            draftWritten={emojiWritten}
            draftHint={emojiDraft.hint}
            canAdd={!saving && emojiDraft.addable}
            changed={emojiChanged}
            saving={saving}
            loading={loading}
            blockers={emojiBlockers}
            testId="emoji-editor"
            getRowKey={getEmojiRowKey}
            onDraftSpokenChange={setEmojiSpoken}
            onDraftWrittenChange={setEmojiWritten}
            onAdd={addEmojiReplacement}
            onEdit={editEmojiReplacement}
            onRemove={removeEmojiReplacement}
            onSave={() => void saveEmojiReplacements()}
          />
        )}
        <Notice live={false} className="px-4 py-3">
          {t("settings.advanced.emoji.enabledDescription")}
        </Notice>
      </SettingsSection>

      <ImportPreviewDialog
        review={review}
        savedCount={savedCount}
        saving={saving}
        unsavedChanges={vocabularyChanged}
        onStep={setReviewStep}
        onClose={closeReview}
        onApply={() => void applyImport()}
      />
    </>
  );
};
