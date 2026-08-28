import React from "react";
import { useTranslation } from "react-i18next";
import type { ModelInfo } from "@/bindings";
import {
  getTranslatedModelName,
  getTranslatedModelDescription,
} from "../../lib/utils/modelTranslation";

interface ModelDropdownProps {
  models: ModelInfo[];
  currentModelId: string;
  onModelSelect: (modelId: string) => void;
}

/**
 * Model switcher menu. Anchors below the trigger (the top nav) and opens as
 * a bordered, opaque popover with the same 6px control language as the rest
 * of the shell.
 */
const ModelDropdown: React.FC<ModelDropdownProps> = ({
  models,
  currentModelId,
  onModelSelect,
}) => {
  const { t } = useTranslation();
  const downloadedModels = models.filter((m) => m.is_downloaded);

  const handleModelClick = (modelId: string) => {
    onModelSelect(modelId);
  };

  return (
    <div
      role="listbox"
      aria-label={t("modelSelector.model")}
      className="absolute left-0 top-full z-50 mt-1 max-h-[60vh] w-72 overflow-y-auto rounded-panel border border-border-strong bg-surface py-1.5 shadow-[var(--shadow-popover)]"
    >
      {downloadedModels.length > 0 ? (
        <div>
          {downloadedModels.map((model) => (
            <div
              key={model.id}
              onClick={() => handleModelClick(model.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleModelClick(model.id);
                }
              }}
              tabIndex={0}
              role="option"
              aria-selected={currentModelId === model.id}
              className={`mx-1.5 cursor-pointer rounded-[6px] px-2.5 py-2 text-start transition-colors hover:bg-hover ${
                currentModelId === model.id ? "bg-subtle" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] text-text-primary">
                  {getTranslatedModelName(model, t)}
                  {model.is_custom && (
                    <span className="ms-1.5 font-mono text-[10px] uppercase text-text-tertiary">
                      {t("modelSelector.custom")}
                    </span>
                  )}
                  {model.supports_streaming && (
                    <span className="ms-1.5 font-mono text-[10px] uppercase text-text-tertiary">
                      {t("modelSelector.streaming")}
                    </span>
                  )}
                </span>
                {currentModelId === model.id && (
                  <span className="shrink-0 font-mono text-[11px] text-text-primary">
                    {t("modelSelector.active")}
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-text-tertiary">
                {getTranslatedModelDescription(model, t)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-3 py-2 text-sm text-text-secondary">
          {t("modelSelector.noModelsAvailable")}
        </p>
      )}
    </div>
  );
};

export default ModelDropdown;
