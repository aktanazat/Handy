import { useId } from "react";
import { useTranslation } from "react-i18next";
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
import { Label } from "@/components/vg/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";

export type CorrectionScope = "global" | "current_mode";

const SCOPE_VALUES = ["current_mode", "global"] as const;

interface HistoryCorrectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spoken: string;
  written: string;
  scope: CorrectionScope;
  saving: boolean;
  ready: boolean;
  onSpokenChange: (value: string) => void;
  onWrittenChange: (value: string) => void;
  onScopeChange: (scope: CorrectionScope) => void;
  onSave: () => void;
}

export const HistoryCorrectionDialog = ({
  open,
  onOpenChange,
  spoken,
  written,
  scope,
  saving,
  ready,
  onSpokenChange,
  onWrittenChange,
  onScopeChange,
  onSave,
}: HistoryCorrectionDialogProps) => {
  const { t } = useTranslation();
  const fieldId = useId();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t("settings.history.correction.title")}</DialogTitle>
          <DialogDescription>
            {t("settings.history.correction.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-spoken`}>
              {t("settings.history.correction.spoken")}
            </Label>
            <Input
              id={`${fieldId}-spoken`}
              value={spoken}
              onChange={(event) => onSpokenChange(event.target.value)}
              placeholder={t("settings.history.correction.spokenPlaceholder")}
              disabled={saving}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-written`}>
              {t("settings.history.correction.written")}
            </Label>
            <Input
              id={`${fieldId}-written`}
              value={written}
              onChange={(event) => onWrittenChange(event.target.value)}
              placeholder={t("settings.history.correction.writtenPlaceholder")}
              disabled={saving}
            />
          </div>
          {/* The rule that is about to be written, quoted back. Recessed
           * against the dialog rather than another card: it belongs to the
           * form around it. */}
          {ready && (
            <p className="rounded-md bg-background-200 px-3 py-2 text-sm break-words text-gray-1000">
              {t("settings.history.correction.preview", {
                spoken: spoken.trim(),
                written: written.trim(),
              })}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-scope`}>
              {t("settings.history.correction.scope")}
            </Label>
            <Select
              value={scope}
              onValueChange={(value) =>
                onScopeChange(value === "global" ? "global" : "current_mode")
              }
              disabled={saving}
            >
              <SelectTrigger id={`${fieldId}-scope`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPE_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(
                      value === "global"
                        ? "settings.history.correction.global"
                        : "settings.history.correction.currentMode",
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={!ready || saving}
            data-testid="history-correction-save"
          >
            {t("settings.history.correction.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
