import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { useSettings } from "../../hooks/useSettings";
import {
  Alert,
  Button,
  Dialog,
  IconButton,
  Input,
  SettingContainer,
  ToggleSwitch,
} from "../ui";
import {
  ColumnHeader,
  EmptyHint,
  Hint,
  LoadingRows,
  RuleList,
} from "./vocabulary/PanelParts";
import { SnippetsPanel } from "./vocabulary/SnippetsPanel";
import { ReplacementsPanel } from "./vocabulary/ReplacementsPanel";
import { setSpokenEditsEnabled } from "../../lib/powerPackApi";
import "./vocabulary/vocabulary.css";

interface CustomWordsProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

interface PairEditorLabels {
  title: string;
  description: string;
  spoken: string;
  written: string;
  spokenPlaceholder: string;
  writtenPlaceholder: string;
  add: string;
  save: string;
  remove: (spoken: string) => string;
  emptyTitle: string;
  emptyDescription: string;
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
  /** Rules the backend would reject. Named under the list; they block Save. */
  blockers: readonly string[];
  descriptionMode: "inline" | "tooltip";
  grouped: boolean;
  testId: string;
  getRowKey: (entry: PairEntry) => string;
  onDraftSpokenChange: (value: string) => void;
  onDraftWrittenChange: (value: string) => void;
  onAdd: () => void;
  onEdit: (index: number, field: "spoken" | "written", value: string) => void;
  onRemove: (index: number) => void;
  onSave: () => void;
  /** Extra controls beside Save, such as the CSV group. */
  actions?: React.ReactNode;
  /** Where the rows in this list come from, and where the others live. */
  footnote?: React.ReactNode;
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

/* One grid template for the column header and every row, so cells line up.
 * The trailing column is a fixed width because it holds a 32px icon button. */
const PAIR_GRID =
  "grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem]";

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
 * new-pair row above it and one save for the whole list. Both the vocabulary
 * and the emoji replacements are this shape, and the backend takes the whole
 * list on every write, which is why Save is per list and not per row.
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
  descriptionMode,
  grouped,
  testId,
  getRowKey,
  onDraftSpokenChange,
  onDraftWrittenChange,
  onAdd,
  onEdit,
  onRemove,
  onSave,
  actions,
  footnote,
}) => {
  const { t } = useTranslation();
  const createRowRef = useRef<HTMLDivElement>(null);
  const draftHintId = useId();

  const focusDraft = () => {
    createRowRef.current?.getElementsByTagName("input")[0]?.focus();
  };

  return (
    <SettingContainer
      title={labels.title}
      description={labels.description}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="stacked"
    >
      <div className="space-y-3" data-testid={testId}>
        <div className={PAIR_GRID} ref={createRowRef}>
          <Input
            value={draftSpoken}
            onChange={(event) => onDraftSpokenChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canAdd) onAdd();
            }}
            placeholder={labels.spokenPlaceholder}
            aria-label={labels.spoken}
            aria-describedby={draftHint ? draftHintId : undefined}
            invalid={draftHint?.blocking ?? false}
            disabled={saving}
            data-testid={`${testId}-new-spoken`}
          />
          <Input
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
            size="sm"
            className="gap-1 justify-self-start sm:justify-self-end"
            onClick={onAdd}
            disabled={!canAdd}
            data-testid={`${testId}-add`}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {labels.add}
          </Button>
        </div>

        {draftHint && (
          <Hint
            id={draftHintId}
            tone={draftHint.blocking ? "danger" : "muted"}
            live={draftHint.blocking ? "polite" : "off"}
          >
            {draftHint.text}
          </Hint>
        )}

        {loading ? (
          <LoadingRows label={t("common.loading")} />
        ) : entries.length === 0 ? (
          <EmptyHint
            title={labels.emptyTitle}
            description={labels.emptyDescription}
            action={
              <Button size="sm" variant="secondary" onClick={focusDraft}>
                {labels.add}
              </Button>
            }
          />
        ) : (
          <>
            <ColumnHeader
              gridClassName={PAIR_GRID}
              start={labels.spoken}
              end={labels.written}
            />
            <RuleList label={labels.title}>
              {entries.map((entry, index) => (
                <li
                  key={getRowKey(entry)}
                  className={`${PAIR_GRID} py-2`}
                  data-testid={`${testId}-row`}
                >
                  <Input
                    variant="compact"
                    value={entry.spoken}
                    onChange={(event) =>
                      onEdit(index, "spoken", event.target.value)
                    }
                    aria-label={labels.spoken}
                    invalid={entry.spoken.trim() === ""}
                    disabled={saving}
                  />
                  <Input
                    variant="compact"
                    value={entry.written}
                    onChange={(event) =>
                      onEdit(index, "written", event.target.value)
                    }
                    aria-label={labels.written}
                    invalid={entry.written.trim() === ""}
                    disabled={saving}
                  />
                  <IconButton
                    size="sm"
                    variant="danger-ghost"
                    className="justify-self-end"
                    onClick={() => onRemove(index)}
                    label={labels.remove(entry.spoken)}
                    icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                    disabled={saving}
                  />
                </li>
              ))}
            </RuleList>
          </>
        )}

        {blockers.map((blocker) => (
          <Hint key={blocker} tone="danger" live="polite">
            {blocker}
          </Hint>
        ))}

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            size="sm"
            onClick={onSave}
            disabled={saving || !changed || blockers.length > 0}
            data-testid={`${testId}-save`}
          >
            {labels.save}
          </Button>
          {changed && blockers.length === 0 && (
            <Hint>
              {t("settings.advanced.customWords.unsaved", "Unsaved changes")}
            </Hint>
          )}
        </div>

        {actions}

        {footnote}
      </div>
    </SettingContainer>
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

  const counts: { label: string; value: number }[] = preview
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
      ]
    : [];

  return (
    <Dialog
      open={review !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("settings.advanced.customWords.importPreview.title")}
      description={t("settings.advanced.customWords.importPreview.description")}
      closeLabel={t("common.close")}
      footer={
        reviewing ? (
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
              variant="secondary"
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
        )
      }
    >
      {preview && (
        <div className="space-y-3">
          <Hint>
            {reviewing
              ? t("settings.advanced.customWords.importPreview.stepReview", {
                  defaultValue: "Step 1 of 2: what the file contains",
                })
              : t("settings.advanced.customWords.importPreview.stepConfirm", {
                  defaultValue: "Step 2 of 2: confirm the replacement",
                })}
          </Hint>

          {unsavedChanges && (
            <Alert variant="warning">
              {t("settings.advanced.customWords.importPreview.unsavedWarning")}
            </Alert>
          )}

          {reviewing ? (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] leading-[18px]">
                {counts.map((count) => (
                  <React.Fragment key={count.label}>
                    <dt className="text-text-secondary">{count.label}</dt>
                    <dd className="numeric text-text-primary">{count.value}</dd>
                  </React.Fragment>
                ))}
              </dl>

              {!preview.can_apply && (
                <Alert variant="error">
                  {t("settings.advanced.customWords.importPreview.blocked")}
                </Alert>
              )}

              {preview.entries.length > 0 && (
                <div className="max-h-56 overflow-y-auto">
                  <table className="data-table import-preview-table">
                    <thead>
                      <tr>
                        <th scope="col">
                          {t("settings.advanced.customWords.spoken")}
                        </th>
                        <th scope="col">
                          {t("settings.advanced.customWords.written")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.entries.map((entry) => (
                        <tr key={`${entry.spoken}\u0000${entry.written}`}>
                          <td className="truncate">{entry.spoken}</td>
                          <td className="truncate text-text-secondary">
                            {entry.written}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <p className="text-[13px] leading-5 text-text-primary">
              {t("settings.advanced.customWords.importPreview.replaceSummary", {
                defaultValue:
                  "Applying replaces the {{savedCount}} saved pairs with the {{importedCount}} pairs from this file.",
                savedCount,
                importedCount: preview.entries.length,
              })}
            </p>
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
  const { settings, isLoading, refreshSettings } = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      <PairEditor
        labels={{
          title: t("settings.advanced.customWords.title"),
          description: t("settings.advanced.customWords.description"),
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
            t("settings.advanced.customWords.remove", { spoken: entrySpoken }),
          emptyTitle: t(
            "settings.advanced.customWords.empty.title",
            "No vocabulary rules yet",
          ),
          emptyDescription: t(
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
        descriptionMode={descriptionMode}
        grouped={grouped}
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
        actions={
          <div
            role="group"
            aria-label={t("settings.advanced.customWords.actions")}
            className="vocabulary-csv-bar"
          >
            <span className="microlabel">
              {t("settings.advanced.customWords.csvLabel", "CSV")}
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                className="gap-1"
                onClick={() => fileInputRef.current?.click()}
                disabled={saving}
              >
                <Upload aria-hidden="true" className="h-4 w-4" />
                {t("settings.advanced.customWords.import")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="gap-1"
                onClick={() => void exportCsv()}
                disabled={saving || savedEntries.length === 0}
              >
                <Download aria-hidden="true" className="h-4 w-4" />
                {t("settings.advanced.customWords.export")}
              </Button>
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label={t("settings.advanced.customWords.import")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void previewImport(file);
              }}
            />
          </div>
        }
        footnote={
          <Hint>
            {t(
              "settings.advanced.customWords.sources",
              "Corrections you save from a transcript in Library land in this list. Rules for a single mode live in that mode's own vocabulary.",
            )}
          </Hint>
        }
      />

      {failure && (
        <Alert
          variant="error"
          contained
          action={
            <Button
              size="sm"
              variant="secondary"
              disabled={saving}
              onClick={failure.retry}
            >
              {t("common.retry")}
            </Button>
          }
        >
          {failure.message}
        </Alert>
      )}

      <SnippetsPanel descriptionMode={descriptionMode} grouped={grouped} />

      <ReplacementsPanel descriptionMode={descriptionMode} grouped={grouped} />

      <ToggleSwitch
        grouped={grouped}
        descriptionMode={descriptionMode}
        checked={spokenEditsEnabled}
        onChange={(enabled) => void toggleSpokenEdits(enabled)}
        isUpdating={saving}
        label={t("settings.advanced.spokenEdits.enabledLabel")}
        description={t("settings.advanced.spokenEdits.enabledDescription")}
      />

      <ToggleSwitch
        grouped={grouped}
        descriptionMode={descriptionMode}
        checked={emojiEnabled}
        onChange={(enabled) => void toggleEmojiReplacements(enabled)}
        isUpdating={saving}
        label={t("settings.advanced.emoji.enabledLabel")}
        description={t("settings.advanced.emoji.enabledDescription")}
      />

      {emojiEnabled ? (
        <PairEditor
          labels={{
            title: t("settings.advanced.emoji.title"),
            description: t("settings.advanced.emoji.description"),
            spoken: t("settings.advanced.emoji.spoken"),
            written: t("settings.advanced.emoji.written"),
            spokenPlaceholder: t("settings.advanced.emoji.spokenPlaceholder"),
            writtenPlaceholder: t("settings.advanced.emoji.writtenPlaceholder"),
            add: t("settings.advanced.emoji.add"),
            save: t("settings.advanced.emoji.save"),
            remove: (entrySpoken) =>
              t("settings.advanced.emoji.remove", { spoken: entrySpoken }),
            emptyTitle: t(
              "settings.advanced.emoji.empty.title",
              "No emoji replacements yet",
            ),
            emptyDescription: t(
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
          descriptionMode={descriptionMode}
          grouped={grouped}
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
      ) : (
        <div className="py-2">
          <Hint>{t("settings.advanced.emoji.offState")}</Hint>
        </div>
      )}

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
