import React from "react";
import { CheckCheck, CircleDashed } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PersonCommitment, PersonOpenLoop } from "@/bindings";
import { Microlabel, SettingsSection } from "@/components/settings/rows";
import { formatEntryTimestamp } from "@/lib/utils/format";
import { EmptyStateRow } from "./EmptyStateRow";

const RelationshipRow: React.FC<{
  text: string;
  title: string;
  atUtcMs: number;
  carriedSinceUtcMs?: number | null;
}> = ({ text, title, atUtcMs, carriedSinceUtcMs = null }) => {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <p className="text-[13px] leading-5 text-gray-1000 text-pretty">{text}</p>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Microlabel className="normal-case">{title}</Microlabel>
        <Microlabel className="normal-case tabular-nums">
          {formatEntryTimestamp(atUtcMs)}
        </Microlabel>
        {carriedSinceUtcMs === null ? null : (
          <Microlabel className="normal-case tabular-nums">
            {t("people.detail.carriedSince", {
              date: formatEntryTimestamp(carriedSinceUtcMs),
            })}
          </Microlabel>
        )}
      </span>
    </li>
  );
};

export const PersonLedgerSections: React.FC<{
  openLoops: PersonOpenLoop[];
  commitments: PersonCommitment[];
}> = ({ openLoops, commitments }) => {
  const { t } = useTranslation();

  return (
    <>
      <SettingsSection label={t("people.detail.stillOpen")}>
        {openLoops.length === 0 ? (
          <EmptyStateRow icon={CircleDashed}>
            {t("people.detail.noOpenLoops")}
          </EmptyStateRow>
        ) : (
          <ul className="divide-y divide-gray-alpha-400">
            {openLoops.map((loop, index) => (
              <RelationshipRow
                key={`${loop.meeting_id}:${index}`}
                text={loop.text}
                title={loop.title}
                atUtcMs={loop.at_utc_ms}
                carriedSinceUtcMs={loop.carried_since_at_utc_ms}
              />
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection label={t("people.detail.commitments")}>
        {commitments.length === 0 ? (
          <EmptyStateRow icon={CheckCheck}>
            {t("people.detail.noCommitments")}
          </EmptyStateRow>
        ) : (
          <ul className="divide-y divide-gray-alpha-400">
            {commitments.map((commitment, index) => (
              <RelationshipRow
                key={`${commitment.meeting_id}:${index}`}
                text={commitment.text}
                title={commitment.title}
                atUtcMs={commitment.at_utc_ms}
              />
            ))}
          </ul>
        )}
      </SettingsSection>
    </>
  );
};
