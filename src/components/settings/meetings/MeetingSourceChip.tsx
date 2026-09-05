import React from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SourceKind } from "@/bindings";
import { cn } from "@/lib/cn";
import { sourceKey } from "./meetingUtils";

export interface MeetingSourceChipProps {
  source: SourceKind;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}

/* A capture source is a two-state control, so it is one control with two
 * states rather than a checkbox pretending to be a setting.
 *
 * It lives in its own module because two surfaces arm the same sources: the
 * start card on the meetings page, and the pre-meeting preview card, which
 * shows what the next press will record while there is still time to change
 * it. Two copies of this chip would be two answers to one question.
 *
 * Round 6 took the pill off it. Beside a filled Start and a bordered Import,
 * two bordered pills read as two more buttons, so the source reads as what it
 * is: a quiet line of type that either carries a tick or does not. The tick
 * keeps its column while unticked, so arming a source moves no text — and
 * `aria-pressed` remains the state, with the tick as its second channel, which
 * is what keeps the armed source legible in greyscale.
 *
 * No focus classes: base.css paints one bronze outline for every button in the
 * app, and a local ring would both cancel and replace it. */
export const MeetingSourceChip: React.FC<MeetingSourceChipProps> = ({
  source,
  selected,
  disabled,
  onToggle,
}) => {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      data-slot="source-chip"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "inline-flex h-6 flex-none items-center gap-1 rounded-md px-1.5 text-[13px] leading-[18px] transition-colors motion-reduce:transition-none hover:bg-hover disabled:pointer-events-none disabled:text-gray-700",
        selected ? "text-gray-1000" : "text-gray-900 hover:text-gray-1000",
      )}
    >
      <Check
        aria-hidden="true"
        className={cn("size-3", selected ? null : "invisible")}
      />
      {t(sourceKey(source))}
    </button>
  );
};
