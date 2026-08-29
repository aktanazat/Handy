import React, { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commands } from "@/bindings";
import { Alert, Button, Dialog, Dropdown } from "../../ui";
import { reprocessHistoryEntry } from "../../../lib/powerPackApi";

interface ProcessAgainDialogProps {
  historyId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Runs a stored recording through a different mode.
 *
 * Owns its own mode list so the history list does not thread a callback
 * through three components for one row action, but not its own trigger: the
 * row's overflow menu opens it, alongside every other action that changes the
 * entry. Retry, in the same menu, repeats the run under the active mode; this
 * exists for the case where the user wanted a different one.
 */
export const ProcessAgainDialog: React.FC<ProcessAgainDialogProps> = ({
  historyId,
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const labelId = useId();
  const [modes, setModes] = useState<{ value: string; label: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* The list is read when the dialog opens rather than on mount: a history page
   * renders many rows, and none of them needs the mode list until asked. */
  const loadModes = useCallback(async () => {
    setError(null);
    try {
      const snapshot = await commands.getModes();
      setModes(
        snapshot.modes.map((mode) => ({ value: mode.id, label: mode.name })),
      );
      setSelected((current) => current ?? snapshot.active_mode_id);
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  useEffect(() => {
    if (open) void loadModes();
  }, [open, loadModes]);

  const run = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reprocessHistoryEntry(historyId, selected);
      onOpenChange(false);
      toast.success(
        t("settings.history.processAgain.started", "Reprocessing started"),
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("settings.history.processAgain.title", "Process again")}
      description={t(
        "settings.history.processAgain.description",
        "Run this recording through another mode. The original entry is kept and the result is saved as a new one.",
      )}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={() => void run()}
            disabled={busy || selected === null}
            data-testid="history-process-again-confirm"
          >
            {t("settings.history.processAgain.confirm", "Process")}
          </Button>
        </>
      }
    >
      <div className="history-correction">
        {/* The Dropdown renders a button, which `label for` cannot target,
         * so the visible label names the group instead: entering it
         * announces "Mode", and the button keeps the chosen mode as its
         * own name. */}
        <div className="history-field" role="group" aria-labelledby={labelId}>
          <span className="history-field-label" id={labelId}>
            {t("settings.history.processAgain.modeLabel", "Mode")}
          </span>
          <Dropdown
            options={modes}
            selectedValue={selected}
            onSelect={setSelected}
            onRefresh={() => void loadModes()}
            placeholder={t(
              "settings.history.processAgain.placeholder",
              "Choose a mode",
            )}
            disabled={busy}
            className="history-mode-picker"
          />
        </div>
        {error && <Alert variant="error">{error}</Alert>}
      </div>
    </Dialog>
  );
};
