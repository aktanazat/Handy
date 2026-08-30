import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { SettingsRow } from "./rows";
import { useSettings } from "../../hooks/useSettings";
import type { OverlayPosition, OverlayStyle } from "@/bindings";

export const ShowOverlay: React.FC = React.memo(() => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const styleId = useId();
  const positionId = useId();

  const styleOptions: { value: OverlayStyle; label: string }[] = [
    {
      value: "none",
      label: t("settings.advanced.overlay.style.options.none"),
    },
    {
      value: "minimal",
      label: t("settings.advanced.overlay.style.options.minimal"),
    },
    {
      value: "live",
      label: t("settings.advanced.overlay.style.options.live"),
    },
  ];

  const positionOptions: { value: OverlayPosition; label: string }[] = [
    {
      value: "bottom",
      label: t("settings.advanced.overlay.position.options.bottom"),
    },
    {
      value: "top",
      label: t("settings.advanced.overlay.position.options.top"),
    },
  ];

  /* `getSetting` yields `OverlayStyle | undefined`, so the fallback alone
   * produces an `OverlayStyle`. */
  const selectedStyle = getSetting("overlay_style") || "live";
  // Only "top" and "bottom" are selectable; anything else (empty, or a legacy
  // "none" from before the position was retired) falls back to "bottom".
  const selectedPosition: OverlayPosition =
    getSetting("overlay_position") === "top" ? "top" : "bottom";

  const styleLabel = t("settings.advanced.overlay.style.title");

  return (
    <>
      <SettingsRow
        label={styleLabel}
        /* Kept: Live needs a streaming local model or a cloud mode to show
         * anything, and Linux wants None — neither is in the option names. */
        hint={t("settings.advanced.overlay.style.description")}
        hintLabel={styleLabel}
        controlId={styleId}
      >
        <Select
          value={selectedStyle}
          onValueChange={(value) =>
            /* SAFETY: the items are exactly the OverlayStyle values. */
            void updateSetting("overlay_style", value as OverlayStyle)
          }
          disabled={isUpdating("overlay_style")}
        >
          <SelectTrigger id={styleId} size="sm" className="w-50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {styleOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      {selectedStyle !== "none" && (
        <SettingsRow
          label={t("settings.advanced.overlay.position.title")}
          controlId={positionId}
        >
          <Select
            value={selectedPosition}
            onValueChange={(value) =>
              /* SAFETY: the items are exactly the OverlayPosition values. */
              void updateSetting("overlay_position", value as OverlayPosition)
            }
            disabled={isUpdating("overlay_position")}
          >
            <SelectTrigger id={positionId} size="sm" className="w-50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {positionOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      )}
    </>
  );
});
