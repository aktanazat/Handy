import { useEffect, useState } from "react";
import { ChevronUp, Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LanguageDirection } from "@/lib/utils/rtl";
import {
  getHudPillState,
  hudOpenModeMenu,
  hudToggleRecording,
  type HudPillState,
} from "@/lib/powerPackApi";

interface HudPillProps {
  position: "top" | "bottom";
  direction: LanguageDirection;
}

/**
 * The always-visible idle pill.
 *
 * It shares the recording overlay's window, so it is a state of that overlay
 * rather than a second window manager. The mode name is the resting content;
 * hover raises the two things you can do to it — record, and switch mode.
 *
 * Both actions are real buttons because the overlay is a non-activating
 * NSPanel: it cannot host a focusable webview popup, so the mode list is an OS
 * menu built on the Rust side. Right-clicking anywhere on the pill opens the
 * same menu, which is how the pill shipped and stays the discoverable path for
 * anyone who never hovers the trailing chevron.
 */
export const HudPill = ({ position, direction }: HudPillProps) => {
  const { t } = useTranslation();
  const [pill, setPill] = useState<HudPillState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getHudPillState();
        if (!cancelled) setPill(next);
      } catch {
        // The pill is decoration until the backend answers; a failed read just
        // leaves the mode name blank rather than tearing the overlay down.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const label = pill?.mode_name ?? t("overlay.hud.idle", "Ready");

  return (
    <div dir={direction} className={`ov-stage ${position} ov-fade show`}>
      <div
        className="scard compact hud-pill"
        onContextMenu={(event) => {
          event.preventDefault();
          void hudOpenModeMenu();
        }}
        data-testid="hud-pill"
      >
        <button
          type="button"
          className="hud-pill-record"
          onClick={() => void hudToggleRecording()}
          aria-label={t("overlay.hud.toggle", {
            defaultValue: "Start dictation in {{mode}}",
            mode: label,
          })}
          title={t(
            "overlay.hud.hint",
            "Click to dictate, right-click for modes",
          )}
        >
          <Mic aria-hidden="true" width={13} height={13} />
          <span className="hud-pill-mode">{label}</span>
        </button>
        <button
          type="button"
          className="hud-pill-switch"
          onClick={() => void hudOpenModeMenu()}
          aria-label={t("overlay.hud.modes", "Switch mode")}
          title={t("overlay.hud.modes", "Switch mode")}
        >
          <ChevronUp aria-hidden="true" width={12} height={12} />
        </button>
      </div>
    </div>
  );
};
