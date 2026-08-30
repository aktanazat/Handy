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
 * `aria-pressed` is the state, and the tick is its second channel: the armed
 * chip is legible in greyscale, which is the whole reason the fill is a gray
 * alpha and not the accent. */
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
        "inline-flex h-6 flex-none items-center gap-1 rounded-md border border-gray-alpha-400 px-2 text-[12px] transition-colors focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none disabled:pointer-events-none disabled:text-gray-700",
        selected
          ? "bg-gray-alpha-200 text-gray-1000"
          : "text-gray-800 hover:bg-gray-alpha-100 hover:text-gray-1000",
      )}
    >
      {selected ? <Check aria-hidden="true" className="size-3" /> : null}
      {t(sourceKey(source))}
    </button>
  );
};
