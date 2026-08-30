import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import {
  duplicateSpokenPhrases,
  mergeAppliedCsv,
  resolveRefreshDraft,
  samePairEntries,
  spokenMatchKey,
  type PairEntry,
} from "@/lib/vocabularyDraft";
import {
  commands,
  type EmojiReplacement,
  type VocabularyCsvPreview,
  type VocabularyEntry,
} from "@/bindings";
import { Button } from "@/components/vg/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/vg/dialog";
import { Input } from "@/components/vg/input";
import { Switch } from "@/components/vg/switch";
import {
  FactChip,
  Notice,
  SettingsCard,
  SettingsField,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/rows";
import { useSettings } from "../../hooks/useSettings";
import {
  ColumnHeader,
  EmptyLine,
  Hint,
  literalText,
  LoadingRows,
  RowActions,
  RuleList,
  RuleRow,
} from "./vocabulary/PanelParts";
import { SnippetsPanel } from "./vocabulary/SnippetsPanel";
import { ReplacementsPanel } from "./vocabulary/ReplacementsPanel";
import { setSpokenEditsEnabled } from "../../lib/powerPackApi";

interface PairEditorLabels {
  /** Names the list for assistive tech; the section above prints it. */
  title: string;
  spoken: string;
  written: string;
  spokenPlaceholder: string;
  writtenPlaceholder: string;
  add: string;
  save: string;
  remove: (spoken: string) => string;
  /** One line, shown instead of the list. Never a second name for the list. */
  empty: string;
}

interface PairEditorProps {
  labels: PairEditorLabels;
  entries: readonly PairEntry[];
  draftSpoken: string;
  draftWritten: string;
  /** Draft-row problem: sits under the new-pair fields and blocks Add. */
  draftHint: { text: string; blocking: boolean } | null;
  canAdd: boolean;
  changed: boolean;
  saving: boolean;
  loading: boolean;
  /** Rules the backend would reject. Named beside Save; they block it. */
  blockers: readonly string[];
  testId: string;
  getRowKey: (entry: PairEntry) => string;
  onDraftSpokenChange: (value: string) => void;
  onDraftWrittenChange: (value: string) => void;
  onAdd: () => void;
  onEdit: (index: number, field: "spoken" | "written", value: string) => void;
  onRemove: (index: number) => void;
  onSave: () => void;
  /** Where the rows in this list come from, and where the others live. */
  footnote?: string;
}

interface ImportReview {
  csv: string;
  preview: VocabularyCsvPreview;
  step: "review" | "confirm";
}

interface ImportPreviewDialogProps {
  review: ImportReview | null;
  savedCount: number;
  saving: boolean;
  unsavedChanges: boolean;
  onStep: (step: "review" | "confirm") => void;
  onClose: () => void;
  onApply: () => void;
}

const GLOBAL_SCOPE = { kind: "global" } as const;
const EMPTY_ENTRIES: VocabularyEntry[] = [];
const EMPTY_EMOJI_REPLACEMENTS: EmojiReplacement[] = [];

/* One grid template for the column names and every row, so cells line up.
 * The trailing column is a fixed width because it holds an icon button. */
/* The action column is a fixed 35px (2.5rem at this app's 14px root, written
 * as the px it renders): one 28px icon button plus breathing room. */
const PAIR_GRID =
  "grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_35px]";

const usePairRowKeys = () => {
  const keysByEntryRef = useRef(new WeakMap<object, string>());
  const nextKeyRef = useRef(0);

  const getRowKey = useCallback((entry: PairEntry) => {
    const existingKey = keysByEntryRef.current.get(entry);
    if (existingKey) return existingKey;

    const nextKey = `pair-${nextKeyRef.current}`;
    nextKeyRef.current += 1;
    keysByEntryRef.current.set(entry, nextKey);
    return nextKey;
  }, []);

  const preserveRowKey = useCallback(
    (previous: PairEntry, next: PairEntry) => {
      keysByEntryRef.current.set(next, getRowKey(previous));
    },
    [getRowKey],
  );

  return { getRowKey, preserveRowKey };
};

/**
 * A spoken/written rule list: one row per rule, edited in place, with a
 * new-pair field above it and one save for the whole list. Both the vocabulary
 * and the emoji replacements are this shape, and the backend takes the whole
 * list on every write, which is why Save is per list and not per row.
 *
 * The caller owns the section around this: it is the body of one, never its
 * own box.
 */
const PairEditor: React.FC<PairEditorProps> = ({
  labels,
  entries,
  draftSpoken,
  draftWritten,
  draftHint,
  canAdd,
  changed,
  saving,
  loading,
  blockers,
  testId,
  getRowKey,
  onDraftSpokenChange,
  onDraftWrittenChange,
  onAdd,
  onEdit,
  onRemove,
  onSave,
  footnote,
}) => {
  const createRowRef = useRef<HTMLDivElement>(null);
  const draftHintId = useId();
  const { t } = useTranslation();

  return (
    <div className="divide-y divide-gray-alpha-400" data-testid={testId}>
      <SettingsField label={labels.add}>
        <div className={PAIR_GRID} ref={createRowRef}>
          <Input
            className={literalText}
            value={draftSpoken}
            onChange={(event) => onDraftSpokenChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canAdd) onAdd();
            }}
            placeholder={labels.spokenPlaceholder}
            aria-label={labels.spoken}
            aria-describedby={draftHint ? draftHintId : undefined}
            aria-invalid={draftHint?.blocking ?? false}
            disabled={saving}
            data-testid={`${testId}-new-spoken`}
          />
          <Input
            className={literalText}
            value={draftWritten}
            onChange={(event) => onDraftWrittenChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canAdd) onAdd();
            }}
            placeholder={labels.writtenPlaceholder}
            aria-label={labels.written}
            aria-describedby={draftHint ? draftHintId : undefined}
            disabled={saving}
            data-testid={`${testId}-new-written`}
          />
          <Button
            size="icon-sm"
            variant="outline"
            className="justify-self-start sm:justify-self-end"
            onClick={onAdd}
            disabled={!canAdd}
            aria-label={labels.add}
            data-testid={`${testId}-add`}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
        {draftHint && (
          <Hint
            id={draftHintId}
            tone={draftHint.blocking ? "danger" : "muted"}
            live={draftHint.blocking ? "polite" : "off"}
            className="mt-2"
          >
            {draftHint.text}
          </Hint>
        )}
      </SettingsField>

      {loading ? (
        <LoadingRows label={t("common.loading")} />
      ) : entries.length === 0 ? (
        <EmptyLine text={labels.empty} />
      ) : (
        <div>
          <ColumnHeader
            gridClassName={PAIR_GRID}
            start={labels.spoken}
            end={labels.written}
          />
          <RuleList label={labels.title}>
            {entries.map((entry, index) => (
              <RuleRow key={getRowKey(entry)} data-testid={`${testId}-row`}>
                <div className={PAIR_GRID}>
                  <Input
                    className={cn(literalText, "h-8")}
                    value={entry.spoken}
                    onChange={(event) =>
                      onEdit(index, "spoken", event.target.value)
                    }
                    aria-label={labels.spoken}
                    aria-invalid={entry.spoken.trim() === ""}
                    disabled={saving}
                  />
                  <Input
                    className={cn(literalText, "h-8")}
                    value={entry.written}
                    onChange={(event) =>
                      onEdit(index, "written", event.target.value)
                    }
                    aria-label={labels.written}
                    aria-invalid={entry.written.trim() === ""}
                    disabled={saving}
                  />
                  <RowActions className="justify-self-end">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-gray-700 hover:text-red-900"
                      onClick={() => onRemove(index)}
                      aria-label={labels.remove(entry.spoken)}
                      disabled={saving}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </RowActions>
                </div>
              </RuleRow>
            ))}
          </RuleList>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
        {blockers.length > 0 && (
          <div className="mr-auto flex flex-col gap-1">
            {blockers.map((blocker) => (
              <Notice key={blocker} tone="danger">
                {blocker}
              </Notice>
            ))}
          </div>
        )}
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving || !changed || blockers.length > 0}
          data-testid={`${testId}-save`}
        >
          {labels.save}
        </Button>
      </div>

      {footnote && (
        <Notice live={false} className="px-4 py-3">
          {footnote}
        </Notice>
      )}
    </div>
  );
};

/**
 * Two steps, because a CSV import replaces the saved list: read what the file
 * contains, then confirm the replacement. Nothing is written until the last
 * button.
 */
const ImportPreviewDialog: React.FC<ImportPreviewDialogProps> = ({
  review,
  savedCount,
  saving,
  unsavedChanges,
  onStep,
  onClose,
  onApply,
}) => {
  const { t } = useTranslation();
  const preview = review?.preview ?? null;
  const reviewing = review?.step !== "confirm";

  /* Only the count that always means something, plus the ones that are a
   * reason to stop. A row of zeroes is noise the table below already denies. */
  const counts = preview
    ? [
        {
          label: t("settings.advanced.customWords.importPreview.valid"),
          value: preview.valid_rows,
        },
        {
          label: t("settings.advanced.customWords.importPreview.invalid"),
          value: preview.invalid_rows,
        },
        {
          label: t("settings.advanced.customWords.importPreview.duplicates"),
          value: preview.duplicate_rows,
        },
        {
          label: t("settings.advanced.customWords.importPreview.conflicts"),
          value: preview.conflict_rows,
        },
      ].filter((count, index) => index === 0 || count.value > 0)
    : [];

  return (
    <Dialog
      open={review !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("settings.advanced.customWords.importPreview.title")}
          </DialogTitle>
          <DialogDescription>
            {t("settings.advanced.customWords.importPreview.description")}
          </DialogDescription>
        </DialogHeader>

        {preview && (
          <div className="flex flex-col gap-3">
            {unsavedChanges && (
              <Notice tone="warning">
                {t(
                  "settings.advanced.customWords.importPreview.unsavedWarning",
                )}
              </Notice>
            )}

            {reviewing ? (
              <>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                  {counts.map((count) => (
                    <FactChip
                      key={count.label}
                      label={count.label}
                      value={count.value}
                    />
                  ))}
                </div>

                {!preview.can_apply && (
                  <Notice tone="danger">
                    {t("settings.advanced.customWords.importPreview.blocked")}
                  </Notice>
                )}

                {preview.entries.length > 0 && (
                  <div className="max-h-56 overflow-y-auto rounded-card border border-gray-alpha-400">
                    <ColumnHeader
                      gridClassName="grid grid-cols-2 gap-2"
                      start={t("settings.advanced.customWords.spoken")}
                      end={t("settings.advanced.customWords.written")}
                    />
                    <ul
                      role="list"
                      className="divide-y divide-gray-alpha-400 font-mono text-[12.5px]"
                    >
                      {preview.entries.map((entry) => (
                        <li
                          key={`${entry.spoken}\u0000${entry.written}`}
                          className="grid grid-cols-2 gap-2 px-4 py-1.5"
                        >
                          <span className="truncate text-gray-1000">
                            {entry.spoken}
                          </span>
                          <span className="truncate text-gray-700">
                            {entry.written}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[13px] leading-[19px] text-pretty text-gray-900">
                {t(
                  "settings.advanced.customWords.importPreview.replaceSummary",
                  {
                    defaultValue:
                      "Applying replaces the {{savedCount}} saved pairs with the {{importedCount}} pairs from this file.",
                    savedCount,
                    importedCount: preview.entries.length,
                  },
                )}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {reviewing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={saving}
              >
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={() => onStep("confirm")}
                disabled={saving || !preview?.can_apply}
                data-testid="vocabulary-import-continue"
              >
                {t(
                  "settings.advanced.customWords.importPreview.continue",
                  "Continue",
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onStep("review")}
                disabled={saving}
              >
                {t("settings.advanced.customWords.importPreview.back", "Back")}
              </Button>
              <Button
                size="sm"
                onClick={onApply}
                disabled={saving || !preview?.can_apply}
                data-testid="vocabulary-import-apply"
              >
                {t("settings.advanced.customWords.importPreview.apply")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const CustomWords: React.FC = () => {
  const { t } = useTranslation();
  const { settings, isLoading, refreshSettings } = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const spokenEditsId = useId();
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
  const [review, setReview] = useState<ImportReview | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{
    message: string;
    retry: () => void;
  } | null>(null);
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
    setFailure(null);
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
      setFailure({
        message: String(saveError),
        retry: () => void saveEntries(),
      });
      toast.error(t("settings.advanced.customWords.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const saveEmojiReplacements = async () => {
    setSaving(true);
    setFailure(null);
    try {
      const result = await commands.updateEmojiReplacements(emojiReplacements);
      if (result.status !== "ok") throw new Error(String(result.error));
      setEmojiReplacements(result.data);
      await refreshSettings();
      toast.success(t("settings.advanced.emoji.saved"));
    } catch (saveError) {
      setFailure({
        message: String(saveError),
        retry: () => void saveEmojiReplacements(),
      });
      toast.error(t("settings.advanced.emoji.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const previewImport = async (file: File) => {
    setSaving(true);
    setFailure(null);
    try {
      const csv = await file.text();
      const result = await commands.previewVocabularyCsv(GLOBAL_SCOPE, csv);
      if (result.status !== "ok") throw new Error(String(result.error));
      setReview({ csv, preview: result.data, step: "review" });
    } catch (previewError) {
      setFailure({
        message: String(previewError),
        retry: () => fileInputRef.current?.click(),
      });
      toast.error(t("settings.advanced.customWords.importError"));
    } finally {
      setSaving(false);
    }
  };

  const applyImport = async () => {
    if (!review?.preview.can_apply) return;
    const csv = review.csv;
    setSaving(true);
    setFailure(null);
    try {
      const result = await commands.applyVocabularyCsv(GLOBAL_SCOPE, csv);
      if (result.status !== "ok") throw new Error(String(result.error));
      // The backend replaces the persisted list with the CSV rows. Local
      // unsaved drafts are not part of that result, so merge them back in
      // instead of silently discarding them.
      setEntries((current) => mergeAppliedCsv(current, result.data));
      await refreshSettings();
      setReview(null);
      toast.success(t("settings.advanced.customWords.imported"));
    } catch (applyError) {
      setFailure({
        message: String(applyError),
        retry: () => void applyImport(),
      });
      toast.error(t("settings.advanced.customWords.importError"));
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = async () => {
    setSaving(true);
    setFailure(null);
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
      setFailure({
        message: String(exportError),
        retry: () => void exportCsv(),
      });
      toast.error(t("settings.advanced.customWords.exportError"));
    } finally {
      setSaving(false);
    }
  };

  const toggleEmojiReplacements = async (enabled: boolean) => {
    setSaving(true);
    setFailure(null);
    try {
      const result = await commands.updateEmojiReplacementsEnabled(enabled);
      if (result.status !== "ok") throw new Error(String(result.error));
      await refreshSettings();
    } catch (toggleError) {
      setFailure({
        message: String(toggleError),
        retry: () => void toggleEmojiReplacements(enabled),
      });
      toast.error(t("settings.advanced.emoji.toggleError"));
    } finally {
      setSaving(false);
    }
  };

  const toggleSpokenEdits = async (enabled: boolean) => {
    setSaving(true);
    setFailure(null);
    try {
      await setSpokenEditsEnabled(enabled);
      await refreshSettings();
    } catch (toggleError) {
      setFailure({
        message: String(toggleError),
        retry: () => void toggleSpokenEdits(enabled),
      });
      toast.error(t("settings.advanced.spokenEdits.toggleError"));
    } finally {
      setSaving(false);
    }
  };

  const vocabularyChanged = !samePairEntries(entries, savedEntries);
  const emojiChanged = !samePairEntries(
    emojiReplacements,
    savedEmojiReplacements,
  );
  const emojiEnabled = settings?.emoji_replacements_enabled ?? false;
  const spokenEditsEnabled = settings?.spoken_edits_enabled ?? false;
  const vocabularyTitle = t("settings.advanced.customWords.title");
  const emojiTitle = t("settings.advanced.emoji.title");
  const importLabel = t("settings.advanced.customWords.import");

  /* The backend normalizes and validates the whole list on save. Naming the
   * same rules here means a rejected write becomes a hint on the row instead
   * of an error toast about the list. */
  const vocabularyBlockers: string[] = [];
  if (entries.some((entry) => !entry.spoken.trim() || !entry.written.trim())) {
    vocabularyBlockers.push(
      t(
        "settings.advanced.customWords.errors.incompleteRow",
        "Complete or remove every row before saving.",
      ),
    );
  }
  const conflictingSpoken = duplicateSpokenPhrases(entries);
  if (conflictingSpoken.length > 0) {
    vocabularyBlockers.push(
      t("settings.advanced.customWords.errors.duplicateSpoken", {
        defaultValue:
          "More than one row matches {{spoken}}. Sona keeps one rule per spoken phrase.",
        spoken: conflictingSpoken.join(", "),
      }),
    );
  }
  const unusableSpoken = entries
    .filter(
      (entry) =>
        entry.spoken.trim() !== "" && spokenMatchKey(entry.spoken) === "",
    )
    .map((entry) => entry.spoken);
  if (unusableSpoken.length > 0) {
    vocabularyBlockers.push(
      t("settings.advanced.customWords.errors.unusableSpoken", {
        defaultValue:
          "{{spoken}} needs at least one letter or number to be recognized.",
        spoken: unusableSpoken.join(", "),
      }),
    );
  }

  const emojiBlockers: string[] = emojiReplacements.some(
    (entry) => !entry.spoken.trim() || !entry.written.trim(),
  )
    ? [
        t(
          "settings.advanced.emoji.errors.incompleteRow",
          "Complete or remove every row before saving.",
        ),
      ]
    : [];

  const draftSpoken = spoken.trim();
  const draftWritten = written.trim();
  const draftStarted = spoken !== "" || written !== "";
  const draftIncomplete = draftSpoken === "" || draftWritten === "";
  const draftPairExists =
    !draftIncomplete &&
    entries.some(
      (entry) => entry.spoken === draftSpoken && entry.written === draftWritten,
    );
  const draftSpokenTaken =
    spokenMatchKey(draftSpoken) !== "" &&
    entries.some(
      (entry) => spokenMatchKey(entry.spoken) === spokenMatchKey(draftSpoken),
    );
  /* Anything the backend would refuse. Named on the field, so Add is never
   * disabled without saying why. */
  const draftBlocker = draftPairExists
    ? t("settings.advanced.customWords.errors.duplicate")
    : draftSpokenTaken
      ? t("settings.advanced.customWords.errors.duplicateSpoken", {
          defaultValue:
            "More than one row matches {{spoken}}. Sona keeps one rule per spoken phrase.",
          spoken: draftSpoken,
        })
      : !draftIncomplete && spokenMatchKey(draftSpoken) === ""
        ? t("settings.advanced.customWords.errors.unusableSpoken", {
            defaultValue:
              "{{spoken}} needs at least one letter or number to be recognized.",
            spoken: draftSpoken,
          })
        : null;
  const vocabularyDraftHint =
    draftBlocker !== null
      ? { text: draftBlocker, blocking: true }
      : draftIncomplete && draftStarted
        ? {
            text: t("settings.advanced.customWords.errors.incomplete"),
            blocking: false,
          }
        : null;

  const emojiDraftSpoken = emojiSpoken.trim();
  const emojiDraftWritten = emojiWritten.trim();
  const emojiDraftStarted = emojiSpoken !== "" || emojiWritten !== "";
  const emojiDraftIncomplete =
    emojiDraftSpoken === "" || emojiDraftWritten === "";
  const emojiDraftExists = emojiReplacements.some(
    (entry) =>
      entry.spoken === emojiDraftSpoken && entry.written === emojiDraftWritten,
  );
  const emojiDraftHint = emojiDraftIncomplete
    ? emojiDraftStarted
      ? {
          text: t("settings.advanced.emoji.errors.incomplete"),
          blocking: false,
        }
      : null
    : emojiDraftExists
      ? { text: t("settings.advanced.emoji.errors.duplicate"), blocking: true }
      : null;

  const addEntry = () => {
    setEntries([...entries, { spoken: draftSpoken, written: draftWritten }]);
    setSpoken("");
    setWritten("");
  };

  const addEmojiReplacement = () => {
    setEmojiReplacements([
      ...emojiReplacements,
      { spoken: emojiDraftSpoken, written: emojiDraftWritten },
    ]);
    setEmojiSpoken("");
    setEmojiWritten("");
  };

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
              disabled={saving || savedEntries.length === 0}
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
          draftHint={vocabularyDraftHint}
          canAdd={!saving && !draftIncomplete && draftBlocker === null}
          changed={vocabularyChanged}
          saving={saving}
          loading={isLoading}
          blockers={vocabularyBlockers}
          testId="vocabulary-editor"
          getRowKey={vocabularyRowKeys.getRowKey}
          onDraftSpokenChange={setSpoken}
          onDraftWrittenChange={setWritten}
          onAdd={addEntry}
          onEdit={(index, field, value) =>
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
            draftHint={emojiDraftHint}
            canAdd={!saving && !emojiDraftIncomplete && !emojiDraftExists}
            changed={emojiChanged}
            saving={saving}
            loading={isLoading}
            blockers={emojiBlockers}
            testId="emoji-editor"
            getRowKey={emojiRowKeys.getRowKey}
            onDraftSpokenChange={setEmojiSpoken}
            onDraftWrittenChange={setEmojiWritten}
            onAdd={addEmojiReplacement}
            onEdit={(index, field, value) =>
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
          />
        )}
        <Notice live={false} className="px-4 py-3">
          {t("settings.advanced.emoji.enabledDescription")}
        </Notice>
      </SettingsSection>

      <ImportPreviewDialog
        review={review}
        savedCount={savedEntries.length}
        saving={saving}
        unsavedChanges={vocabularyChanged}
        onStep={(step) =>
          setReview((current) => (current ? { ...current, step } : current))
        }
        onClose={() => setReview(null)}
        onApply={() => void applyImport()}
      />
    </>
  );
};
