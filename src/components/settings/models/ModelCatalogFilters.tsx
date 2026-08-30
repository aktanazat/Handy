import React from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Button, Dropdown, Input, type DropdownOption } from "@/components/ui";
import {
  isFiltered,
  NO_FILTERS,
  type ModelCatalogFilterState,
} from "./modelCatalog";

export interface ModelCatalogFiltersProps {
  filters: ModelCatalogFilterState;
  onChange: (next: ModelCatalogFilterState) => void;
  /** Families present in the catalog, in catalog order. */
  familyOptions: DropdownOption[];
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

  /* Capability chips: `aria-pressed` carries the state for assistive tech,
   * the accent-soft fill (models-page.css) carries it visually, so neither
   * channel is alone. */
  const chips = [
    {
      key: "downloadedOnly" as const,
      label: t("settings.models.filters.downloadedOnly", "On disk"),
      title: t(
        "settings.models.filters.downloadedOnlyHint",
        "Show only models already downloaded",
      ),
    },
    {
      key: "streamingOnly" as const,
      label: t("modelSelector.streaming"),
      title: t("settings.models.filters.streaming"),
    },
    {
      key: "translationOnly" as const,
      label: t("modelSelector.capabilities.translate"),
      title: t("settings.models.filters.translation"),
    },
  ];

  return (
    <div className="models-filter-bar">
      <div className="models-filter-row">
        <Input
          type="search"
          value={filters.query}
          onChange={(event) =>
            onChange({ ...filters, query: event.target.value })
          }
          placeholder={t(
            "settings.models.searchByAnything",
            "Search by name, language, or capability",
          )}
          aria-label={t(
            "settings.models.searchByAnything",
            "Search by name, language, or capability",
          )}
          className="models-filter-search"
        />
        <Button
          variant="secondary"
          onClick={onRescan}
          disabled={isRescanning}
          title={t("settings.models.rescan.tooltip")}
        >
          <RefreshCw
            aria-hidden="true"
            className={`size-3.5 ${isRescanning ? "models-spin" : ""}`}
          />
          {t("settings.models.rescan.label")}
        </Button>
      </div>

      <div className="models-filter-row">
        <div
          role="group"
          aria-label={t("settings.models.filters.family", "Model family")}
          className="models-filter-family"
        >
          <Dropdown
            options={familyOptions}
            selectedValue={filters.family}
            onSelect={(family) => onChange({ ...filters, family })}
            placeholder={t(
              "settings.models.filters.allFamilies",
              "All families",
            )}
          />
        </div>

        {chips.map((chip) => (
          <Button
            key={chip.key}
            variant="secondary"
            className="models-filter-chip"
            aria-pressed={filters[chip.key]}
            title={chip.title}
            onClick={() =>
              onChange({ ...filters, [chip.key]: !filters[chip.key] })
            }
          >
            {chip.label}
          </Button>
        ))}

        {filtered && (
          <Button
            variant="ghost"
            onClick={() => onChange(NO_FILTERS)}
            className="models-filter-clear"
          >
            {t("settings.models.filters.clear", "Clear filters")}
          </Button>
        )}
      </div>
    </div>
  );
};
