import React from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PersonSummary } from "@/bindings";
import { SettingsSurface } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { formatEntryTimestamp } from "@/lib/utils/format";

interface PersonSummarySectionProps {
  summary: PersonSummary | null;
  pending: boolean;
  onRegenerate: () => void;
}

/* Three sentences about a relationship, under the name they are about.
 *
 * No section label: the paragraph sits where a subtitle would and reads as one,
 * and a heading over one paragraph is furniture. The engine and the time are on
 * the same line as the button because a paragraph a model wrote is only
 * readable if you know which model and when — the same reason the row stores
 * both.
 *
 * A person with no paragraph yet still gets the row, because the button is the
 * only way to ask for one. */
export const PersonSummarySection: React.FC<PersonSummarySectionProps> = ({
  summary,
  pending,
  onRegenerate,
}) => {
  const { t } = useTranslation();

  return (
    <SettingsSurface data-slot="person-summary">
      <div className="flex flex-col gap-2 px-4 py-3">
        <p className="text-[13px] leading-[19px] text-gray-1000">
          {summary === null ? t("people.summary.empty") : summary.text}
        </p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] leading-4 text-gray-800 tabular-nums">
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
    </SettingsSurface>
  );
};
