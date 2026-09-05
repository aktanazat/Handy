import React from "react";
import { useTranslation } from "react-i18next";
import type { PersonLinkSource } from "@/bindings";

/* Why a meeting is on this person's page, as a word in the Meta tier.
 *
 * It was a badge with an icon in it: a filled box and a glyph spent on four
 * labels that are already one word each ("Calendar", "Speaker"). Nothing here
 * is pressable, so nothing here gets a chip's hairline either — the brief
 * keeps that shape for the marks that jump. */
export const EvidenceChip: React.FC<{ source: PersonLinkSource }> = ({
  source,
}) => {
  const { t } = useTranslation();

  return (
    <span
      data-slot="person-evidence"
      data-source={source}
      className="text-[13px] leading-[18px] text-gray-900"
    >
      {t(`people.source.${source}`)}
    </span>
  );
};

export const SuggestedChip: React.FC = () => {
  const { t } = useTranslation();
  return (
    <span
      data-slot="person-suggested"
      className="text-[13px] leading-[18px] text-gray-800"
    >
      {t("people.source.suggested")}
    </span>
  );
};
