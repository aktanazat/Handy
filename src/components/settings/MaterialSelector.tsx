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

const MATERIAL_OPTIONS = [
  "solid",
  "glass",
] as const satisfies readonly AppearanceMaterial[];

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
  const label = t("settings.general.appearance.material.title");

  return (
    <SettingsRow
      label={label}
      /* Kept: it names which surfaces go transparent, which is the one thing
       * "Solid / Glass" cannot tell you. */
      hint={t("settings.general.appearance.material.description")}
      hintLabel={label}
      controlId={id}
      disabled={!supported}
    >
      <Select
        value={current}
        onValueChange={(value) => {
          const next = MATERIAL_OPTIONS.find((option) => option === value);
          if (next) void updateSetting("appearance_material", next);
        }}
        disabled={!supported}
      >
        <SelectTrigger id={id} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MATERIAL_OPTIONS.map((value) => (
            <SelectItem key={value} value={value}>
              {t(`settings.general.appearance.material.options.${value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
});

MaterialSelector.displayName = "MaterialSelector";
