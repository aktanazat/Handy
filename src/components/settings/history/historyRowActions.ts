import type { TFunction } from "i18next";

export interface HistoryRowAction {
  /** Stable id; also the row's `history-entry-<id>` test hook. */
  id: string;
  label: string;
  disabled: boolean;
  onSelect: () => void;
}

/* The operations an opened row keeps behind its menu, as data.
 *
 * Copy, transcribe again and delete are not here: they are named buttons on the
 * expanded row's action bar, because they are what someone opens a recording to
 * do. What is left is the three that are worth offering and not worth a button
 * — teach a correction, save the entry, run it through another mode — stated
 * once here instead of three near-identical JSX blocks, and readable without
 * opening a menu that only exists in a portal. */
export const historyRowActions = ({
  t,
  saved,
  hasText,
  busy,
  onCorrect,
  onToggleSaved,
  onProcessAgain,
}: {
  t: TFunction;
  saved: boolean;
  hasText: boolean;
  busy: boolean;
  onCorrect: () => void;
  onToggleSaved: () => void;
  onProcessAgain: () => void;
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
    id: "process-again",
    label: t("settings.history.processAgain.action", "Process again"),
    disabled: busy,
    onSelect: onProcessAgain,
  },
];
