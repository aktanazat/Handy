import React from "react";
import { useTranslation } from "react-i18next";
import type { ModelInfo } from "@/bindings";
import {
  getTranslatedModelName,
  getTranslatedModelDescription,
} from "../../lib/utils/modelTranslation";
import "./model-selector.css";

interface ModelDropdownProps {
  models: ModelInfo[];
  currentModelId: string;
  onModelSelect: (modelId: string) => void;
}

/**
 * Model switcher menu. Anchors below the trigger (the top nav) and opens as a
 * raised popover with internal scroll — the max height in model-selector.css
 * is derived from the viewport, so the menu never paints past the window
 * edge. The active model row carries the accent-soft fill and a small chip;
 * every other row stays quiet.
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
      className="model-menu"
    >
      {downloadedModels.length > 0 ? (
        downloadedModels.map((model) => (
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
            className="model-menu-option"
          >
            <div className="model-menu-option-head">
              <span className="model-menu-option-name">
                <span>{getTranslatedModelName(model, t)}</span>
                {model.is_custom && (
                  <span className="model-menu-tag">
                    {t("modelSelector.custom")}
                  </span>
                )}
                {model.supports_streaming && (
                  <span className="model-menu-tag">
                    {t("modelSelector.streaming")}
                  </span>
                )}
              </span>
              {currentModelId === model.id && (
                <span className="model-menu-active-chip">
                  {t("modelSelector.active")}
                </span>
              )}
            </div>
            <p
              className="model-menu-option-desc"
              title={getTranslatedModelDescription(model, t)}
            >
              {getTranslatedModelDescription(model, t)}
            </p>
          </div>
        ))
      ) : (
        <p className="model-menu-empty">
          {t("modelSelector.noModelsAvailable")}
        </p>
      )}
    </div>
  );
};

export default ModelDropdown;
