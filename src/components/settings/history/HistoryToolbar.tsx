import React, { useId } from "react";
import { FolderOpen, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/vg/toggle-group";
import type { HistoryTextView } from "./HistoryEntry";
import type { ListState } from "./historyListReducer";

const TEXT_VIEWS = [
  { value: "processed", labelKey: "settings.history.textView.processed" },
  { value: "raw", labelKey: "settings.history.textView.raw" },
] as const satisfies ReadonlyArray<{
  value: HistoryTextView;
  labelKey: string;
}>;

interface HistoryToolbarProps {
  state: ListState;
  query: string;
  setQuery: (query: string) => void;
  view: HistoryTextView;
  setView: (view: HistoryTextView) => void;
  activeQuery: string;
  onOpenFolder: () => void;
}

export const HistoryToolbar: React.FC<HistoryToolbarProps> = ({
  state,
  query,
  setQuery,
  view,
  setView,
  activeQuery,
  onOpenFolder,
}) => {
  const { t } = useTranslation();
  const countId = useId();
  const searching = activeQuery.trim() !== "";
  const settled = state.phase !== "loading" && state.phase !== "error";
  const count = state.entries.length;

  // Only the search result count is announced. A running total that changes
  // on every scroll tick would turn the live region into noise.
  let resultCount = "";
  if (searching && settled) {
    if (count === 0) {
      resultCount = t("settings.history.resultsNone", "No matches");
    } else if (state.hasMore) {
      resultCount = t("settings.history.resultsMore", "{{count}}+ matches", {
        count,
      });
    } else {
      resultCount = t("settings.history.results", "{{count}} matches", {
        count,
      });
    }
  }

  return (
    /* One honest wrap row: the search field grows, everything after it is
     * flex-none in DOM order — count, view switch, folder button — so at
     * width the controls sit on one line and under it they wrap whole, last
     * first. Nothing is absolutely positioned; nothing can overlap. */
    <div
      className="flex flex-wrap items-center gap-3"
      data-testid="history-toolbar"
    >
      <div className="relative min-w-[200px] flex-[1_1_240px]">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-gray-800"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("settings.history.searchPlaceholder")}
          aria-label={t("settings.history.search")}
          aria-describedby={countId}
          data-testid="history-search"
          className="h-8 pl-8"
        />
        {query === "" ? null : (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-1 size-6 -translate-y-1/2 text-gray-800 hover:text-gray-1000"
            aria-label={t("settings.history.clearSearch", "Clear search")}
            onClick={() => setQuery("")}
            data-testid="history-search-clear"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        )}
      </div>

      <p
        id={countId}
        className="flex-none text-[13px] leading-[18px] text-gray-900 tabular-nums"
        aria-live="polite"
        data-testid="history-result-count"
      >
        {resultCount}
      </p>

      {/* A two-segment control, not a tablist. There is no third panel here to
       * switch between — both segments render the same rows, one field of them
       * — and a `role="tablist"` with no `tabpanel` under it tells assistive
       * tech about a structure the page does not have. `spacing={0}` is what
       * makes the two outlined items one control with a shared inner edge. */}
      <ToggleGroup
        type="single"
        value={view}
        onValueChange={(value) => {
          /* Radix reports "" when the pressed item is toggled off. There is no
           * unset transcript view, so that press is a no-op. */
          if (value === "") return;
          setView(value === "raw" ? "raw" : "processed");
        }}
        variant="outline"
        size="sm"
        spacing={0}
        aria-label={t("settings.history.textView.label")}
        className="flex-none"
        data-testid="history-text-view"
      >
        {TEXT_VIEWS.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            className="text-[14px]"
          >
            {t(option.labelKey)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Button
        variant="outline"
        size="sm"
        onClick={onOpenFolder}
        data-testid="history-open-folder"
      >
        <FolderOpen aria-hidden="true" className="size-4" />
        {t("settings.history.openFolder")}
      </Button>
    </div>
  );
};
