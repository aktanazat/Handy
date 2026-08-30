import React from "react";
import { FileCode2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LedgerReceipt, MeetingReviewSnapshot } from "@/bindings";
import {
  Button,
  EmptyState,
  Section,
  StatusText,
  type StatusTone,
} from "../../ui";
import { CitationJump } from "./MeetingReviewPanels";
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
 * citation is a jump wherever it appears. */

const OUTCOME_TONES = {
  landed: "success",
  open: "warning",
  dropped: "danger",
} as const satisfies Record<LedgerOutcome, StatusTone>;

/** Upstream's glyphs. Colour is the second channel, never the only one. */
const OUTCOME_GLYPHS = {
  landed: "\u25CF",
  open: "\u25CB",
  dropped: "\u2715",
} as const satisfies Record<LedgerOutcome, string>;

const CAPTION_CLASSES = "microlabel";

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
      <Section
        title={t("meetings.ledger.title")}
        description={t("meetings.ledger.description")}
      >
        <EmptyState
          title={t("meetings.ledger.emptyTitle")}
          description={t("meetings.ledger.emptyDescription")}
        />
      </Section>
    );
  }

  const { ledger } = found;
  const substantive = ledger.threads.filter((thread) => thread.substantive);
  const scored = substantive.length > 0 ? substantive : ledger.threads;
  const tally = (outcome: LedgerOutcome) =>
    scored.filter((thread) => LEDGER_OUTCOME[thread.state] === outcome).length;

  return (
    <Section
      title={t("meetings.ledger.title")}
      description={t("meetings.ledger.description")}
      actions={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onExportLedger}
          disabled={busy || !canExport}
        >
          <FileCode2 size={14} aria-hidden="true" />
          {t("meetings.ledger.exportHtml")}
        </Button>
      }
    >
      <div className="meeting-card">
        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
          <LedgerStat
            label={t("meetings.ledger.statThreads")}
            value={`${tally("landed")}/${scored.length}`}
          />
          <LedgerStat
            label={t("meetings.ledger.statOpen")}
            value={String(tally("open"))}
          />
          <LedgerStat
            label={t("meetings.ledger.statDropped")}
            value={String(tally("dropped"))}
          />
          <LedgerStat
            label={t("meetings.ledger.statCommitments")}
            value={String(ledger.commitments.length)}
          />
          <LedgerStat
            label={t("meetings.ledger.statOpenLoops")}
            value={String(ledger.open_loops.length)}
          />
          <LedgerStat
            label={t("meetings.ledger.statReceipts")}
            value={
              ledger.receipts.status === "verified"
                ? t("meetings.ledger.receiptsVerified")
                : t("meetings.ledger.receiptsDegraded", {
                    threads: ledger.receipts.dropped_threads,
                    commitments: ledger.receipts.dropped_commitments,
                  })
            }
            tone={ledger.receipts.status === "verified" ? "muted" : "warning"}
          />
        </dl>

        <p className="mt-3 text-[13px] leading-5 text-text-primary text-pretty">
          {ledger.headline}
        </p>

        <h4 className={`mt-5 mb-1.5 ${CAPTION_CLASSES}`}>
          {t("meetings.ledger.threads")}
        </h4>
        <ul
          role="list"
          aria-label={t("meetings.ledger.threads")}
          className="meeting-rows"
        >
          {ledger.threads.map((thread, index) => {
            const outcome = LEDGER_OUTCOME[thread.state];
            return (
              <li key={`thread:${index}`} className="meeting-row-stacked">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <div className="min-w-0 flex items-baseline gap-2">
                    <span className="font-mono text-[11px] text-text-tertiary tabular-nums">
                      {`T${String(index + 1).padStart(2, "0")}`}
                    </span>
                    <span className="text-[13px] leading-5 font-medium text-text-primary">
                      {thread.topic}
                    </span>
                    {thread.owner ? (
                      <span className="font-mono text-[11px] text-text-secondary">
                        {thread.owner}
                      </span>
                    ) : null}
                    {thread.substantive ? null : (
                      <StatusText
                        tone="muted"
                        className="font-mono text-[11px]"
                      >
                        {t("meetings.ledger.asideThread")}
                      </StatusText>
                    )}
                  </div>
                  <StatusText
                    tone={OUTCOME_TONES[outcome]}
                    className="flex-none font-mono text-[11px] whitespace-nowrap"
                  >
                    {`${OUTCOME_GLYPHS[outcome]} ${t(`meetings.ledger.states.${thread.state}`)}`}
                  </StatusText>
                </div>
                <LedgerReceiptRow
                  receipt={thread.receipt}
                  onJumpToSegment={onJumpToSegment}
                />
              </li>
            );
          })}
        </ul>

        <h4 className={`mt-5 mb-1.5 ${CAPTION_CLASSES}`}>
          {t("meetings.ledger.openLoops")}
        </h4>
        {ledger.open_loops.length === 0 ? (
          <StatusText tone="muted" className="block">
            {t("meetings.ledger.noOpenLoops")}
          </StatusText>
        ) : (
          <table className="data-table w-full">
            <thead>
              <tr>
                <th scope="col">{t("meetings.ledger.columnAt")}</th>
                <th scope="col">{t("meetings.ledger.columnQuestion")}</th>
                <th scope="col">{t("meetings.ledger.columnInstead")}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.open_loops.map((loop, index) => (
                <tr key={`loop:${index}`}>
                  <td className="font-mono tabular-nums whitespace-nowrap">
                    {offsetOf(loop.at_ms)}
                  </td>
                  <td>{loop.question}</td>
                  <td className="text-text-secondary">{loop.instead}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h4 className={`mt-5 mb-1.5 ${CAPTION_CLASSES}`}>
          {t("meetings.ledger.commitments")}
        </h4>
        {ledger.commitments.length === 0 ? (
          <StatusText tone="muted" className="block">
            {t("meetings.ledger.noCommitments")}
          </StatusText>
        ) : (
          <ul
            role="list"
            aria-label={t("meetings.ledger.commitments")}
            className="meeting-rows"
          >
            {ledger.commitments.map((commitment, index) => (
              <li key={`commitment:${index}`} className="meeting-row-stacked">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[13px] leading-5 text-text-primary">
                    <span className="font-medium">{commitment.who}</span>
                    {` — ${commitment.what}`}
                  </span>
                  <span className="flex-none font-mono text-[11px] text-text-secondary whitespace-nowrap">
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

        <h4 className={`mt-5 mb-1.5 ${CAPTION_CLASSES}`}>
          {t("meetings.ledger.stances")}
        </h4>
        {ledger.stances.length === 0 ? (
          <StatusText tone="muted" className="block">
            {t("meetings.ledger.noStances")}
          </StatusText>
        ) : (
          <table className="data-table w-full">
            <thead>
              <tr>
                <th scope="col">{t("meetings.ledger.columnAt")}</th>
                <th scope="col">{t("meetings.ledger.columnDirection")}</th>
                <th scope="col">{t("meetings.ledger.columnWhat")}</th>
                <th scope="col">{t("meetings.ledger.columnTaken")}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.stances.map((stance, index) => (
                <tr key={`stance:${index}`}>
                  <td className="font-mono tabular-nums whitespace-nowrap">
                    {offsetOf(stance.at_ms)}
                  </td>
                  <td className="whitespace-nowrap font-medium">
                    {`${stance.from} \u2192 ${stance.to}`}
                  </td>
                  <td>{stance.what}</td>
                  <td className="text-text-secondary">{stance.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h4 className={`mt-5 mb-1.5 ${CAPTION_CLASSES}`}>
          {t("meetings.ledger.trust")}
        </h4>
        <ul role="list" className="meeting-rows">
          <li className="meeting-row-stacked text-[12.5px] leading-[18px] text-text-secondary text-pretty">
            {t("meetings.ledger.trustMeasured")}
          </li>
          {ledger.caveats.map((caveat, index) => (
            <li
              key={`caveat:${index}`}
              className="meeting-row-stacked text-[12.5px] leading-[18px] text-text-secondary text-pretty"
            >
              {caveat}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
};

interface LedgerStatProps {
  label: string;
  value: string;
  tone?: StatusTone;
}

const LedgerStat: React.FC<LedgerStatProps> = ({ label, value, tone }) => (
  <div className="min-w-0">
    <dt className={CAPTION_CLASSES}>{label}</dt>
    <dd className="mt-0.5">
      <StatusText
        tone={tone ?? "neutral"}
        className="font-mono text-[12.5px] tabular-nums"
      >
        {value}
      </StatusText>
    </dd>
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
    <div className="mt-1">
      <blockquote className="border-s border-border-subtle ps-2.5 text-[12.5px] leading-[18px] text-text-primary text-pretty">
        {`\u201C${receipt.quote}\u201D`}
      </blockquote>
      {/* The attribution names who said it and when; the jumps go there. They
       * sit on one line, so the citation control keeps its own gap instead of
       * the negative inline start a left-aligned citation row wants. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 ps-2.5">
        <span className="font-mono text-[11px] text-text-secondary">
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
