import React, { useId } from "react";
import { FolderOpen, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/vg/tabs";
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
      className="flex flex-wrap items-center gap-2"
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
        className="flex-none font-mono text-[11px] text-gray-800 tabular-nums"
        aria-live="polite"
        data-testid="history-result-count"
      >
        {resultCount}
      </p>

      <Tabs
        value={view}
        onValueChange={(value) =>
          setView(value === "raw" ? "raw" : "processed")
        }
        className="flex-none"
      >
        <TabsList aria-label={t("settings.history.textView.label")}>
          {TEXT_VIEWS.map((option) => (
            <TabsTrigger key={option.value} value={option.value}>
              {t(option.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

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
