import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { type ModelUnloadTimeout } from "@/bindings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { SettingsRow } from "./rows";

type TimeoutOption = { value: ModelUnloadTimeout; label: string };

export const ModelUnloadTimeoutSetting: React.FC = () => {
  const { t } = useTranslation();
  const { settings, getSetting, updateSetting } = useSettings();
  const id = useId();

  const handleChange = (value: string) => {
    /* SAFETY: the items below are exactly the ModelUnloadTimeout values, and a
       Radix select can only report an item's own value. */
    void updateSetting("model_unload_timeout", value as ModelUnloadTimeout);
  };

  /* Spelled out rather than mapped over the union: a static key per option is
   * what the en-bundle test can actually see. */
  const options: TimeoutOption[] = [
    { value: "never", label: t("settings.advanced.modelUnload.options.never") },
    {
      value: "immediately",
      label: t("settings.advanced.modelUnload.options.immediately"),
    },
    { value: "min2", label: t("settings.advanced.modelUnload.options.min2") },
    { value: "min5", label: t("settings.advanced.modelUnload.options.min5") },
    { value: "min10", label: t("settings.advanced.modelUnload.options.min10") },
    { value: "min15", label: t("settings.advanced.modelUnload.options.min15") },
    { value: "hour1", label: t("settings.advanced.modelUnload.options.hour1") },
  ];

  // 15 seconds is only useful for watching an unload happen.
  if (settings?.debug_mode === true) {
    options.push({
      value: "sec15",
      label: t("settings.advanced.modelUnload.options.sec15"),
    });
  }

  return (
    <SettingsRow
      label={t("settings.advanced.modelUnload.title")}
      controlId={id}
    >
      <Select
        value={getSetting("model_unload_timeout") ?? "never"}
        onValueChange={handleChange}
      >
        <SelectTrigger id={id} size="sm" className="w-50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
};
