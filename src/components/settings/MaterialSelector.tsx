import React from "react";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "@/hooks/useSettings";
import type { AppearanceMaterial } from "@/bindings";

interface MaterialSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const MATERIAL_OPTIONS: AppearanceMaterial[] = ["solid", "glass"];

/**
 * Window material: Solid surfaces, or Glass over the desktop.
 *
 * Glass is a macOS effect — it needs an NSVisualEffectView behind a transparent
 * window — so the row says so on every other platform rather than offering a
 * control that would silently do nothing. Sona's own setting is the real gate
 * either way: WebKit does not implement `prefers-reduced-transparency`, so the
 * window cannot read the system's Reduce Transparency switch, and this row is
 * where a person turns transparency off.
 *
 * The root's `data-material` is written by Rust, which is the only side that
 * knows whether vibrancy actually applied; this row only records intent.
 */
export const MaterialSelector: React.FC<MaterialSelectorProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { settings, updateSetting } = useSettings();
    const supported = type() === "macos";

    const current: AppearanceMaterial = supported
      ? (settings?.appearance_material ?? "solid")
      : "solid";

    const options = MATERIAL_OPTIONS.map((value) => ({
      value,
      label: t(`settings.general.appearance.material.options.${value}`, {
        defaultValue: value === "glass" ? "Glass" : "Solid",
      }),
    }));

    return (
      <SettingContainer
        title={t("settings.general.appearance.material.title", "Material")}
        description={t(
          "settings.general.appearance.material.description",
          "Solid keeps Sona's surfaces opaque. Glass lets the desktop show through the top bar, the command palette, and the recording HUD.",
        )}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <Dropdown
          options={options}
          selectedValue={current}
          disabled={!supported}
          onSelect={(value) =>
            /* SAFETY: the dropdown can only report back one of the options it
               was given, and `MATERIAL_OPTIONS` is the AppearanceMaterial
               union spelled out. */
            updateSetting("appearance_material", value as AppearanceMaterial)
          }
        />
      </SettingContainer>
    );
  },
);

MaterialSelector.displayName = "MaterialSelector";
