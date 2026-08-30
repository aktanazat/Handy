import { useEffect, useRef, useState } from "react";
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
  type VocabularyEntry,
} from "@/bindings";
import { useSettings } from "../../../hooks/useSettings";
import { setSpokenEditsEnabled } from "../../../lib/powerPackApi";
import type { ImportReview } from "./ImportPreviewDialog";
import { usePairRowKeys } from "./usePairRowKeys";
import {
  emojiBlockers,
  emojiDraftState,
  vocabularyBlockers,
  vocabularyDraftState,
} from "./validation";

const GLOBAL_SCOPE = { kind: "global" } as const;
const EMPTY_ENTRIES: VocabularyEntry[] = [];
const EMPTY_EMOJI_REPLACEMENTS: EmojiReplacement[] = [];

/**
 * Everything the custom-words surface remembers: the two draft lists, the CSV
 * import in progress, and the one write at a time the backend allows. Both
 * lists share `saving` and `failure` because a failed write is reported once,
 * beside the list that asked for it.
 */
export const useCustomWordsEditor = () => {
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

  const editEntry = (
    index: number,
    field: "spoken" | "written",
    value: string,
  ) =>
    setEntries((current) =>
      current.map((entry, row) => {
        if (row !== index) return entry;
        const next = { ...entry, [field]: value };
        vocabularyRowKeys.preserveRowKey(entry, next);
        return next;
      }),
    );

  const removeEntry = (index: number) =>
    setEntries((current) => current.filter((_, row) => row !== index));

  const editEmojiReplacement = (
    index: number,
    field: "spoken" | "written",
    value: string,
  ) =>
    setEmojiReplacements((current) =>
      current.map((entry, row) => {
        if (row !== index) return entry;
        const next = { ...entry, [field]: value };
        emojiRowKeys.preserveRowKey(entry, next);
        return next;
      }),
    );

  const removeEmojiReplacement = (index: number) =>
    setEmojiReplacements((current) =>
      current.filter((_, row) => row !== index),
    );

  const addEntry = () => {
    setEntries([
      ...entries,
      { spoken: spoken.trim(), written: written.trim() },
    ]);
    setSpoken("");
    setWritten("");
  };

  const addEmojiReplacement = () => {
    setEmojiReplacements([
      ...emojiReplacements,
      { spoken: emojiSpoken.trim(), written: emojiWritten.trim() },
    ]);
    setEmojiSpoken("");
    setEmojiWritten("");
  };

  const vocabularyChanged = !samePairEntries(entries, savedEntries);
  const emojiChanged = !samePairEntries(
    emojiReplacements,
    savedEmojiReplacements,
  );
  const vocabularyDraft = vocabularyDraftState(spoken, written, entries, t);
  const emojiDraft = emojiDraftState(
    emojiSpoken,
    emojiWritten,
    emojiReplacements,
    t,
  );

  return {
    entries,
    emojiReplacements,
    savedCount: savedEntries.length,
    spoken,
    written,
    emojiSpoken,
    emojiWritten,
    setSpoken,
    setWritten,
    setEmojiSpoken,
    setEmojiWritten,
    loading: isLoading,
    saving,
    failure,
    review,
    vocabularyChanged,
    emojiChanged,
    vocabularyDraft,
    emojiDraft,
    vocabularyBlockers: vocabularyBlockers(entries, t),
    emojiBlockers: emojiBlockers(emojiReplacements, t),
    emojiEnabled: settings?.emoji_replacements_enabled ?? false,
    spokenEditsEnabled: settings?.spoken_edits_enabled ?? false,
    fileInputRef,
    getVocabularyRowKey: vocabularyRowKeys.getRowKey,
    getEmojiRowKey: emojiRowKeys.getRowKey,
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
    setReviewStep: (step: "review" | "confirm") =>
      setReview((current) => (current ? { ...current, step } : current)),
    closeReview: () => setReview(null),
  };
};
