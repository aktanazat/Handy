import React, { useId, useState } from "react";
import { Wand2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commands } from "@/bindings";
import { Alert, Button, Dialog, Dropdown, IconButton } from "../../ui";
import { reprocessHistoryEntry } from "../../../lib/powerPackApi";

interface ProcessAgainActionProps {
  historyId: number;
  disabled?: boolean;
}

/**
 * Runs a stored recording through a different mode.
 *
 * Self-contained on purpose: it owns its own mode list and dialog so the
 * history list does not have to thread a callback through three components for
 * one row action. Retry, right next to it, repeats the run under the active
 * mode; this exists for the case where the user wanted a different one.
 */
export const ProcessAgainAction: React.FC<ProcessAgainActionProps> = ({
  historyId,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [modes, setModes] = useState<{ value: string; label: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* The list is read when the dialog opens rather than on mount: a history page
   * renders many rows, and none of them needs the mode list until asked. */
  const openPicker = async () => {
    setError(null);
    setOpen(true);
    try {
      const snapshot = await commands.getModes();
      setModes(
        snapshot.modes.map((mode) => ({ value: mode.id, label: mode.name })),
      );
      setSelected((current) => current ?? snapshot.active_mode_id);
    } catch (cause) {
      setError(String(cause));
    }
  };

  const run = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reprocessHistoryEntry(historyId, selected);
      setOpen(false);
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
    <>
      <IconButton
        size="sm"
        label={t("settings.history.processAgain.action", "Process again")}
        onClick={() => void openPicker()}
        disabled={disabled}
        data-testid="history-entry-process-again"
        icon={<Wand2 aria-hidden="true" width={16} height={16} />}
      />
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
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
              onClick={() => setOpen(false)}
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
              placeholder={t(
                "settings.history.processAgain.placeholder",
                "Choose a mode",
              )}
              disabled={busy || modes.length === 0}
              className="history-mode-picker"
            />
          </div>
          {error && <Alert variant="error">{error}</Alert>}
        </div>
      </Dialog>
    </>
  );
};
