import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dropdown, ToggleSwitch } from "../ui";
import { useSettings } from "../../hooks/useSettings";
import {
  setHudPillEnabled,
  setHudPillPosition,
  type OverlayPosition,
} from "../../lib/powerPackApi";

interface HudPillSettingsProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/**
 * The always-visible idle pill, off by default.
 *
 * Both writes go through their own commands rather than the generic setting
 * updater because enabling the pill has to bring the overlay window on screen
 * immediately, not at the next dictation.
 */
export const HudPillSettings: React.FC<HudPillSettingsProps> = ({
  descriptionMode = "inline",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { settings, refreshSettings } = useSettings();
  const [enabled, setEnabled] = useState(false);
  const [position, setPosition] = useState<OverlayPosition>("bottom");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.hud_pill_enabled ?? false);
    setPosition(settings.hud_pill_position ?? "bottom");
  }, [settings]);

  const write = async (apply: () => Promise<void>, revert: () => void) => {
    setPending(true);
    try {
      await apply();
      // Other surfaces read settings from the store, so leave its copy correct.
      await refreshSettings();
    } catch {
      revert();
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <ToggleSwitch
        grouped={grouped}
        descriptionMode={descriptionMode}
        checked={enabled}
        isUpdating={pending}
        onChange={(next) => {
          const previous = enabled;
          setEnabled(next);
          void write(
            () => setHudPillEnabled(next),
            () => setEnabled(previous),
          );
        }}
        label={t("settings.hud.enabledLabel", "Show the idle pill")}
        description={t(
          "settings.hud.enabledDescription",
          "Keep a small pill on screen between dictations. Click it to start, right-click it to switch modes.",
        )}
      />
      {enabled && (
        <Dropdown
          options={[
            {
              value: "top",
              label: t("settings.hud.positionTop", "Top"),
            },
            {
              value: "bottom",
              label: t("settings.hud.positionBottom", "Bottom"),
            },
          ]}
          selectedValue={position}
          onSelect={(value) => {
            const previous = position;
            /* SAFETY: the two options above are the only values this dropdown
             * can emit, and they are exactly `OverlayPosition`. */
            const next = value as OverlayPosition;
            setPosition(next);
            void write(
              () => setHudPillPosition(next),
              () => setPosition(previous),
            );
          }}
          disabled={pending}
        />
      )}
    </>
  );
};
