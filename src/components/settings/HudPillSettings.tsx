import React, { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/vg/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { SettingsRow } from "./rows";
import { useSettings } from "../../hooks/useSettings";
import {
  setHudPillEnabled,
  setHudPillPosition,
  type OverlayPosition,
} from "../../lib/powerPackApi";

/**
 * The always-visible idle pill, off by default.
 *
 * Both writes go through their own commands rather than the generic setting
 * updater because enabling the pill has to bring the overlay window on screen
 * immediately, not at the next dictation.
 */
export const HudPillSettings: React.FC = () => {
  const { t } = useTranslation();
  const { settings, refreshSettings } = useSettings();
  const [enabled, setEnabled] = useState(false);
  const [position, setPosition] = useState<OverlayPosition>("bottom");
  const [pending, setPending] = useState(false);
  const enabledId = useId();
  const positionId = useId();

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

  const positionOptions: { value: OverlayPosition; label: string }[] = [
    { value: "top", label: t("settings.hud.positionTop", "Top") },
    { value: "bottom", label: t("settings.hud.positionBottom", "Bottom") },
  ];

  const enabledLabel = t("settings.hud.enabledLabel", "Show the idle pill");

  return (
    <>
      <SettingsRow
        label={enabledLabel}
        /* Kept: click-to-start and right-click-to-switch-modes are the pill's
         * whole interface, and nothing on screen shows them. */
        hint={t(
          "settings.hud.enabledDescription",
          "Keep a small pill on screen between dictations. Click it to start, right-click it to switch modes.",
        )}
        hintLabel={enabledLabel}
        controlId={enabledId}
      >
        <Switch
          id={enabledId}
          checked={enabled}
          disabled={pending}
          onCheckedChange={(next) => {
            const previous = enabled;
            setEnabled(next);
            void write(
              () => setHudPillEnabled(next),
              () => setEnabled(previous),
            );
          }}
        />
      </SettingsRow>

      {enabled && (
        <SettingsRow
          label={t("settings.hud.positionLabel", "Idle pill position")}
          controlId={positionId}
        >
          <Select
            value={position}
            disabled={pending}
            onValueChange={(value) => {
              const previous = position;
              /* SAFETY: the two items above are the only values this select can
               * emit, and they are exactly `OverlayPosition`. */
              const next = value as OverlayPosition;
              setPosition(next);
              void write(
                () => setHudPillPosition(next),
                () => setPosition(previous),
              );
            }}
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
};
