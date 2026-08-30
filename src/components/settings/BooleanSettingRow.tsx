import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/vg/switch";
import { SettingsRow } from "./rows";
import { useSettings } from "../../hooks/useSettings";
import type { AppSettings } from "@/bindings";

/* Any setting the backend stores as a boolean, derived from the settings type
 * rather than listed by hand so this row cannot drift from what exists. */
type BooleanSettingKey = {
  [K in keyof AppSettings]-?: NonNullable<AppSettings[K]> extends boolean
    ? K
    : never;
}[keyof AppSettings];

/**
 * A settings row that is one switch.
 *
 * Every such row was the same five statements, which is how nine copies came
 * to write the same fallback three different ways: `?? false`, `|| false` and
 * `?? true`. `getSetting` returns `undefined` until the first load resolves,
 * so that fallback is what the switch shows on first paint. `||` and `??`
 * agree only while the default is `false`; the moment a row defaults to `true`
 * — two of them do — `||` would read a stored `false` as missing and flip the
 * switch back on under the user. `??` is the one form that is right in both
 * cases, so it is written once, here.
 *
 * `defaultValue` is what the row claims when there is genuinely no setting
 * yet, so it has to match the backend's default for that key.
 */
export const BooleanSettingRow: React.FC<{
  settingKey: BooleanSettingKey;
  labelKey: string;
  /** The one thing about the row a reader cannot infer. Usually absent. */
  hintKey?: string;
  defaultValue?: boolean;
}> = ({ settingKey, labelKey, hintKey, defaultValue = false }) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const id = useId();

  return (
    <SettingsRow
      label={t(labelKey)}
      hint={hintKey === undefined ? undefined : t(hintKey)}
      controlId={id}
    >
      <Switch
        id={id}
        checked={getSetting(settingKey) ?? defaultValue}
        onCheckedChange={(enabled) => void updateSetting(settingKey, enabled)}
        disabled={isUpdating(settingKey)}
      />
    </SettingsRow>
  );
};
