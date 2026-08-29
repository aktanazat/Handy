import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import type { ModelInfo } from "@/bindings";
import {
  Alert,
  Button,
  EmptyState,
  Skeleton,
  type DropdownOption,
} from "@/components/ui";
import { useModelStore } from "@/stores/modelStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { formatModelSize } from "@/lib/utils/format";
import { getTranslatedModelName } from "@/lib/utils/modelTranslation";
import { PostProcessingSettingsApi } from "../PostProcessingSettingsApi";
import { PromptLibrary } from "../vocabulary/PromptLibrary";
import { WritingSamplesPanel } from "../vocabulary/WritingSamplesPanel";
import { RuleList } from "../vocabulary/PanelParts";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { CloudSttProviderSettings } from "./CloudSttProviderSettings";
import { ModelCatalogFilters } from "./ModelCatalogFilters";
import { ModelCatalogRow, type ModelRowState } from "./ModelCatalogRow";
import {
  ALL_FAMILIES,
  buildSearchIndex,
  diskUsage,
  filterModels,
  NO_FILTERS,
  visibleCatalog,
  type ModelCatalogFilterState,
} from "./modelCatalog";
import { groupModelsByFamily } from "./modelFamily";
import { useModelEngineState, useModelRowErrors } from "./useModelEngineState";
import "./models-page.css";

const SKELETON_GROUPS = [3, 4];

export const ModelsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<ModelCatalogFilterState>(NO_FILTERS);
  const {
    models,
    currentModel,
    downloadingModels,
    downloadProgress,
    downloadStats,
    verifyingModels,
    extractingModels,
    loading,
    error,
    isRescanning,
    downloadModel,
    cancelDownload,
    selectModel,
    deleteModel,
    rescanLocalModels,
    loadModels,
    setError,
  } = useModelStore();
  const debugMode = useSettingsStore(
    (state) => state.settings?.debug_mode ?? false,
  );
  const engine = useModelEngineState(currentModel);
  const {
    messages: rowErrorMessages,
    recordFallback: recordRowError,
    clear: clearRowError,
  } = useModelRowErrors();

  const familyFallbacks = useMemo(
    () => ({
      custom: t("settings.models.families.custom", "Added by you"),
      other: t("settings.models.families.other", "Other models"),
    }),
    [t],
  );

  const catalogModels = useMemo(() => visibleCatalog(models), [models]);

  const searchIndex = useMemo(
    () =>
      buildSearchIndex(catalogModels, {
        streaming: t("modelSelector.streaming"),
        translation: t("modelSelector.capabilities.translate"),
      }),
    [catalogModels, t],
  );

  const familyOptions = useMemo<DropdownOption[]>(
    () => [
      {
        value: ALL_FAMILIES,
        label: t("settings.models.filters.allFamilies", "All families"),
      },
      ...groupModelsByFamily(catalogModels, familyFallbacks).map((group) => ({
        value: group.key,
        label: group.label,
      })),
    ],
    [catalogModels, familyFallbacks, t],
  );

  const groups = useMemo(
    () =>
      groupModelsByFamily(
        filterModels(catalogModels, filters, searchIndex, familyFallbacks),
        familyFallbacks,
      ),
    [catalogModels, filters, searchIndex, familyFallbacks],
  );

  /* Storage already in the payload: size_mb of everything on disk, legacy
   * downloads included, because they occupy the same folder. */
  const onDisk = useMemo(() => diskUsage(models), [models]);

  const activeModel = models.find((model) => model.id === currentModel);

  const rowStateOf = useCallback(
    (model: ModelInfo): ModelRowState => {
      if (model.id in extractingModels) return "extracting";
      if (model.id in verifyingModels) return "verifying";
      if (model.id in downloadingModels) return "downloading";
      if (engine.loadingModelId === model.id) return "loading";
      if (model.id === currentModel) return "active";
      return model.is_downloaded ? "downloaded" : "not-downloaded";
    },
    [
      extractingModels,
      verifyingModels,
      downloadingModels,
      engine.loadingModelId,
      currentModel,
    ],
  );

  const startDownload = useCallback(
    async (modelId: string) => {
      clearRowError(modelId);
      const started = await downloadModel(modelId);
      if (!started) {
        recordRowError(
          modelId,
          t(
            "settings.models.errors.downloadFailed",
            "The download did not start. Check your connection and try again.",
          ),
        );
      }
    },
    [downloadModel, clearRowError, recordRowError, t],
  );

  const handleDelete = useCallback(
    async (modelId: string) => {
      const model = models.find((candidate) => candidate.id === modelId);
      const modelName = model ? getTranslatedModelName(model, t) : modelId;
      const confirmed = await ask(
        modelId === currentModel
          ? t("settings.models.deleteActiveConfirm", { modelName })
          : t("settings.models.deleteConfirm", { modelName }),
        { title: t("settings.models.deleteTitle"), kind: "warning" },
      );
      if (!confirmed) return;
      clearRowError(modelId);
      await deleteModel(modelId);
    },
    [models, currentModel, deleteModel, clearRowError, t],
  );

  /* A row already shows its own failure with a retry; repeating it at the top
   * of the page would say the same thing twice. */
  const pageError =
    error && !Object.values(rowErrorMessages).includes(error) ? error : null;

  if (loading) {
    return (
      <div className="settings-page models-page">
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
          aria-label={t("common.loading")}
          className="models-catalog"
        >
          <div className="models-filter-bar">
            <div className="models-filter-row">
              <Skeleton className="h-9 flex-1" />
              <Skeleton className="h-9 w-24" />
            </div>
            <div className="models-filter-row">
              <Skeleton className="h-9 w-44" />
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-9 w-24" />
            </div>
          </div>
          {SKELETON_GROUPS.map((rows, groupIndex) => (
            <section key={groupIndex} className="models-family">
              <div className="models-family-header">
                <Skeleton className="h-5 w-28" />
              </div>
              <div>
                {Array.from({ length: rows }, (_row, rowIndex) => (
                  <div key={rowIndex} className="models-skeleton-row">
                    <Skeleton className="h-4 w-52" />
                    <Skeleton className="h-3.5 w-72" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page models-page">
      <header className="settings-page-header">
        <h1 id="model-catalog-heading" className="settings-page-title">
          {t("settings.models.title")}
        </h1>
        <p className="settings-page-description">
          {t("settings.models.description")}
        </p>
        <dl className="models-storage-summary">
          <div className="models-storage-stat">
            <dt className="microlabel">
              {t("settings.models.summary.activeLabel", "Active model")}
            </dt>
            <dd>
              {activeModel
                ? getTranslatedModelName(activeModel, t)
                : t("settings.models.summary.noActive", "No model selected")}
            </dd>
          </div>
          <div className="models-storage-stat">
            <dt className="microlabel">
              {t("settings.models.summary.onDiskLabel", "On disk")}
            </dt>
            <dd className="numeric">
              {t("settings.models.familyCount", "{{total}} models", {
                total: onDisk.count,
              })}
              {onDisk.count > 0
                ? ` \u00b7 ${formatModelSize(onDisk.sizeMb)}`
                : ""}
            </dd>
          </div>
        </dl>
      </header>

      <section
        aria-labelledby="model-catalog-heading"
        className="models-catalog"
      >
        <ModelCatalogFilters
          filters={filters}
          onChange={setFilters}
          familyOptions={familyOptions}
          isRescanning={isRescanning}
          onRescan={() => void rescanLocalModels()}
        />

        {pageError && (
          <Alert
            variant="error"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setError(null);
                  void loadModels();
                }}
              >
                {t("common.retry")}
              </Button>
            }
          >
            {pageError}
          </Alert>
        )}

        {catalogModels.length === 0 ? (
          /* The catalog is shipped with the app, so zero entries means the
           * read failed rather than that nothing exists yet. */
          <EmptyState
            variant="error"
            title={t("modelSelector.noModelsAvailable")}
            description={t(
              "settings.models.emptyCatalog",
              "Sona could not read its model catalog. Rescanning picks up models already in the models folder or the Hugging Face cache.",
            )}
            action={
              <Button
                variant="secondary"
                onClick={() => void rescanLocalModels()}
                disabled={isRescanning}
              >
                {t("settings.models.rescan.label")}
              </Button>
            }
          />
        ) : groups.length === 0 ? (
          <EmptyState
            variant="no-results"
            title={t("settings.models.noModelsMatch")}
            description={t(
              "settings.models.noModelsMatchHint",
              "Nothing in the catalog matches every filter at once.",
            )}
            action={
              <Button
                variant="secondary"
                onClick={() => setFilters(NO_FILTERS)}
              >
                {t("settings.models.filters.clear", "Clear filters")}
              </Button>
            }
          />
        ) : (
          groups.map((group) => (
            <section
              key={group.key}
              aria-labelledby={`model-family-${group.key}`}
              className="models-family"
            >
              <div className="models-family-header">
                <h2 id={`model-family-${group.key}`}>{group.label}</h2>
                {/* Visibly a bare count — the Modes master-count convention —
                 * because "1 models" is a grammar bug and per-locale plural
                 * keys are barred by strict key parity. The phrase stays in
                 * the accessible name, where each locale's existing wording
                 * is already number-agnostic. */}
                <span
                  className="models-family-count microlabel numeric"
                  aria-label={t(
                    "settings.models.familyCount",
                    "{{total}} models",
                    {
                      total: group.models.length,
                    },
                  )}
                >
                  {group.models.length}
                </span>
              </div>
              <RuleList label={group.label} className="models-rows">
                {group.models.map((model) => (
                  <ModelCatalogRow
                    key={model.id}
                    model={model}
                    state={rowStateOf(model)}
                    inMemory={engine.loadedModelId === model.id}
                    percentage={downloadProgress[model.id]?.percentage}
                    speed={downloadStats[model.id]?.speed}
                    error={rowErrorMessages[model.id]}
                    showQuant={debugMode}
                    onDownload={(modelId) => void startDownload(modelId)}
                    onRetry={(modelId) => void startDownload(modelId)}
                    onCancel={(modelId) => void cancelDownload(modelId)}
                    onActivate={(modelId) => void selectModel(modelId)}
                    onDelete={(modelId) => void handleDelete(modelId)}
                  />
                ))}
              </RuleList>
            </section>
          ))
        )}
      </section>

      <CloudSttProviderSettings />
      <SettingsGroup title={t("settings.postProcessing.api.title")}>
        <PostProcessingSettingsApi />
        <PromptLibrary />
        <WritingSamplesPanel />
      </SettingsGroup>
    </div>
  );
};
