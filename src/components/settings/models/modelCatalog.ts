import type { ModelInfo } from "@/bindings";
import {
  getLanguageLabel,
  getUniqueCapabilityLanguages,
} from "@/lib/constants/languages";
import {
  familyOf,
  isLegacyModel,
  type FallbackFamilyLabels,
} from "./modelFamily";

/** Every filter is client side: the whole catalog is already in memory. */
export interface ModelCatalogFilterState {
  query: string;
  /** A family key, or `ALL_FAMILIES`. */
  family: string;
  downloadedOnly: boolean;
  streamingOnly: boolean;
  translationOnly: boolean;
}

export const ALL_FAMILIES = "all";

export const NO_FILTERS: ModelCatalogFilterState = {
  query: "",
  family: ALL_FAMILIES,
  downloadedOnly: false,
  streamingOnly: false,
  translationOnly: false,
};

export const isFiltered = (filters: ModelCatalogFilterState): boolean =>
  filters.query.trim() !== "" ||
  filters.family !== ALL_FAMILIES ||
  filters.downloadedOnly ||
  filters.streamingOnly ||
  filters.translationOnly;

/**
 * The rows the catalog is allowed to show at all.
 *
 * Legacy `.bin`/ONNX entries are no longer advertised, but one already on disk
 * stays listed so it remains runnable and deletable.
 */
export const visibleCatalog = (models: readonly ModelInfo[]): ModelInfo[] =>
  models.filter((model) => !isLegacyModel(model) || model.is_downloaded);

/** The two translated words the search index needs. */
export interface CapabilityWords {
  streaming: string;
  translation: string;
}

/**
 * One lowercase search string per model id, so a keystroke is a substring test
 * rather than a rebuild.
 *
 * Language names and capability words are in the string on purpose: the filter
 * bar has no separate language dropdown, so typing "Russian" or "streaming" is
 * how those are filtered.
 */
export const buildSearchIndex = (
  models: readonly ModelInfo[],
  words: CapabilityWords,
): Map<string, string> => {
  const index = new Map<string, string>();
  for (const model of models) {
    const languages = getUniqueCapabilityLanguages(model.supported_languages)
      .map((code) => `${code} ${getLanguageLabel(code) ?? ""}`)
      .join(" ");
    const capabilities = [
      model.supports_streaming ? words.streaming : "",
      model.supports_translation ? words.translation : "",
    ].join(" ");
    index.set(
      model.id,
      `${model.name} ${model.description} ${languages} ${capabilities}`.toLowerCase(),
    );
  }
  return index;
};

/** Models surviving every active filter, in the order they arrived. */
export const filterModels = (
  models: readonly ModelInfo[],
  filters: ModelCatalogFilterState,
  searchIndex: Map<string, string>,
  fallbacks: FallbackFamilyLabels,
): ModelInfo[] => {
  const query = filters.query.trim().toLowerCase();
  return models.filter((model) => {
    if (filters.downloadedOnly && !model.is_downloaded) return false;
    if (filters.streamingOnly && !model.supports_streaming) return false;
    if (filters.translationOnly && !model.supports_translation) return false;
    if (
      filters.family !== ALL_FAMILIES &&
      familyOf(model, fallbacks).key !== filters.family
    ) {
      return false;
    }
    if (query && !(searchIndex.get(model.id) ?? "").includes(query)) {
      return false;
    }
    return true;
  });
};

/** Models already on disk, and how much room they take. */
export type DiskUsage = { count: number; sizeMb: number };

export const diskUsage = (models: readonly ModelInfo[]): DiskUsage => {
  let count = 0;
  let sizeMb = 0;
  for (const model of models) {
    if (!model.is_downloaded) continue;
    count += 1;
    sizeMb += Number(model.size_mb);
  }
  return { count, sizeMb };
};
