import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsRow } from "@/components/settings/rows";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { useSettings } from "../../../hooks/useSettings";
import type { LogLevel } from "@/bindings";

/* Level names are the log format's own tokens rather than prose: they have to
 * match the tags printed in the log lines, so they are not translated. */
const LOG_LEVELS = ["error", "warn", "info", "debug", "trace"] as const;

const LEVEL_LABEL = {
  error: "Error",
  warn: "Warn",
  info: "Info",
  debug: "Debug",
  trace: "Trace",
} satisfies Record<LogLevel, string>;

/* Radix hands back a bare string, so the value is decoded against the known
 * levels rather than asserted into one. */
const isLogLevel = (value: string): value is LogLevel =>
  /* SAFETY: widening the tuple to `readonly string[]` only relaxes the
   * parameter `includes` will accept; membership still decides the guard. */
  (LOG_LEVELS as readonly string[]).includes(value);

const CONTROL_ID = "debug-log-level";

export const LogLevelSelector: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting, isUpdating } = useSettings();
  const currentLevel = settings?.log_level ?? "debug";

  return (
    <SettingsRow
      label={t("settings.debug.logLevel.title")}
      controlId={CONTROL_ID}
    >
      <Select
        value={currentLevel}
        onValueChange={(value) => {
          if (!isLogLevel(value) || value === currentLevel) return;
          void updateSetting("log_level", value);
        }}
        disabled={!settings || isUpdating("log_level")}
      >
        {/* No width cap: the kit's trigger is `w-fit`, and SelectValue's
         * line-clamp cannot ellipsize against the trigger's whitespace-nowrap,
         * so a cap would hard-cut a value instead of truncating it. */}
        <SelectTrigger id={CONTROL_ID} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LOG_LEVELS.map((level) => (
            <SelectItem key={level} value={level}>
              {LEVEL_LABEL[level]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
};
