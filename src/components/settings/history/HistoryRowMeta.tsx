import React from "react";
import { useTranslation } from "react-i18next";
import type { HistoryEntry, HistoryRunReceipt } from "@/bindings";
import { formatDurationShort, formatRelativeTime } from "@/lib/utils/format";
import { Badge } from "@/components/vg/badge";

interface HistoryRowMetaProps {
  entry: HistoryEntry;
  receipt: HistoryRunReceipt | null;
  noSpeechCaptured: boolean;
  /* True when the row renders no audio player; the meta line then carries the
   * duration the player's right edge would otherwise state. */
  showDuration: boolean;
}

/* Line 1 of the row: when it happened, how long, how many words, which mode.
 * Four cells and nothing else. The measured detail this line used to shout —
 * peak/rms, engine, source, reprocess parentage — lives on the expanded
 * receipt, where it reads as a table instead of seven mono fragments. The
 * date is relative while that is meaningful and absolute past two weeks,
 * through the shared formatter. */
export const HistoryRowMeta: React.FC<HistoryRowMetaProps> = ({
  entry,
  receipt,
  noSpeechCaptured,
  showDuration,
}) => {
  const { t } = useTranslation();

  const cells: Array<{ id: string; content: React.ReactNode }> = [
    {
      id: "time",
      content: formatRelativeTime(entry.timestamp * 1000),
    },
  ];

  if (noSpeechCaptured) {
    /* True for all three ways a run reaches this state: the model examined the
     * clip and returned nothing, or the clip ran long enough that the voice
     * detector's answer stands, or no local decoder existed to ask. The claim
     * is about the recording, not about who checked it.
     *
     * No length here on purpose. A silent capture is zero-padded before it is
     * saved, so its stored length describes the padded clip while peak and rms
     * describe what the microphone actually delivered. The saved clip's length
     * is stated by the thing it belongs to — the player's total. */
    cells.push({
      id: "reason",
      content: (
        /* The one part of line 1 that is a sentence rather than a machine
         * value, so it keeps the sans face and the reading colour. */
        <span className="font-sans text-gray-1000">
          {t("errors.noSpeechDetectedTitle")}
        </span>
      ),
    });
  } else {
    /* The row states its length exactly once. When the audio row renders, its
     * right edge is the duration (it doubles as the scrubber's total); only a
     * row with no player left — a receipt proved the clip empty, or retention
     * removed the file — says it here. */
    if (showDuration && receipt?.duration_ms) {
      cells.push({
        id: "duration",
        content: formatDurationShort(receipt.duration_ms / 1000),
      });
    }
    if (receipt && receipt.word_count !== null) {
      cells.push({
        id: "words",
        content: t("settings.history.receipts.words", {
          count: receipt.word_count,
        }),
      });
    }
  }

  /* Only the semantic case is marked. Every row in a search result matched
   * somehow, so "matched by text" on all of them is chrome; the one fact worth
   * a cell is that this row's own words do NOT contain the query and it is here
   * because its meaning does. Outside a search `match_kind` is null and no cell
   * appears at all. */
  if (entry.match_kind === "semantic") {
    cells.push({
      id: "match",
      content: t("settings.history.recalledByMeaning", "by meaning"),
    });
  }

  return (
    /* One mono run of measured values. It truncates rather than wrapping,
     * because a metadata line that wraps changes the row's height and the list
     * stops being a grid. */
    <p
      className="truncate font-mono text-[11px] tabular-nums text-gray-800"
      data-testid="history-entry-meta"
    >
      {cells.map((cell, index) => (
        <React.Fragment key={cell.id}>
          {index > 0 ? (
            <span aria-hidden="true" className="px-1 text-gray-800">
              ·
            </span>
          ) : null}
          {cell.content}
        </React.Fragment>
      ))}
      {/* The mode is a categorical identity, not a measurement, so it is the
       * line's one chip rather than another mono fragment. */}
      {receipt ? (
        <Badge
          variant="secondary"
          className="ml-2 align-middle font-mono text-[10px]"
          data-testid="history-entry-mode"
        >
          {receipt.mode.mode_id}
        </Badge>
      ) : null}
    </p>
  );
};
