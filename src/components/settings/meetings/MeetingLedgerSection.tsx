import React from "react";
import { FileCode2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  MeetingLoopRow,
  MeetingReviewSnapshot,
  PersonListEntry,
} from "@/bindings";
import {
  FactChip,
  Microlabel,
  Notice,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { FollowUpDraftAction } from "./review/FollowUpDraftAction";
import { LedgerReceiptRow } from "./review/LedgerReceiptRow";
import { LoopRows, type LoopChange } from "./review/LoopRows";
import { formatMeetingOffset } from "./meetingUtils";
import {
  currentLedger,
  LEDGER_OUTCOME,
  type LedgerOutcome,
} from "./meetingLedger";

/* Where did we land, and what did we leave open.
 *
 * Adapted from the where-did-we-land skill by gnurio (MIT licence,
 * https://github.com/gnurio/where-did-we-land): the state vocabulary, the
 * receipt-beside-every-state discipline and the register set are upstream's.
 * See NOTICE.
 *
 * The split this surface exists to show: a count is measured, a state is
 * inferred, and an inferred state is only worth reading next to the quote it
 * was read from. So every row carries its receipt, and every receipt carries
 * the citation jump — the same control the rest of the review uses, because a
 * citation is a jump wherever it appears.
 *
 * One card, hairline blocks, compact measurements. The only tally left is the
 * score: counting the commitments and the open loops above lists that print
 * every one of them was the same number said twice. */

/** Colour is the second channel: the state word carries it either way. */
const OUTCOME_CLASSES = {
  landed: "text-gray-1000",
  open: "text-amber-900",
  dropped: "text-red-900",
} as const satisfies Record<LedgerOutcome, string>;

/** Upstream's glyphs. Colour is the second channel, never the only one. */
const OUTCOME_GLYPHS = {
  landed: "\u25CF",
  open: "\u25CB",
  dropped: "\u2715",
} as const satisfies Record<LedgerOutcome, string>;

const COLUMN_CLASSES =
  "pb-1.5 pe-3 text-start text-[13px] leading-5 font-normal text-gray-900";

const CELL_CLASSES = "py-1.5 pe-3 align-top";

const offsetOf = (milliseconds: number) =>
  formatMeetingOffset(milliseconds * 1_000_000);

export interface MeetingLedgerSectionProps {
  snapshot: MeetingReviewSnapshot;
  busy: boolean;
  canExport: boolean;
  /** Actionable rows for this meeting, or null until the first read lands. */
  loops: MeetingLoopRow[] | null;
  /** Everybody who could own a loop, for the owner picker. */
  people: PersonListEntry[];
  onJumpToSegment: (segmentId: string) => void;
  onExportLedger: () => void;
  onLoopChange: (row: MeetingLoopRow, change: LoopChange) => void;
}

export const MeetingLedgerSection: React.FC<MeetingLedgerSectionProps> = ({
  snapshot,
  busy,
  canExport,
  loops,
  people,
  onJumpToSegment,
  onExportLedger,
  onLoopChange,
}) => {
  const { t } = useTranslation();
  const found = currentLedger(snapshot.artifacts);

  if (found === null) {
    return (
      <SettingsSection label={t("meetings.ledger.title")}>
        <div className="flex flex-col gap-1 px-4 py-6">
          <h3 className="text-[13px] leading-5 text-gray-1000">
            {t("meetings.ledger.emptyTitle")}
          </h3>
          <Notice tone="muted" live={false}>
            {t("meetings.ledger.emptyDescription")}
          </Notice>
        </div>
      </SettingsSection>
    );
  }

  const { ledger } = found;
  const substantive = ledger.threads.filter((thread) => thread.substantive);
  const scored = substantive.length > 0 ? substantive : ledger.threads;
  const landed = scored.filter(
    (thread) => LEDGER_OUTCOME[thread.state] === "landed",
  ).length;

  return (
    <SettingsSection
      label={t("meetings.ledger.title")}
      action={
        /* Two things to do with where we landed: send it to somebody, or keep
         * it. Drafting reads the record and writes nothing to the meeting, so
         * it is not gated on the export permission the page below is. */
        <div className="flex flex-wrap items-center justify-end gap-2">
          <FollowUpDraftAction
            sessionId={snapshot.session.session_id}
            disabled={busy}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExportLedger}
            disabled={busy || !canExport}
          >
            <FileCode2 aria-hidden="true" className="size-3.5" />
            {t("meetings.ledger.exportHtml")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
          <FactChip
            label={t("meetings.ledger.statThreads")}
            value={`${landed}/${scored.length}`}
          />
          <FactChip
            label={t("meetings.ledger.statReceipts")}
            value={
              ledger.receipts.status === "verified" ? (
                t("meetings.ledger.receiptsVerified")
              ) : (
                <span className="text-amber-900">
                  {t("meetings.ledger.receiptsDegraded", {
                    threads: ledger.receipts.dropped_threads,
                    commitments: ledger.receipts.dropped_commitments,
                  })}
                </span>
              )
            }
          />
        </div>
        <p className="text-[13px] leading-5 text-pretty text-gray-1000">
          {ledger.headline}
        </p>
      </div>

      <LedgerBlock label={t("meetings.ledger.threads")}>
        <ul
          role="list"
          aria-label={t("meetings.ledger.threads")}
          className="flex flex-col gap-3"
        >
          {ledger.threads.map((thread, index) => {
            const outcome = LEDGER_OUTCOME[thread.state];
            return (
              <li key={`thread:${index}`} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="text-[11px] tabular-nums text-gray-700">
                      {`T${String(index + 1).padStart(2, "0")}`}
                    </span>
                    <span className="text-[13px] leading-5 font-medium text-gray-1000">
                      {thread.topic}
                    </span>
                    {thread.owner ? (
                      <span className="text-[11px] text-gray-800">
                        {thread.owner}
                      </span>
                    ) : null}
                    {thread.substantive ? null : (
                      <Microlabel>
                        {t("meetings.ledger.asideThread")}
                      </Microlabel>
                    )}
                  </span>
                  <span
                    className={`flex-none text-[11px] whitespace-nowrap ${OUTCOME_CLASSES[outcome]}`}
                  >
                    {`${OUTCOME_GLYPHS[outcome]} ${t(`meetings.ledger.states.${thread.state}`)}`}
                  </span>
                </div>
                <LedgerReceiptRow
                  quote={thread.receipt.quote}
                  speaker={thread.receipt.speaker}
                  atMs={thread.receipt.t_ms}
                  citations={thread.receipt.citations}
                  onJumpToSegment={onJumpToSegment}
                />
              </li>
            );
          })}
        </ul>
      </LedgerBlock>

      {/* Two registers, one control set. Both are things somebody still has to
       * do, so they read and act the same way; only the heading and the
       * absence line differ. Until the first read lands there is nothing to
       * act on, and a spinner over four rows is worse than the wait. */}
      <LedgerBlock label={t("meetings.ledger.openLoops")}>
        <LoopRows
          rows={
            loops === null ? [] : loops.filter((row) => row.kind === "loop")
          }
          people={people}
          disabled={busy || loops === null}
          emptyText={t("meetings.ledger.noOpenLoops")}
          onChange={onLoopChange}
          onJumpToSegment={onJumpToSegment}
        />
      </LedgerBlock>

      <LedgerBlock label={t("meetings.ledger.commitments")}>
        <LoopRows
          rows={
            loops === null
              ? []
              : loops.filter((row) => row.kind === "commitment")
          }
          people={people}
          disabled={busy || loops === null}
          emptyText={t("meetings.ledger.noCommitments")}
          onChange={onLoopChange}
          onJumpToSegment={onJumpToSegment}
        />
      </LedgerBlock>

      <LedgerBlock label={t("meetings.ledger.stances")}>
        {ledger.stances.length === 0 ? (
          <Notice tone="muted" live={false}>
            {t("meetings.ledger.noStances")}
          </Notice>
        ) : (
          <table className="w-full text-[13px] leading-5 text-gray-900">
            <thead>
              <tr>
                <th scope="col" className={COLUMN_CLASSES}>
                  {t("meetings.ledger.columnAt")}
                </th>
                <th scope="col" className={COLUMN_CLASSES}>
                  {t("meetings.ledger.columnDirection")}
                </th>
                <th scope="col" className={COLUMN_CLASSES}>
                  {t("meetings.ledger.columnWhat")}
                </th>
                <th scope="col" className={COLUMN_CLASSES}>
                  {t("meetings.ledger.columnTaken")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-alpha-400">
              {ledger.stances.map((stance, index) => (
                <tr key={`stance:${index}`}>
                  <td
                    className={`${CELL_CLASSES} text-[11px] tabular-nums whitespace-nowrap text-gray-700`}
                  >
                    {offsetOf(stance.at_ms)}
                  </td>
                  <td
                    className={`${CELL_CLASSES} font-medium whitespace-nowrap text-gray-1000`}
                  >
                    {`${stance.from} \u2192 ${stance.to}`}
                  </td>
                  <td className={`${CELL_CLASSES} text-gray-1000`}>
                    {stance.what}
                  </td>
                  <td className={CELL_CLASSES}>{stance.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LedgerBlock>

      <LedgerBlock label={t("meetings.ledger.trust")}>
        <ul role="list" className="flex flex-col gap-1.5">
          <li className="text-[13px] leading-5 text-pretty text-gray-900">
            {t("meetings.ledger.trustMeasured")}
          </li>
          {ledger.caveats.map((caveat, index) => (
            <li
              key={`caveat:${index}`}
              className="text-[13px] leading-5 text-pretty text-gray-900"
            >
              {caveat}
            </li>
          ))}
        </ul>
      </LedgerBlock>
    </SettingsSection>
  );
};

interface LedgerBlockProps {
  label: string;
  children: React.ReactNode;
}

/** One register of the ledger: a microlabel over its rows, on a hairline. */
const LedgerBlock: React.FC<LedgerBlockProps> = ({ label, children }) => (
  <div className="flex flex-col gap-2 px-4 py-3">
    <h3>
      <Microlabel>{label}</Microlabel>
    </h3>
    {children}
  </div>
);
