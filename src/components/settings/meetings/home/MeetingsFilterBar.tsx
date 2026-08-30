import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  MeetingListFilter,
  MeetingStatusFilter,
  MeetingTimeWindow,
} from "@/bindings";
import { Microlabel } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import {
  MEETING_STATUS_FILTERS,
  MEETING_TIME_WINDOWS,
  NO_MEETING_FILTER,
  isUnfilteredMeetingList,
  meetingStatusFilterKey,
  meetingTimeWindowKey,
} from "../meetingUtils";

const MEETING_SEARCH_DEBOUNCE_MS = 200;

interface FilterSelectProps<T extends string> {
  filterKey: string;
  value: T;
  selected: string;
  options: { value: T; label: string }[];
  onSelect: (value: T) => void;
}

const FilterSelect = <T extends string>({
  filterKey,
  value,
  selected,
  options,
  onSelect,
}: FilterSelectProps<T>) => {
  const selectOption = (next: string) => {
    const option = options.find((candidate) => candidate.value === next);
    if (option) onSelect(option.value);
  };

  return (
    <Select value={value} onValueChange={selectOption}>
      <SelectTrigger
        size="sm"
        aria-label={filterKey}
        className="h-auto gap-1.5 border-0 bg-transparent px-0 py-1 shadow-none [&_svg]:size-3"
      >
        <Microlabel className="text-gray-900">{filterKey}:</Microlabel>
        <SelectValue>
          <span className="text-[12px] text-gray-1000">{selected}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

interface MeetingsFilterBarProps {
  filter: MeetingListFilter;
  onFilterChange: (filter: MeetingListFilter) => void;
}

export const MeetingsFilterBar: React.FC<MeetingsFilterBarProps> = ({
  filter,
  onFilterChange,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState(filter.title_query ?? "");
  const committedQuery = filter.title_query ?? "";

  useEffect(() => {
    if (query.trim() === committedQuery) return;
    const timer = window.setTimeout(() => {
      onFilterChange({ ...filter, title_query: query.trim() });
    }, MEETING_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [committedQuery, filter, onFilterChange, query]);

  const clearFilters = () => {
    setQuery("");
    onFilterChange(NO_MEETING_FILTER);
  };

  return (
    <div
      role="group"
      aria-label={t("meetings.list.filters.label", "Filter meetings")}
      className="flex flex-nowrap items-center gap-4 rounded-card border border-gray-alpha-400 bg-background-100 px-4 py-2"
    >
      <FilterSelect<MeetingStatusFilter>
        filterKey={t("meetings.list.filters.statusKey", "Status")}
        value={filter.status ?? "any"}
        selected={t(meetingStatusFilterKey(filter.status ?? "any"))}
        options={MEETING_STATUS_FILTERS.map((status) => ({
          value: status,
          label: t(meetingStatusFilterKey(status)),
        }))}
        onSelect={(status) => onFilterChange({ ...filter, status })}
      />
      <FilterSelect<MeetingTimeWindow>
        filterKey={t("meetings.list.filters.timeKey", "Time")}
        value={filter.window ?? "any"}
        selected={t(meetingTimeWindowKey(filter.window ?? "any"))}
        options={MEETING_TIME_WINDOWS.map((window) => ({
          value: window,
          label: t(meetingTimeWindowKey(window)),
        }))}
        onSelect={(window) => onFilterChange({ ...filter, window })}
      />
      {isUnfilteredMeetingList(filter) ? null : (
        <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
          {t("meetings.list.clearFilters", "Clear filters")}
        </Button>
      )}
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={t("meetings.list.searchLabel", "Search meetings")}
        placeholder={t("meetings.list.searchPlaceholder", "Search by title")}
        className="ms-auto h-8 min-w-40 flex-1 text-[13px] sm:max-w-64"
      />
    </div>
  );
};
