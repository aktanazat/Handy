import React from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PersonSummary } from "@/bindings";
import { cn } from "@/lib/cn";
import { CardBand } from "@/components/settings/CardBand";
import { SETTINGS_CARD } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { formatEntryTimestamp } from "@/lib/utils/format";

interface PersonSummarySectionProps {
  summary: PersonSummary | null;
  pending: boolean;
  onRegenerate: () => void;
}

/* Three sentences about a relationship, under a band that names them.
 *
 * "About" and nothing else: the paragraph reads as the answer to that one
 * word, so it needs no section label above the card as well. The engine and
 * the time are on the same line as the button because a paragraph a model
 * wrote is only readable if you know which model and when — the same reason
 * the row stores both.
 *
 * A person with no paragraph yet still gets the card, because the button is
 * the only way to ask for one. */
export const PersonSummarySection: React.FC<PersonSummarySectionProps> = ({
  summary,
  pending,
  onRegenerate,
}) => {
  const { t } = useTranslation();

  return (
    <section
      data-slot="person-summary"
      className={cn(SETTINGS_CARD, "overflow-hidden")}
    >
      <CardBand as="h2" title={t("people.summary.title")} />
      <div className="flex flex-col gap-3 px-6 py-5">
        <p className="text-[16px] leading-[25px] text-gray-1000 text-pretty">
          {summary === null ? t("people.summary.empty") : summary.text}
        </p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] leading-[18px] text-gray-900 tabular-nums">
            {summary === null
              ? null
              : t("people.summary.provenance", {
                  model: summary.model_id,
                  date: formatEntryTimestamp(summary.generated_at_utc_ms),
                })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onRegenerate}
          >
            <RefreshCw aria-hidden="true" />
            {t("people.summary.regenerate")}
          </Button>
        </div>
      </div>
    </section>
  );
};
