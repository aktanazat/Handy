import React from "react";
import { FileCode2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LedgerReceipt, MeetingReviewSnapshot } from "@/bindings";
import {
  FactChip,
  Microlabel,
  Notice,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { CitationJump } from "./review/Citations";
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
  onJumpToSegment: (segmentId: string) => void;
  onExportLedger: () => void;
}

export const MeetingLedgerSection: React.FC<MeetingLedgerSectionProps> = ({
  snapshot,
  busy,
  canExport,
  onJumpToSegment,
  onExportLedger,
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
                  receipt={thread.receipt}
                  onJumpToSegment={onJumpToSegment}
                />
              </li>
            );
          })}
        </ul>
      </LedgerBlock>

      <LedgerBlock label={t("meetings.ledger.openLoops")}>
        {ledger.open_loops.length === 0 ? (
          <Notice tone="muted" live={false}>
            {t("meetings.ledger.noOpenLoops")}
          </Notice>
        ) : (
          <table className="w-full text-[13px] leading-5 text-gray-900">
            <thead>
              <tr>
                <th scope="col" className={COLUMN_CLASSES}>
                  {t("meetings.ledger.columnAt")}
                </th>
                <th scope="col" className={COLUMN_CLASSES}>
                  {t("meetings.ledger.columnQuestion")}
                </th>
                <th scope="col" className={COLUMN_CLASSES}>
                  {t("meetings.ledger.columnInstead")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-alpha-400">
              {ledger.open_loops.map((loop, index) => (
                <tr key={`loop:${index}`}>
                  <td
                    className={`${CELL_CLASSES} text-[11px] tabular-nums whitespace-nowrap text-gray-700`}
                  >
                    {offsetOf(loop.at_ms)}
                  </td>
                  <td className={`${CELL_CLASSES} text-gray-1000`}>
                    {loop.question}
                  </td>
                  <td className={CELL_CLASSES}>{loop.instead}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LedgerBlock>

      <LedgerBlock label={t("meetings.ledger.commitments")}>
        {ledger.commitments.length === 0 ? (
          <Notice tone="muted" live={false}>
            {t("meetings.ledger.noCommitments")}
          </Notice>
        ) : (
          <ul
            role="list"
            aria-label={t("meetings.ledger.commitments")}
            className="flex flex-col gap-3"
          >
            {ledger.commitments.map((commitment, index) => (
              <li key={`commitment:${index}`} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[13px] leading-5 text-gray-1000">
                    <span className="font-medium">{commitment.who}</span>
                    {` — ${commitment.what}`}
                  </span>
                  <span className="flex-none text-[11px] whitespace-nowrap text-gray-700">
                    {t(`meetings.ledger.firmness.${commitment.firmness}`)}
                  </span>
                </div>
                <LedgerReceiptRow
                  receipt={commitment.receipt}
                  onJumpToSegment={onJumpToSegment}
                />
              </li>
            ))}
          </ul>
        )}
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

interface LedgerReceiptRowProps {
  receipt: LedgerReceipt;
  onJumpToSegment: (segmentId: string) => void;
}

/* The receipt, verbatim, and the way back to where it was said. */
const LedgerReceiptRow: React.FC<LedgerReceiptRowProps> = ({
  receipt,
  onJumpToSegment,
}) => {
  const { t } = useTranslation();
  const attribution = [receipt.speaker, offsetOf(receipt.t_ms)]
    .filter((part): part is string => Boolean(part))
    .join(", ");

  return (
    <div className="flex flex-col gap-1">
      <blockquote className="border-s border-gray-alpha-400 ps-2.5 text-[13px] leading-5 text-pretty text-gray-900">
        {`\u201C${receipt.quote}\u201D`}
      </blockquote>
      {/* The attribution names who said it and when; the jumps go there. They
       * sit on one line, so the citation control keeps its own gap instead of
       * the negative inline start a left-aligned citation row wants. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 ps-2.5">
        <span className="text-[11px] text-gray-700">
          {attribution || t("meetings.ledger.unattributed")}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {receipt.citations.map((citation) => (
            <CitationJump
              key={citation.segment_id}
              startOffsetNs={citation.start_offset_ns}
              segmentId={citation.segment_id}
              onJump={onJumpToSegment}
            />
          ))}
        </span>
      </div>
    </div>
  );
};
