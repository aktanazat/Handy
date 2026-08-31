import React from "react";
import { AudioLines, CalendarDays, Link2, Text } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PersonLinkSource } from "@/bindings";
import { Badge } from "@/components/vg/badge";

const SOURCE_ICONS = {
  calendar: CalendarDays,
  speaker: AudioLines,
  title: Text,
  manual: Link2,
} as const satisfies Record<PersonLinkSource, LucideIcon>;

export const EvidenceChip: React.FC<{ source: PersonLinkSource }> = ({
  source,
}) => {
  const { t } = useTranslation();
  const Icon = SOURCE_ICONS[source];

  return (
    <Badge
      variant="secondary"
      data-slot="person-evidence"
      data-source={source}
      className="rounded-md text-[12px] font-normal"
    >
      <Icon aria-hidden="true" />
      {t(`people.source.${source}`)}
    </Badge>
  );
};

export const SuggestedChip: React.FC = () => {
  const { t } = useTranslation();
  return (
    <Badge
      variant="secondary"
      data-slot="person-suggested"
      className="rounded-md text-[12px] font-normal"
    >
      {t("people.source.suggested")}
    </Badge>
  );
};
