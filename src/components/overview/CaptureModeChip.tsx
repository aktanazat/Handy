import React, { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commands } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { cn } from "@/lib/cn";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/vg/popover";
import { Microlabel } from "@/components/settings/rows";

export interface CaptureModePickerProps {
  /** Every mode, in the order the modes list keeps them. */
  modes: readonly { id: string; name: string }[];
  activeModeId: string;
  /** A switch is in flight, so a second pick would race it. */
  busy: boolean;
  onPick: (modeId: string) => void;
  onOpenModes: () => void;
}

/**
 * The list inside the chip's popover: every mode, the current one marked, and
 * one line out to the editor.
 *
 * Separate from the chip because a popover's content only exists once it is
 * open, and what this list offers has to be provable without a pointer.
 */
export const CaptureModePicker: React.FC<CaptureModePickerProps> = ({
  modes,
  activeModeId,
  busy,
  onPick,
  onOpenModes,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <div className="px-3 pt-3 pb-1">
        <Microlabel>{t("modesV2.chip.title")}</Microlabel>
      </div>
      <ul
        // Tailwind's reset drops the marker, which also drops list semantics
        // in WebKit. The explicit role puts them back.
        role="list"
        aria-label={t("modesV2.chip.title")}
        className="max-h-64 overflow-y-auto py-1"
      >
        {modes.map((mode) => {
          const isActive = mode.id === activeModeId;
          return (
            <li key={mode.id}>
              <button
                type="button"
                disabled={busy}
                aria-current={isActive ? "true" : undefined}
                onClick={() => onPick(mode.id)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]",
                  "hover:bg-gray-alpha-100 focus-visible:-outline-offset-2 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none",
                  isActive ? "text-gray-1000" : "text-gray-900",
                )}
              >
                {/* The mark keeps its box when it is not the current mode, so
                 * the names stay on one left edge down the list. */}
                <Check
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 flex-none",
                    isActive ? "text-blue-900" : "opacity-0",
                  )}
                />
                <span className="min-w-0 truncate">{mode.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {/* One line, because editing a mode is a different task in a different
       * place, and this popover is for picking. */}
      <div className="border-t border-gray-alpha-400 px-3 py-2">
        <button
          type="button"
          onClick={onOpenModes}
          className="text-[13px] text-blue-900 hover:underline focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
        >
          {t("modesV2.chip.editLink")}
        </button>
      </div>
    </>
  );
};

export interface CaptureModeChipProps {
  /** Opens the Modes editor. Capture has no editor of its own. */
  onOpenModes: () => void;
}

/**
 * Which mode the next dictation will run in, on the hero, changeable in place.
 *
 * Modes left the sidebar rail: picking one is a Capture decision and editing
 * one is a Settings task, so this is the picking half. It reads and writes the
 * same `active_mode_id` the mode-switch chords and the HUD's own menu use —
 * `set_active_mode` — so there is one owner of "which mode is current" and no
 * second copy to keep in step.
 */
export const CaptureModeChip: React.FC<CaptureModeChipProps> = ({
  onOpenModes,
}) => {
  const { t } = useTranslation();
  /* `getSetting`, not the `settings` slice: the hook subscribes to `settings`
   * either way, so this component still re-renders when the active mode
   * changes — but the getter reads through the store's own `get()`, which is
   * the value a caller actually has, and it is how every other settings row
   * here reads one. */
  const { getSetting, refreshSettings } = useSettings();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const modes = getSetting("modes") ?? [];
  const activeModeId = getSetting("active_mode_id") ?? "";
  const active = modes.find((mode) => mode.id === activeModeId) ?? modes[0];

  /* Nothing to say before the settings arrive, and a chip naming a mode this
   * install does not have would be worse than no chip. */
  if (!active) return null;

  const switchTo = async (modeId: string) => {
    if (modeId === active.id) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const result = await commands.setActiveMode(modeId);
      if (result.status === "ok") {
        await refreshSettings();
        setOpen(false);
      } else {
        toast.error(t("modesV2.chip.switchError"));
      }
    } catch {
      toast.error(t("modesV2.chip.switchError"));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        disabled={switching}
        /* Quiet at rest: the hero already has one filled button and one
         * bordered one, and this is a statement of state you may change, not a
         * third call to action. */
        className="-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm text-gray-900 hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none disabled:opacity-60"
        aria-label={t("modesV2.chip.action", { mode: active.name })}
        data-testid="overview-mode-chip"
      >
        {active.name}
        <ChevronDown aria-hidden="true" className="size-3.5 text-gray-700" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <CaptureModePicker
          modes={modes}
          activeModeId={active.id}
          busy={switching}
          onPick={(modeId) => void switchTo(modeId)}
          onOpenModes={() => {
            setOpen(false);
            onOpenModes();
          }}
        />
      </PopoverContent>
    </Popover>
  );
};
