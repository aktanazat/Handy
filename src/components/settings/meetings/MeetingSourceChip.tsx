import React from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SourceKind } from "@/bindings";
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
 * start block on the meetings page, and the pre-meeting preview card, which
 * shows what the next press will record while there is still time to change
 * it. Two copies of this chip would be two answers to one question. */
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
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className="meeting-source-chip"
    >
      {selected ? <Check size={13} aria-hidden="true" /> : null}
      {t(sourceKey(source))}
    </button>
  );
};
