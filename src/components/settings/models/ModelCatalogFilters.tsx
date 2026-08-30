import React from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/vg/toggle-group";
import { cn } from "@/lib/cn";
import {
  isFiltered,
  NO_FILTERS,
  type ModelCatalogFilterState,
} from "./modelCatalog";

/** One family the catalog can be narrowed to, plus the "all families" entry. */
export interface ModelFamilyOption {
  value: string;
  label: string;
}

type CapabilityKey = "downloadedOnly" | "streamingOnly" | "translationOnly";

export interface ModelCatalogFiltersProps {
  filters: ModelCatalogFilterState;
  onChange: (next: ModelCatalogFilterState) => void;
  /** Families present in the catalog, in catalog order. */
  familyOptions: ModelFamilyOption[];
  isRescanning: boolean;
  onRescan: () => void;
}

export const ModelCatalogFilters: React.FC<ModelCatalogFiltersProps> = ({
  filters,
  onChange,
  familyOptions,
  isRescanning,
  onRescan,
}) => {
  const { t } = useTranslation();

  const filtered = isFiltered(filters);

  const capabilities: { key: CapabilityKey; label: string; title: string }[] = [
    {
      key: "downloadedOnly",
      label: t("settings.models.filters.downloadedOnly", "On disk"),
      title: t(
        "settings.models.filters.downloadedOnlyHint",
        "Show only models already downloaded",
      ),
    },
    {
      key: "streamingOnly",
      label: t("modelSelector.streaming"),
      title: t("settings.models.filters.streaming"),
    },
    {
      key: "translationOnly",
      label: t("modelSelector.capabilities.translate"),
      title: t("settings.models.filters.translation"),
    },
  ];

  /* The toggle group owns one array; the filter state owns three booleans.
   * Neither shape moves — this is the only place they are mapped. */
  const activeCapabilities = capabilities
    .filter((capability) => filters[capability.key])
    .map((capability) => capability.key);

  const searchLabel = t(
    "settings.models.searchByAnything",
    "Search by name, language, or capability",
  );
  const allFamilies = t("settings.models.filters.allFamilies", "All families");
  /* Radix takes the trigger's text from the mounted item, which does not exist
   * until the content opens, so the selected label is resolved here instead. */
  const familyLabel = familyOptions.find(
    (option) => option.value === filters.family,
  )?.label;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="search"
        value={filters.query}
        onChange={(event) =>
          onChange({ ...filters, query: event.target.value })
        }
        placeholder={searchLabel}
        aria-label={searchLabel}
        className="h-8 min-w-0 flex-1 basis-56"
      />

      <Select
        value={filters.family}
        onValueChange={(family) => onChange({ ...filters, family })}
      >
        <SelectTrigger
          size="sm"
          aria-label={t("settings.models.filters.family", "Model family")}
          className="h-8 w-44"
        >
          <SelectValue placeholder={allFamilies}>{familyLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {familyOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <ToggleGroup
        type="multiple"
        variant="outline"
        size="sm"
        value={activeCapabilities}
        onValueChange={(value) =>
          onChange({
            ...filters,
            downloadedOnly: value.includes("downloadedOnly"),
            streamingOnly: value.includes("streamingOnly"),
            translationOnly: value.includes("translationOnly"),
          })
        }
      >
        {capabilities.map((capability) => (
          <ToggleGroupItem
            key={capability.key}
            value={capability.key}
            title={capability.title}
          >
            {capability.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* The two trailing actions travel together: at the settings column's
       * 760px an active filter overflows the row, and pushing only `Clear`
       * right dropped `Rescan` alone onto a second line, hard left. */}
      <div className="ml-auto flex items-center gap-2">
        {filtered && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange(NO_FILTERS)}
          >
            {t("settings.models.filters.clear", "Clear filters")}
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={onRescan}
          disabled={isRescanning}
          title={t("settings.models.rescan.tooltip")}
        >
          <RefreshCw
            aria-hidden="true"
            className={cn("size-3.5", isRescanning && "animate-spin")}
          />
          {t("settings.models.rescan.label")}
        </Button>
      </div>
    </div>
  );
};
