import React from "react";
import { useTranslation } from "react-i18next";
import { Kbd } from "@/components/vg/kbd";
import { cn } from "@/lib/cn";
import { FIELD_MAX_W } from "./rows";
import { keyCombinationParts } from "@/lib/utils/keyboard";

/**
 * The gesture, spelled out once, under the dictation binding.
 *
 * Both recorder implementations render it, so the sentence and its key live in
 * one place: tap/hold is the single least discoverable thing about the app.
 */
export const ShortcutHoldHint: React.FC = () => {
  const { t } = useTranslation();
  return (
    <>
      {t(
        "settings.general.shortcut.holdHint",
        "Tap to toggle, hold to talk. Works with any shortcut.",
      )}
    </>
  );
};

export interface ShortcutRecorderFieldProps {
  /** Committed chord as the backend stores it, e.g. "option_left+shift+space". */
  chord: string;
  /** True while the parent is capturing keys. */
  recording: boolean;
  /** Chord captured so far this session; empty until the first key lands. */
  captured: string;
  /** Only meaningful when not recording — recording is exited by the parent. */
  onStartRecording: () => void;
  disabled?: boolean;
  /**
   * Attached to the recording surface only, which is what both parents use to
   * detect a click outside and cancel. The resting button is a real button and
   * never needs it.
   */
  recordingRef?: (node: HTMLDivElement | null) => void;
  /** Accessible name for the resting button, e.g. the binding's own name. */
  bindingName: string;
}

/* Both states share this box so nothing shifts when recording starts: only the
 * border, the pulse and the contents change. `min-h-8` and `rounded-md` line
 * the field up with the reset button beside it in the same row.
 *
 * A chord is an unbounded value — "Left Option + Shift + Space" is three caps
 * with a spelled-out modifier — so the field sizes to its content and stops at
 * the column edge, rather than squeezing the caps into a fixed width. At a
 * fixed 175px the first cap wrapped inside its own box and spilled. */
const FIELD = `flex min-h-8 w-auto ${FIELD_MAX_W} min-w-0 items-center gap-2 rounded-md border px-2 text-sm transition-colors`;

const CAPS = "flex min-w-0 flex-1 items-center gap-1 overflow-hidden";

/**
 * The shortcut chord as keycaps, and the field that records a new one.
 *
 * Two states, one box:
 *   resting   — a real button holding one <Kbd> per physical key plus a
 *               persistent record dot, so it reads as editable without a
 *               hover to reveal it;
 *   recording — the same box with a live pulse and "Press your keys…", the
 *               caps appearing as they are pressed.
 *
 * This component owns no capture logic at all. It renders what the parent has
 * captured and reports the one intent (start recording); committing and
 * cancelling stay with GlobalShortcutInput and HandyKeysShortcutInput, whose
 * key handling must not change.
 */
export const ShortcutRecorderField: React.FC<ShortcutRecorderFieldProps> = ({
  chord,
  recording,
  captured,
  onStartRecording,
  disabled = false,
  recordingRef,
  bindingName,
}) => {
  const { t } = useTranslation();

  if (recording) {
    const capturedKeys = keyCombinationParts(captured);
    return (
      <div
        ref={recordingRef}
        className={cn(
          FIELD,
          "border-blue-700 bg-background-200 ring-2 ring-blue-700",
        )}
        data-recording="true"
        role="status"
        aria-live="polite"
      >
        <span
          data-slot="shortcut-pulse"
          aria-hidden="true"
          className="size-[7px] shrink-0 animate-pulse rounded-full bg-blue-700 motion-reduce:animate-none"
        />
        {capturedKeys.length === 0 ? (
          <span className="min-w-0 flex-1 truncate text-gray-1000">
            {t("settings.general.shortcut.pressKeys")}
          </span>
        ) : (
          <span className={CAPS}>
            {capturedKeys.map((key, index) => (
              <Kbd key={`${key}-${index}`}>{key}</Kbd>
            ))}
          </span>
        )}
      </div>
    );
  }

  const keys = keyCombinationParts(chord);
  return (
    <button
      type="button"
      className={cn(
        FIELD,
        "group border-gray-alpha-400 bg-background-100 text-start text-gray-1000",
        "hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:bg-background-200 disabled:text-gray-700",
      )}
      onClick={onStartRecording}
      disabled={disabled}
      aria-label={t("settings.general.shortcut.recordAction", {
        defaultValue: "Record a new shortcut for {{binding}}",
        binding: bindingName,
      })}
    >
      {keys.length === 0 ? (
        <span className="min-w-0 flex-1 truncate text-gray-700">
          {t("settings.general.shortcut.unset", "Not set")}
        </span>
      ) : (
        <span className={CAPS}>
          {keys.map((key, index) => (
            <Kbd key={`${key}-${index}`}>{key}</Kbd>
          ))}
        </span>
      )}
      {/* 12px square, drawn rather than imported: one more lucide glyph for a
       * dot is weight the bundle does not need. It is what says "editable"
       * without a hover, and comes to full contrast under one. */}
      <svg
        data-slot="shortcut-record-dot"
        className="shrink-0 text-gray-700 transition-colors group-hover:text-gray-1000"
        viewBox="0 0 12 12"
        width={12}
        height={12}
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="3.25" fill="currentColor" />
      </svg>
    </button>
  );
};
