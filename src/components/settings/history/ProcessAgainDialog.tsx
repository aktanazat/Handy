import React, { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commands } from "@/bindings";
import { Button } from "@/components/vg/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/vg/dialog";
import { Label } from "@/components/vg/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
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
 * opened row's overflow menu opens it, alongside the other actions that change
 * the entry without being what you opened the row to do. "Transcribe again",
 * a named button on that same opened row, repeats the run under the active
 * mode; this exists for the case where the user wanted a different one.
 */
export const ProcessAgainDialog: React.FC<ProcessAgainDialogProps> = ({
  historyId,
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const fieldId = useId();
  const [modes, setModes] = useState<{ value: string; label: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* The list is read every time the dialog opens rather than on mount: a
   * history page renders many rows, and none of them needs the mode list until
   * asked. Opening is also the only refresh this needs, so the dialog carries
   * no reload control of its own. */
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>
            {t("settings.history.processAgain.title", "Process again")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "settings.history.processAgain.description",
              "Run this recording through another mode. The original entry is kept and the result is saved as a new one.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId}>
              {t("settings.history.processAgain.modeLabel", "Mode")}
            </Label>
            <Select
              value={selected ?? undefined}
              onValueChange={setSelected}
              disabled={busy}
            >
              <SelectTrigger id={fieldId} className="w-full">
                <SelectValue
                  placeholder={t(
                    "settings.history.processAgain.placeholder",
                    "Choose a mode",
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {modes.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-gray-alpha-400 bg-background-100 px-3 py-2 text-sm break-words text-red-900"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
