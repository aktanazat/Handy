import type { TFunction } from "i18next";

export interface HistoryRowAction {
  /** Stable id; also the row's `history-entry-<id>` test hook. */
  id: string;
  label: string;
  disabled: boolean;
  destructive?: boolean;
  onSelect: () => void;
}

/* Every operation that changes or destroys the entry, as data. The row renders
 * this list into one menu, so the set of operations is stated once instead of
 * five near-identical JSX blocks — and it can be read without opening a menu
 * that only exists in a portal. */
export const historyRowActions = ({
  t,
  saved,
  hasText,
  busy,
  onCorrect,
  onToggleSaved,
  onRetranscribe,
  onProcessAgain,
  onDelete,
}: {
  t: TFunction;
  saved: boolean;
  hasText: boolean;
  busy: boolean;
  onCorrect: () => void;
  onToggleSaved: () => void;
  onRetranscribe: () => void;
  onProcessAgain: () => void;
  onDelete: () => void;
}): HistoryRowAction[] => [
  {
    id: "correct",
    label: t("settings.history.correction.add"),
    disabled: !hasText || busy,
    onSelect: onCorrect,
  },
  {
    /* Named by what pressing it does, which is what a menu item is for: the
     * state it reflects needs no second marker. */
    id: "save",
    label: saved ? t("settings.history.unsave") : t("settings.history.save"),
    disabled: busy,
    onSelect: onToggleSaved,
  },
  {
    id: "retry",
    label: t("settings.history.retranscribe"),
    disabled: busy,
    onSelect: onRetranscribe,
  },
  {
    id: "process-again",
    label: t("settings.history.processAgain.action", "Process again"),
    disabled: busy,
    onSelect: onProcessAgain,
  },
  {
    id: "delete",
    label: t("settings.history.delete"),
    disabled: busy,
    destructive: true,
    onSelect: onDelete,
  },
];
