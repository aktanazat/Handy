import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { SettingsRow } from "./rows";
import { useSettings } from "@/hooks/useSettings";
import type { AppearanceMaterial } from "@/bindings";

const MATERIAL_OPTIONS: AppearanceMaterial[] = ["solid", "glass"];

/**
 * Window material: Solid surfaces, or Glass over the desktop.
 *
 * Glass is a macOS effect — it needs an NSVisualEffectView behind a transparent
 * window — so off macOS the row is disabled rather than offering a control that
 * would silently do nothing. Sona's own setting is the real gate either way:
 * WebKit does not implement `prefers-reduced-transparency`, so the window
 * cannot read the system's Reduce Transparency switch, and this row is where a
 * person turns transparency off.
 *
 * The root's `data-material` is written by Rust, which is the only side that
 * knows whether vibrancy actually applied; this row only records intent.
 */
export const MaterialSelector: React.FC = React.memo(() => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const id = useId();
  const supported = type() === "macos";

  const current: AppearanceMaterial = supported
    ? (settings?.appearance_material ?? "solid")
    : "solid";
  const label = t("settings.general.appearance.material.title", "Material");

  return (
    <SettingsRow
      label={label}
      /* Kept: it names which surfaces go transparent, which is the one thing
       * "Solid / Glass" cannot tell you. */
      hint={t(
        "settings.general.appearance.material.description",
        "Solid keeps Sona's surfaces opaque. Glass lets the desktop show through the top bar, the command palette, and the recording HUD.",
      )}
      hintLabel={label}
      controlId={id}
      disabled={!supported}
    >
      <Select
        value={current}
        onValueChange={(value) =>
          /* SAFETY: the items below are exactly `MATERIAL_OPTIONS`, which is
             the AppearanceMaterial union spelled out, and a Radix select can
             only report an item's own value. */
          updateSetting("appearance_material", value as AppearanceMaterial)
        }
        disabled={!supported}
      >
        <SelectTrigger id={id} size="sm" className="w-50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MATERIAL_OPTIONS.map((value) => (
            <SelectItem key={value} value={value}>
              {t(`settings.general.appearance.material.options.${value}`, {
                defaultValue: value === "glass" ? "Glass" : "Solid",
              })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
});

MaterialSelector.displayName = "MaterialSelector";
