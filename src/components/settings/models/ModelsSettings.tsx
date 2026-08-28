import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  AudioLines,
  ChevronDown,
  Globe,
  Languages,
  RefreshCw,
  Search,
} from "lucide-react";
import type { ModelCardStatus } from "@/components/onboarding";
import { ModelCard } from "@/components/onboarding";
import { useModelStore } from "@/stores/modelStore";
import {
  getLanguageLabel,
  MODEL_CAPABILITY_LANGUAGES,
  supportsLanguageCode,
} from "@/lib/constants/languages.ts";
import type { ModelInfo } from "@/bindings";
import { PostProcessingSettingsApi } from "../PostProcessingSettingsApi";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { CloudSttProviderSettings } from "./CloudSttProviderSettings";

// check if model supports a language based on its supported_languages list
const modelSupportsLanguage = (model: ModelInfo, langCode: string): boolean => {
  return supportsLanguageCode(model.supported_languages, langCode);
};

// Legacy models are the blob (Url-sourced) .bin/ONNX downloads, superseded by
// the catalog GGUFs. They stay runnable when already on disk, but we no longer
// advertise the download.
const isLegacyModel = (model: ModelInfo): boolean => {
  if (model.source === "Local") return false;
  return "Url" in model.source;
};

export const ModelsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStreaming, setFilterStreaming] = useState(false);
  const [filterTranslation, setFilterTranslation] = useState(false);
  const [languageFilter, setLanguageFilter] = useState("all");
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const languageSearchInputRef = useRef<HTMLInputElement>(null);
  const {
    models,
    currentModel,
    downloadingModels,
    downloadProgress,
    downloadStats,
    verifyingModels,
    extractingModels,
    loading,
    isRescanning,
    downloadModel,
    cancelDownload,
    selectModel,
    deleteModel,
    rescanLocalModels,
  } = useModelStore();
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (
        languageDropdownRef.current &&
        target instanceof Node &&
        !languageDropdownRef.current.contains(target)
      ) {
        setLanguageDropdownOpen(false);
        setLanguageSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // focus search input when dropdown opens
  useEffect(() => {
    if (languageDropdownOpen && languageSearchInputRef.current) {
      languageSearchInputRef.current.focus();
    }
  }, [languageDropdownOpen]);

  // filtered languages for dropdown (exclude "auto")
  const filteredLanguages = useMemo(() => {
    return MODEL_CAPABILITY_LANGUAGES.filter((lang) =>
      lang.label.toLowerCase().includes(languageSearch.toLowerCase()),
    );
  }, [languageSearch]);

  // Get selected language label
  const selectedLanguageLabel = useMemo(() => {
    if (languageFilter === "all") {
      return t("settings.models.filters.allLanguages");
    }
    return getLanguageLabel(languageFilter) || "";
  }, [languageFilter, t]);

  const getModelStatus = (modelId: string): ModelCardStatus => {
    if (modelId in extractingModels) {
      return "extracting";
    }
    if (modelId in verifyingModels) {
      return "verifying";
    }
    if (modelId in downloadingModels) {
      return "downloading";
    }
    if (switchingModelId === modelId) {
      return "switching";
    }
    if (modelId === currentModel) {
      return "active";
    }
    const model = models.find((m: ModelInfo) => m.id === modelId);
    if (model?.is_downloaded) {
      return "available";
    }
    return "downloadable";
  };

  const getDownloadProgress = (modelId: string): number | undefined => {
    const progress = downloadProgress[modelId];
    return progress?.percentage;
  };

  const getDownloadSpeed = (modelId: string): number | undefined => {
    const stats = downloadStats[modelId];
    return stats?.speed;
  };

  const handleModelSelect = async (modelId: string) => {
    setSwitchingModelId(modelId);
    try {
      await selectModel(modelId);
    } finally {
      setSwitchingModelId(null);
    }
  };

  const handleModelDownload = async (modelId: string) => {
    await downloadModel(modelId);
  };

  const handleModelDelete = async (modelId: string) => {
    const model = models.find((m: ModelInfo) => m.id === modelId);
    const modelName = model?.name || modelId;
    const isActive = modelId === currentModel;

    const confirmed = await ask(
      isActive
        ? t("settings.models.deleteActiveConfirm", { modelName })
        : t("settings.models.deleteConfirm", { modelName }),
      {
        title: t("settings.models.deleteTitle"),
        kind: "warning",
      },
    );

    if (confirmed) {
      try {
        await deleteModel(modelId);
      } catch (err) {
        console.error(`Failed to delete model ${modelId}:`, err);
      }
    }
  };

  const handleModelCancel = async (modelId: string) => {
    try {
      await cancelDownload(modelId);
    } catch (err) {
      console.error(`Failed to cancel download for ${modelId}:`, err);
    }
  };

  // Filter models by search query (name + description), language filter, and toggles
  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return models.filter((model: ModelInfo) => {
      // Hide deprecated legacy (.bin/ONNX) downloads unless already on disk.
      if (isLegacyModel(model) && !model.is_downloaded) return false;
      if (languageFilter !== "all") {
        if (!modelSupportsLanguage(model, languageFilter)) return false;
      }
      if (filterStreaming && !model.supports_streaming) return false;
      if (filterTranslation && !model.supports_translation) return false;

      if (q) {
        const haystack = `${model.name} ${model.description}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [models, languageFilter, filterStreaming, filterTranslation, searchQuery]);

  // Split filtered models into downloaded (including custom) and available sections
  const { downloadedModels, availableModels } = useMemo(() => {
    const downloaded: ModelInfo[] = [];
    const available: ModelInfo[] = [];

    for (const model of filteredModels) {
      if (
        model.is_custom ||
        model.is_downloaded ||
        model.id in downloadingModels ||
        model.id in extractingModels
      ) {
        downloaded.push(model);
      } else {
        available.push(model);
      }
    }

    // Sort: active model first, then non-custom, then custom at the bottom
    downloaded.sort((a, b) => {
      if (a.id === currentModel) return -1;
      if (b.id === currentModel) return 1;
      if (a.is_custom !== b.is_custom) return a.is_custom ? 1 : -1;
      return 0;
    });

    return {
      downloadedModels: downloaded,
      availableModels: available,
    };
  }, [filteredModels, downloadingModels, extractingModels, currentModel]);

  if (loading) {
    return (
      <div className="settings-page space-y-4">
        <header className="settings-page-header">
          <h1 id="model-catalog-heading" className="settings-page-title">
            {t("settings.models.title")}
          </h1>
          <p className="settings-page-description">
            {t("settings.models.description")}
          </p>
        </header>
        <div
          role="status"
          className="flex min-h-36 items-center justify-center gap-2 text-sm text-text-secondary"
        >
          <div
            aria-hidden="true"
            className="h-6 w-6 animate-spin rounded-full border-2 border-logo-primary border-t-transparent"
          />
          <span>{t("common.loading")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page space-y-4">
      <header className="settings-page-header">
        <h1 id="model-catalog-heading" className="settings-page-title">
          {t("settings.models.title")}
        </h1>
        <p className="settings-page-description">
          {t("settings.models.description")}
        </p>
      </header>

      <section aria-labelledby="model-catalog-heading" className="space-y-3">
        <label className="relative block">
          <span className="sr-only">
            {t("settings.models.searchPlaceholder")}
          </span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("settings.models.searchPlaceholder")}
            aria-label={t("settings.models.searchPlaceholder")}
            className="min-h-9 w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text-primary transition-colors placeholder:text-text-tertiary hover:border-border-strong"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void rescanLocalModels()}
            disabled={isRescanning}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRescanning ? "animate-spin" : ""}`}
            />
            <span>{t("settings.models.rescan.label")}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterStreaming((enabled) => !enabled)}
            title={t("settings.models.filters.streaming")}
            aria-label={t("settings.models.filters.streaming")}
            aria-pressed={filterStreaming}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
              filterStreaming
                ? "border-accent bg-accent-soft text-accent-strong"
                : "border-border bg-surface text-text-secondary hover:border-border-strong hover:bg-hover hover:text-text-primary"
            }`}
          >
            <AudioLines className="h-3.5 w-3.5" />
            <span>{t("modelSelector.streaming")}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterTranslation((enabled) => !enabled)}
            title={t("settings.models.filters.translation")}
            aria-label={t("settings.models.filters.translation")}
            aria-pressed={filterTranslation}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
              filterTranslation
                ? "border-accent bg-accent-soft text-accent-strong"
                : "border-border bg-surface text-text-secondary hover:border-border-strong hover:bg-hover hover:text-text-primary"
            }`}
          >
            <Languages className="h-3.5 w-3.5" />
            <span>{t("modelSelector.capabilities.translate")}</span>
          </button>
          <div className="relative min-w-0" ref={languageDropdownRef}>
            <button
              type="button"
              onClick={() => setLanguageDropdownOpen((open) => !open)}
              aria-label={t("settings.models.filters.allLanguages")}
              aria-expanded={languageDropdownOpen}
              aria-haspopup="listbox"
              className={`inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                languageFilter !== "all"
                  ? "border-accent bg-accent-soft text-accent-strong"
                  : "border-border bg-surface text-text-secondary hover:border-border-strong hover:bg-hover hover:text-text-primary"
              }`}
            >
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-28 truncate">{selectedLanguageLabel}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                  languageDropdownOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {languageDropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-surface">
                <div className="border-b border-border p-2">
                  <input
                    ref={languageSearchInputRef}
                    type="search"
                    value={languageSearch}
                    onChange={(event) => setLanguageSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return;
                      if (
                        event.key === "Enter" &&
                        filteredLanguages.length > 0
                      ) {
                        setLanguageFilter(filteredLanguages[0].value);
                        setLanguageDropdownOpen(false);
                        setLanguageSearch("");
                      } else if (event.key === "Escape") {
                        setLanguageDropdownOpen(false);
                        setLanguageSearch("");
                      }
                    }}
                    placeholder={t(
                      "settings.general.language.searchPlaceholder",
                    )}
                    aria-label={t(
                      "settings.general.language.searchPlaceholder",
                    )}
                    className="min-h-8 w-full rounded-md border border-border bg-canvas px-2 text-sm text-text-primary placeholder:text-text-tertiary hover:border-border-strong"
                  />
                </div>
                <div role="listbox" className="max-h-52 overflow-y-auto py-1">
                  <button
                    type="button"
                    role="option"
                    aria-selected={languageFilter === "all"}
                    onClick={() => {
                      setLanguageFilter("all");
                      setLanguageDropdownOpen(false);
                      setLanguageSearch("");
                    }}
                    className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                      languageFilter === "all"
                        ? "bg-subtle font-semibold text-text-primary"
                        : "text-text-secondary hover:bg-hover hover:text-text-primary"
                    }`}
                  >
                    {t("settings.models.filters.allLanguages")}
                  </button>
                  {filteredLanguages.map((language) => (
                    <button
                      key={language.value}
                      type="button"
                      role="option"
                      aria-selected={languageFilter === language.value}
                      onClick={() => {
                        setLanguageFilter(language.value);
                        setLanguageDropdownOpen(false);
                        setLanguageSearch("");
                      }}
                      className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                        languageFilter === language.value
                          ? "bg-subtle font-semibold text-text-primary"
                          : "text-text-secondary hover:bg-hover hover:text-text-primary"
                      }`}
                    >
                      {language.label}
                    </button>
                  ))}
                  {filteredLanguages.length === 0 && (
                    <p
                      role="status"
                      className="px-3 py-2 text-center text-sm text-text-secondary"
                    >
                      {t("settings.general.language.noResults")}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="space-y-5">
        <section
          aria-labelledby="downloaded-models-heading"
          className="space-y-2"
        >
          <h2
            id="downloaded-models-heading"
            className="px-0.5 text-[13px] font-semibold leading-[18px] text-text-secondary"
          >
            {t("settings.models.yourModels")}
          </h2>
          {downloadedModels.length > 0 && (
            <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
              {downloadedModels.map((model: ModelInfo) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  variant="catalog"
                  status={getModelStatus(model.id)}
                  onSelect={handleModelSelect}
                  onDownload={handleModelDownload}
                  onDelete={handleModelDelete}
                  onCancel={handleModelCancel}
                  downloadProgress={getDownloadProgress(model.id)}
                  downloadSpeed={getDownloadSpeed(model.id)}
                  showRecommended={false}
                />
              ))}
            </div>
          )}
        </section>

        {availableModels.length > 0 && (
          <section
            aria-labelledby="available-models-heading"
            className="space-y-2"
          >
            <h2
              id="available-models-heading"
              className="px-0.5 text-[13px] font-semibold leading-[18px] text-text-secondary"
            >
              {t("settings.models.availableModels")}
            </h2>
            <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
              {availableModels.map((model: ModelInfo) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  variant="catalog"
                  status={getModelStatus(model.id)}
                  onSelect={handleModelSelect}
                  onDownload={handleModelDownload}
                  onDelete={handleModelDelete}
                  onCancel={handleModelCancel}
                  downloadProgress={getDownloadProgress(model.id)}
                  downloadSpeed={getDownloadSpeed(model.id)}
                  showRecommended
                />
              ))}
            </div>
          </section>
        )}

        {filteredModels.length === 0 && (
          <p
            role="status"
            className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-text-secondary"
          >
            {t("settings.models.noModelsMatch")}
          </p>
        )}
      </div>

      <CloudSttProviderSettings />
      <SettingsGroup title={t("settings.postProcessing.api.title")}>
        <PostProcessingSettingsApi />
      </SettingsGroup>
    </div>
  );
};
