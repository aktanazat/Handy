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
import type { OverlayStyle } from "@/bindings";

/* Which recording overlay to show, if any.
 *
 * One row, not two. The screen edge it sits on used to be a second row: the
 * bottom is where a HUD belongs, `overlay_position` already defaults there, and
 * nobody choosing between None, Minimal and Live is also asking that.
 *
 * The style itself keeps a row because no single default covers every
 * platform — Linux ships with the overlay off and everywhere else ships Live —
 * so this is not a preference a default can own. */
export const ShowOverlay: React.FC = React.memo(() => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const styleId = useId();

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

  /* `getSetting` yields `OverlayStyle | undefined`, so the fallback alone
   * produces an `OverlayStyle`. */
  const selectedStyle = getSetting("overlay_style") || "live";
  const styleLabel = t("settings.advanced.overlay.style.title");

  return (
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
  );
});
