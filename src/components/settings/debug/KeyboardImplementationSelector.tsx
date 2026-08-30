import React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingsRow } from "@/components/settings/rows";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { useSettings } from "../../../hooks/useSettings";
import { commands, type KeyboardImplementation } from "@/bindings";

/* Backend names, not prose: each one identifies a shortcut implementation a
 * bug report has to be able to quote. */
const IMPLEMENTATION_LABEL = {
  tauri: "Tauri Global Shortcut",
  handy_keys: "Native key listener",
} satisfies Record<KeyboardImplementation, string>;

const IMPLEMENTATIONS = ["tauri", "handy_keys"] as const;

const CONTROL_ID = "debug-keyboard-implementation";

export const KeyboardImplementationSelector: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, isUpdating, refreshSettings } = useSettings();
  const currentImplementation =
    getSetting("keyboard_implementation") ?? "tauri";

  const handleSelect = async (value: KeyboardImplementation) => {
    if (value === currentImplementation) return;

    try {
      const result = await commands.changeKeyboardImplementationSetting(value);

      if (result.status === "error") {
        console.error(
          "Failed to update keyboard implementation:",
          result.error,
        );
        toast.error(String(result.error));
        return;
      }

      // Switching backends can invalidate a chord the old one accepted.
      if (result.data.reset_bindings.length > 0) {
        toast.warning(t("settings.debug.keyboardImplementation.bindingsReset"));
      }

      await refreshSettings();
    } catch (error) {
      console.error("Failed to update keyboard implementation:", error);
      toast.error(String(error));
    }
  };

  return (
    <SettingsRow
      label={t("settings.debug.keyboardImplementation.title")}
      controlId={CONTROL_ID}
    >
      <Select
        value={currentImplementation}
        onValueChange={(value) => {
          if (value !== "tauri" && value !== "handy_keys") return;
          void handleSelect(value);
        }}
        disabled={isUpdating("keyboard_implementation")}
      >
        <SelectTrigger id={CONTROL_ID} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {IMPLEMENTATIONS.map((implementation) => (
            <SelectItem key={implementation} value={implementation}>
              {IMPLEMENTATION_LABEL[implementation]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
};
