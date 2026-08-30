import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commands } from "@/bindings";
import type { CorrectionScope } from "./HistoryCorrectionDialog";

/* The correction the row is writing: the spoken/written pair, the scope it
 * applies at, and the one command that saves it. It sits beside the row rather
 * than inside the dialog because the row's menu is what opens it, and a saved
 * rule clears the fields so the next correction starts empty. */
export const useHistoryCorrection = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [spoken, setSpoken] = useState("");
  const [written, setWritten] = useState("");
  const [scope, setScope] = useState<CorrectionScope>("current_mode");
  const [saving, setSaving] = useState(false);

  const ready = spoken.trim() !== "" && written.trim() !== "";

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      const result = await commands.addVocabularyCorrection(spoken, written, {
        kind: scope,
      });
      if (result.status !== "ok") throw new Error(String(result.error));
      setOpen(false);
      setSpoken("");
      setWritten("");
      toast.success(t("settings.history.correction.saved"));
    } catch (correctionError) {
      console.error("Failed to save vocabulary correction:", correctionError);
      toast.error(t("settings.history.correction.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return {
    open,
    setOpen,
    spoken,
    setSpoken,
    written,
    setWritten,
    scope,
    setScope,
    saving,
    ready,
    save,
  };
};
