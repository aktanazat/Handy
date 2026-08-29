import React from "react";
import { useTranslation } from "react-i18next";
import { Kbd } from "@/components/ui";
import { keyCombinationParts } from "@/lib/utils/keyboard";
import "./shortcut-recorder.css";

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

/**
 * The shortcut chord as keycaps, and the field that records a new one.
 *
 * Two states, one box:
 *   resting   — a real button holding one <Kbd> per physical key plus a
 *               persistent record glyph, so it reads as editable without a
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
        className="shortcut-field"
        data-recording="true"
        role="status"
        aria-live="polite"
      >
        <span className="shortcut-field-pulse" aria-hidden="true" />
        {capturedKeys.length === 0 ? (
          <span className="shortcut-field-prompt">
            {t("settings.general.shortcut.pressKeys")}
          </span>
        ) : (
          <span className="shortcut-field-keys">
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
      className="shortcut-field"
      onClick={onStartRecording}
      disabled={disabled}
      aria-label={t("settings.general.shortcut.recordAction", {
        defaultValue: "Record a new shortcut for {{binding}}",
        binding: bindingName,
      })}
      title={t("settings.general.shortcut.recordHint", "Click to record")}
    >
      {keys.length === 0 ? (
        <span className="shortcut-field-prompt">
          {t("settings.general.shortcut.unset", "Not set")}
        </span>
      ) : (
        <span className="shortcut-field-keys">
          {keys.map((key, index) => (
            <Kbd key={`${key}-${index}`}>{key}</Kbd>
          ))}
        </span>
      )}
      {/* 12px square, drawn rather than imported: one more lucide glyph for a
       * dot is weight the bundle does not need. */}
      <svg
        className="shortcut-field-glyph"
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
