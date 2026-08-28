import React, { useCallback, useEffect, useRef, useState } from "react";
import { Ellipsis, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  mergeAppliedCsv,
  resolveRefreshDraft,
  samePairEntries,
} from "@/lib/vocabularyDraft";
import {
  commands,
  type EmojiReplacement,
  type VocabularyCsvPreview,
  type VocabularyEntry,
} from "@/bindings";
import { useSettings } from "../../hooks/useSettings";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { SettingContainer } from "../ui/SettingContainer";
import { ToggleSwitch } from "../ui/ToggleSwitch";

interface CustomWordsProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

interface PairRowsProps {
  entries: VocabularyEntry[] | EmojiReplacement[];
  listLabel: string;
  spokenLabel: string;
  writtenLabel: string;
  onChange: (index: number, field: "spoken" | "written", value: string) => void;
  onRemove: (index: number) => void;
  removeLabel: (spoken: string) => string;
  disabled: boolean;
  getRowKey: (entry: VocabularyEntry | EmojiReplacement) => string;
}

interface VocabularyPairsEditorProps {
  entries: VocabularyEntry[];
  spoken: string;
  written: string;
  descriptionMode: "inline" | "tooltip";
  grouped: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  changed: boolean;
  saving: boolean;
  onSpokenChange: (value: string) => void;
  onWrittenChange: (value: string) => void;
  onAdd: () => void;
  onChange: (index: number, field: "spoken" | "written", value: string) => void;
  onRemove: (index: number) => void;
  getRowKey: (entry: VocabularyEntry) => string;
  onSave: () => void;
  onImport: () => void;
  onExport: () => void;
  onFile: (file: File) => void;
}

interface EmojiPairsEditorProps {
  entries: EmojiReplacement[];
  spoken: string;
  written: string;
  descriptionMode: "inline" | "tooltip";
  grouped: boolean;
  changed: boolean;
  saving: boolean;
  onSpokenChange: (value: string) => void;
  onWrittenChange: (value: string) => void;
  onAdd: () => void;
  onChange: (index: number, field: "spoken" | "written", value: string) => void;
  onRemove: (index: number) => void;
  onSave: () => void;
  getRowKey: (entry: EmojiReplacement) => string;
}

interface ImportPreviewDialogProps {
  preview: VocabularyCsvPreview | null;
  saving: boolean;
  unsavedChanges: boolean;
  onClose: () => void;
  onApply: () => void;
}

const GLOBAL_SCOPE = { kind: "global" } as const;
const EMPTY_ENTRIES: VocabularyEntry[] = [];
const EMPTY_EMOJI_REPLACEMENTS: EmojiReplacement[] = [];

const normalizePair = (spoken: string, written: string): VocabularyEntry => ({
  spoken: spoken.trim(),
  written: written.trim(),
});

const usePairRowKeys = () => {
  const keysByEntryRef = useRef(new WeakMap<object, string>());
  const nextKeyRef = useRef(0);

  const getRowKey = useCallback((entry: VocabularyEntry | EmojiReplacement) => {
    const existingKey = keysByEntryRef.current.get(entry);
    if (existingKey) return existingKey;

    const nextKey = `pair-${nextKeyRef.current}`;
    nextKeyRef.current += 1;
    keysByEntryRef.current.set(entry, nextKey);
    return nextKey;
  }, []);

  const preserveRowKey = useCallback(
    (
      previous: VocabularyEntry | EmojiReplacement,
      next: VocabularyEntry | EmojiReplacement,
    ) => {
      keysByEntryRef.current.set(next, getRowKey(previous));
    },
    [getRowKey],
  );

  return { getRowKey, preserveRowKey };
};


const PairRows: React.FC<PairRowsProps> = ({
  entries,
  listLabel,
  spokenLabel,
  writtenLabel,
  onChange,
  onRemove,
  removeLabel,
  getRowKey,
  disabled,
}) => {
  if (entries.length === 0) return null;

  return (
    <ul className="space-y-2" aria-label={listLabel}>
      {entries.map((entry, index) => (
        <li
          key={getRowKey(entry)}
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          <Input
            value={entry.spoken}
            onChange={(event) => onChange(index, "spoken", event.target.value)}
            aria-label={spokenLabel}
            disabled={disabled}
          />
          <Input
            value={entry.written}
            onChange={(event) => onChange(index, "written", event.target.value)}
            aria-label={writtenLabel}
            disabled={disabled}
          />
          <Button
            variant="ghost"
            size="sm"
            className="px-2"
            onClick={() => onRemove(index)}
            aria-label={removeLabel(entry.spoken)}
            title={removeLabel(entry.spoken)}
            disabled={disabled}
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </Button>
        </li>
      ))}
    </ul>
  );
};

const VocabularyPairsEditor: React.FC<VocabularyPairsEditorProps> = ({
  entries,
  spoken,
  written,
  descriptionMode,
  grouped,
  fileInputRef,
  changed,
  saving,
  onSpokenChange,
  onWrittenChange,
  onAdd,
  onChange,
  onRemove,
  onSave,
  onImport,
  onExport,
  onFile,
  getRowKey,
}) => {
  const { t } = useTranslation();

  return (
    <SettingContainer
      title={t("settings.advanced.customWords.title")}
      description={t("settings.advanced.customWords.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="stacked"
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Input
            value={spoken}
            onChange={(event) => onSpokenChange(event.target.value)}
            placeholder={t("settings.advanced.customWords.spokenPlaceholder")}
            aria-label={t("settings.advanced.customWords.spoken")}
            disabled={saving}
          />
          <Input
            value={written}
            onChange={(event) => onWrittenChange(event.target.value)}
            placeholder={t("settings.advanced.customWords.writtenPlaceholder")}
            aria-label={t("settings.advanced.customWords.written")}
            disabled={saving}
          />
          <Button onClick={onAdd} disabled={saving} size="sm" className="gap-1">
            <Plus aria-hidden="true" className="h-4 w-4" />
            {t("settings.advanced.customWords.add")}
          </Button>
        </div>

        <PairRows
          entries={entries}
          listLabel={t("settings.advanced.customWords.title")}
          spokenLabel={t("settings.advanced.customWords.spoken")}
          writtenLabel={t("settings.advanced.customWords.written")}
          onChange={onChange}
          onRemove={onRemove}
          removeLabel={(entrySpoken) =>
            t("settings.advanced.customWords.remove", { spoken: entrySpoken })
          }
          disabled={saving}
          getRowKey={getRowKey}
        />

        <div className="flex items-center justify-between gap-2">
          <Button onClick={onSave} disabled={saving || !changed} size="sm">
            {t("settings.advanced.customWords.save")}
          </Button>
          <details className="vocabulary-actions-menu relative">
            <summary
              className="liquid-control control-surface inline-flex min-h-8 cursor-pointer list-none items-center justify-center border px-2 text-text-primary"
              aria-label={t("settings.advanced.customWords.actions")}
              title={t("settings.advanced.customWords.actions")}
            >
              <Ellipsis aria-hidden="true" className="h-4 w-4" />
            </summary>
            <div className="vocabulary-actions-popover" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={saving}
                onClick={(event) => {
                  onImport();
                  const menu = event.currentTarget.closest("details");
                  if (menu) menu.open = false;
                }}
              >
                {t("settings.advanced.customWords.import")}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={saving}
                onClick={(event) => {
                  onExport();
                  const menu = event.currentTarget.closest("details");
                  if (menu) menu.open = false;
                }}
              >
                {t("settings.advanced.customWords.export")}
              </button>
            </div>
          </details>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label={t("settings.advanced.customWords.import")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onFile(file);
            }}
          />
        </div>
      </div>
    </SettingContainer>
  );
};

const EmojiPairsEditor: React.FC<EmojiPairsEditorProps> = ({
  entries,
  spoken,
  written,
  descriptionMode,
  grouped,
  changed,
  saving,
  onSpokenChange,
  onWrittenChange,
  onAdd,
  onChange,
  onRemove,
  onSave,
  getRowKey,
}) => {
  const { t } = useTranslation();

  return (
    <SettingContainer
      title={t("settings.advanced.emoji.title")}
      description={t("settings.advanced.emoji.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="stacked"
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Input
            value={spoken}
            onChange={(event) => onSpokenChange(event.target.value)}
            placeholder={t("settings.advanced.emoji.spokenPlaceholder")}
            aria-label={t("settings.advanced.emoji.spoken")}
            disabled={saving}
          />
          <Input
            value={written}
            onChange={(event) => onWrittenChange(event.target.value)}
            placeholder={t("settings.advanced.emoji.writtenPlaceholder")}
            aria-label={t("settings.advanced.emoji.written")}
            disabled={saving}
          />
          <Button onClick={onAdd} disabled={saving} size="sm" className="gap-1">
            <Plus aria-hidden="true" className="h-4 w-4" />
            {t("settings.advanced.emoji.add")}
          </Button>
        </div>

        <PairRows
          entries={entries}
          listLabel={t("settings.advanced.emoji.title")}
          spokenLabel={t("settings.advanced.emoji.spoken")}
          writtenLabel={t("settings.advanced.emoji.written")}
          onChange={onChange}
          onRemove={onRemove}
          removeLabel={(entrySpoken) =>
            t("settings.advanced.emoji.remove", { spoken: entrySpoken })
          }
          getRowKey={getRowKey}
          disabled={saving}
        />

        <Button onClick={onSave} disabled={saving || !changed} size="sm">
          {t("settings.advanced.emoji.save")}
        </Button>
      </div>
    </SettingContainer>
  );
};

const ImportPreviewDialog: React.FC<ImportPreviewDialogProps> = ({
  preview,
  saving,
  unsavedChanges,
  onClose,
  onApply,
}) => {
  const { t } = useTranslation();

  return (
    <Dialog
      open={preview !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("settings.advanced.customWords.importPreview.title")}
      description={t("settings.advanced.customWords.importPreview.description")}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={onApply}
            disabled={saving || !preview?.can_apply}
          >
            {t("settings.advanced.customWords.importPreview.apply")}
          </Button>
        </>
      }
    >
      {preview && (
        <div className="space-y-3 text-sm">
          {unsavedChanges && (
            <p
              role="alert"
              className="rounded-md border border-border bg-surface px-3 py-2 text-text-primary"
            >
              {t("settings.advanced.customWords.importPreview.unsavedWarning")}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <dt className="text-text-secondary">
              {t("settings.advanced.customWords.importPreview.valid")}
            </dt>
            <dd>{preview.valid_rows}</dd>
            <dt className="text-text-secondary">
              {t("settings.advanced.customWords.importPreview.invalid")}
            </dt>
            <dd>{preview.invalid_rows}</dd>
            <dt className="text-text-secondary">
              {t("settings.advanced.customWords.importPreview.duplicates")}
            </dt>
            <dd>{preview.duplicate_rows}</dd>
            <dt className="text-text-secondary">
              {t("settings.advanced.customWords.importPreview.conflicts")}
            </dt>
            <dd>{preview.conflict_rows}</dd>
          </dl>
          {!preview.can_apply && (
            <p role="alert" className="text-sm text-danger">
              {t("settings.advanced.customWords.importPreview.blocked")}
            </p>
          )}
          {preview.entries.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-text-secondary">
              {preview.entries.map((entry) => (
                <li key={`${entry.spoken}\u0000${entry.written}`}>
                  {entry.spoken} → {entry.written}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
};

export const CustomWords: React.FC<CustomWordsProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { settings, refreshSettings } = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importCsvRef = useRef<string | null>(null);
  const savedEntries = settings?.custom_words ?? EMPTY_ENTRIES;
  const savedEmojiReplacements =
    settings?.emoji_replacements ?? EMPTY_EMOJI_REPLACEMENTS;
  const syncedEntriesRef = useRef(savedEntries);
  const syncedEmojiRef = useRef(savedEmojiReplacements);
  const [entries, setEntries] = useState<VocabularyEntry[]>(savedEntries);
  const [emojiReplacements, setEmojiReplacements] = useState<
    EmojiReplacement[]
  >(savedEmojiReplacements);
  const [spoken, setSpoken] = useState("");
  const [written, setWritten] = useState("");
  const [emojiSpoken, setEmojiSpoken] = useState("");
  const [emojiWritten, setEmojiWritten] = useState("");
  const [preview, setPreview] = useState<VocabularyCsvPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vocabularyRowKeys = usePairRowKeys();
  const emojiRowKeys = usePairRowKeys();


  useEffect(() => {
    const previousSaved = syncedEntriesRef.current;
    setEntries((current) =>
      resolveRefreshDraft(current, previousSaved, savedEntries),
    );
    syncedEntriesRef.current = savedEntries;
  }, [savedEntries]);
  useEffect(() => {
    const previousSaved = syncedEmojiRef.current;
    setEmojiReplacements((current) =>
      resolveRefreshDraft(current, previousSaved, savedEmojiReplacements),
    );
    syncedEmojiRef.current = savedEmojiReplacements;
  }, [savedEmojiReplacements]);

  const saveEntries = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await commands.updateVocabularyEntries(
        GLOBAL_SCOPE,
        entries,
      );
      if (result.status !== "ok") throw new Error(String(result.error));
      setEntries(result.data);
      await refreshSettings();
      toast.success(t("settings.advanced.customWords.saved"));
    } catch (saveError) {
      setError(String(saveError));
      toast.error(t("settings.advanced.customWords.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const saveEmojiReplacements = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await commands.updateEmojiReplacements(emojiReplacements);
      if (result.status !== "ok") throw new Error(String(result.error));
      setEmojiReplacements(result.data);
      await refreshSettings();
      toast.success(t("settings.advanced.emoji.saved"));
    } catch (saveError) {
      setError(String(saveError));
      toast.error(t("settings.advanced.emoji.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const addEntry = () => {
    const entry = normalizePair(spoken, written);
    if (!entry.spoken || !entry.written) {
      setError(t("settings.advanced.customWords.errors.incomplete"));
      return;
    }
    if (
      entries.some(
        (current) =>
          current.spoken === entry.spoken && current.written === entry.written,
      )
    ) {
      setError(t("settings.advanced.customWords.errors.duplicate"));
      return;
    }
    setEntries([...entries, entry]);
    setSpoken("");
    setWritten("");
    setError(null);
  };

  const addEmojiReplacement = () => {
    const replacement = normalizePair(emojiSpoken, emojiWritten);
    if (!replacement.spoken || !replacement.written) {
      setError(t("settings.advanced.emoji.errors.incomplete"));
      return;
    }
    if (
      emojiReplacements.some(
        (current) =>
          current.spoken === replacement.spoken &&
          current.written === replacement.written,
      )
    ) {
      setError(t("settings.advanced.emoji.errors.duplicate"));
      return;
    }
    setEmojiReplacements([...emojiReplacements, replacement]);
    setEmojiSpoken("");
    setEmojiWritten("");
    setError(null);
  };

  const previewImport = async (file: File) => {
    setSaving(true);
    setError(null);
    try {
      const csv = await file.text();
      const result = await commands.previewVocabularyCsv(GLOBAL_SCOPE, csv);
      if (result.status !== "ok") throw new Error(String(result.error));
      importCsvRef.current = csv;
      setPreview(result.data);
    } catch (previewError) {
      setError(String(previewError));
      toast.error(t("settings.advanced.customWords.importError"));
    } finally {
      setSaving(false);
    }
  };

  const closePreview = () => {
    importCsvRef.current = null;
    setPreview(null);
  };

  const applyImport = async () => {
    const csv = importCsvRef.current;
    if (!csv || !preview?.can_apply) return;
    setSaving(true);
    setError(null);
    try {
      const result = await commands.applyVocabularyCsv(GLOBAL_SCOPE, csv);
      if (result.status !== "ok") throw new Error(String(result.error));
      // The backend replaces the persisted list with the CSV rows. Local
      // unsaved drafts are not part of that result, so merge them back in
      // instead of silently discarding them.
      setEntries((current) => mergeAppliedCsv(current, result.data));
      await refreshSettings();
      closePreview();
      toast.success(t("settings.advanced.customWords.imported"));
    } catch (applyError) {
      setError(String(applyError));
      toast.error(t("settings.advanced.customWords.importError"));
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await commands.exportVocabularyCsv(GLOBAL_SCOPE);
      if (result.status !== "ok") throw new Error(String(result.error));
      const url = URL.createObjectURL(
        new Blob([result.data], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "sona-vocabulary.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(String(exportError));
      toast.error(t("settings.advanced.customWords.exportError"));
    } finally {
      setSaving(false);
    }
  };

  const toggleEmojiReplacements = async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const result = await commands.updateEmojiReplacementsEnabled(enabled);
      if (result.status !== "ok") throw new Error(String(result.error));
      await refreshSettings();
    } catch (toggleError) {
      setError(String(toggleError));
      toast.error(t("settings.advanced.emoji.toggleError"));
    } finally {
      setSaving(false);
    }
  };

  const vocabularyChanged = !samePairEntries(entries, savedEntries);
  const emojiChanged = !samePairEntries(emojiReplacements, savedEmojiReplacements);
  const emojiEnabled = settings?.emoji_replacements_enabled ?? false;

  return (
    <>
      <VocabularyPairsEditor
        entries={entries}
        spoken={spoken}
        written={written}
        descriptionMode={descriptionMode}
        grouped={grouped}
        fileInputRef={fileInputRef}
        changed={vocabularyChanged}
        saving={saving}
        onSpokenChange={setSpoken}
        onWrittenChange={setWritten}
        onAdd={addEntry}
        onChange={(index, field, value) =>
          setEntries((current) =>
            current.map((entry, row) => {
              if (row !== index) return entry;
              const next = { ...entry, [field]: value };
              vocabularyRowKeys.preserveRowKey(entry, next);
              return next;
            }),
          )
        }
        onRemove={(index) =>
          setEntries((current) => current.filter((_, row) => row !== index))
        }
        onSave={() => void saveEntries()}
        onImport={() => fileInputRef.current?.click()}
        onExport={() => void exportCsv()}
        onFile={(file) => void previewImport(file)}
        getRowKey={vocabularyRowKeys.getRowKey}
      />

      <ToggleSwitch
        grouped={grouped}
        checked={emojiEnabled}
        onChange={(enabled) => void toggleEmojiReplacements(enabled)}
        isUpdating={saving}
        label={t("settings.advanced.emoji.enabledLabel")}
        description={t("settings.advanced.emoji.enabledDescription")}
      />

      {emojiEnabled ? (
        <EmojiPairsEditor
          entries={emojiReplacements}
          spoken={emojiSpoken}
          written={emojiWritten}
          descriptionMode={descriptionMode}
          grouped={grouped}
          changed={emojiChanged}
          saving={saving}
          onSpokenChange={setEmojiSpoken}
          onWrittenChange={setEmojiWritten}
          onAdd={addEmojiReplacement}
          onChange={(index, field, value) =>
            setEmojiReplacements((current) =>
              current.map((entry, row) => {
                if (row !== index) return entry;
                const next = { ...entry, [field]: value };
                emojiRowKeys.preserveRowKey(entry, next);
                return next;
              }),
            )
          }
          onRemove={(index) =>
            setEmojiReplacements((current) =>
              current.filter((_, row) => row !== index),
            )
          }
          onSave={() => void saveEmojiReplacements()}
          getRowKey={emojiRowKeys.getRowKey}
        />
      ) : null}

      {error && (
        <p role="alert" className="px-4 text-sm text-danger">
          {error}
        </p>
      )}

      <ImportPreviewDialog
        preview={preview}
        saving={saving}
        unsavedChanges={vocabularyChanged}
        onClose={closePreview}
        onApply={() => void applyImport()}
      />
    </>
  );
};
