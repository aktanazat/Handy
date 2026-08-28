import React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  AudioLines,
  Check,
  Download,
  Globe,
  HardDrive,
  Languages,
  Loader2,
  Trash2,
} from "lucide-react";
import type { ModelInfo } from "@/bindings";
import { isLegacySource } from "./modelSource";
import { formatModelSize } from "../../lib/utils/format";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "../../lib/utils/modelTranslation";
import {
  getLanguageLabel,
  getUniqueCapabilityLanguages,
} from "../../lib/constants/languages";
import Badge from "../ui/Badge";
import { Button } from "../ui/Button";
import { useSettingsStore } from "@/stores/settingsStore";

// Get display text for model's language support
const getLanguageDisplayText = (
  supportedLanguages: string[],
  t: TFunction,
): string => {
  const capabilityLanguages = getUniqueCapabilityLanguages(supportedLanguages);
  if (capabilityLanguages.length === 1) {
    const langCode = capabilityLanguages[0];
    const langName = getLanguageLabel(langCode) || langCode;
    return t("modelSelector.capabilities.languageOnly", { language: langName });
  }
  return t("modelSelector.capabilities.languageCount", {
    total: capabilityLanguages.length,
  });
};

// Extract a GGUF quantization label from a filename, if present (e.g. "Q8_0").
const getQuantLabel = (filename: string): string | null => {
  const match = filename.match(
    /[._-](IQ\d+_\w+|Q\d+(?:_\w+)?|F16|BF16|F32)\.gguf$/i,
  );
  return match ? match[1].toUpperCase() : null;
};

export type ModelCardStatus =
  | "downloadable"
  | "downloading"
  | "verifying"
  | "extracting"
  | "switching"
  | "active"
  | "available";

interface ModelCardProps {
  model: ModelInfo;
  variant?: "default" | "featured" | "catalog";
  status?: ModelCardStatus;
  disabled?: boolean;
  className?: string;
  onSelect: (modelId: string) => void;
  onDownload?: (modelId: string) => void;
  onDelete?: (modelId: string) => void;
  onCancel?: (modelId: string) => void;
  downloadProgress?: number;
  downloadSpeed?: number; // MB/s
  showRecommended?: boolean;
}

const ModelCard: React.FC<ModelCardProps> = ({
  model,
  variant = "default",
  status = "downloadable",
  disabled = false,
  className = "",
  onSelect,
  onDownload,
  onDelete,
  onCancel,
  downloadProgress,
  downloadSpeed,
  showRecommended = true,
}) => {
  const { t } = useTranslation();
  const debugMode = useSettingsStore(
    (state) => state.settings?.debug_mode ?? false,
  );
  const isCatalog = variant === "catalog";
  // The active model is already loaded — re-selecting it just reloads it for no
  // gain, so it is deliberately not clickable.
  const isClickable = status === "available" || status === "downloadable";

  // Get translated model name and description
  const displayName = getTranslatedModelName(model, t);
  const displayDescription = getTranslatedModelDescription(model, t);
  const showModelSize =
    status === "downloadable" || status === "available" || status === "active";
  const formattedModelSize = formatModelSize(Number(model.size_mb));
  const quantLabel = getQuantLabel(model.filename);
  const capabilityLanguages = getUniqueCapabilityLanguages(
    model.supported_languages,
  );

  const baseClasses =
    "flex flex-col gap-2 px-3 py-2.5 text-left transition-[background-color] duration-200";

  const variantClasses = status === "active" ? "bg-subtle" : "bg-transparent";
  const interactiveClasses = !isClickable
    ? ""
    : disabled
      ? "cursor-not-allowed opacity-50"
      : "group cursor-pointer hover:bg-hover";

  const handleClick = () => {
    if (!isClickable || disabled) return;
    if (status === "downloadable" && onDownload) {
      onDownload(model.id);
    } else {
      onSelect(model.id);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(model.id);
  };

  return (
    <div
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || !isClickable) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleClick();
        }
      }}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      className={[baseClasses, variantClasses, interactiveClasses, className]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Top section: name/description + score bars */}
      <div className="flex w-full items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={`${isCatalog ? "text-sm" : "text-base"} font-semibold text-text ${isClickable ? "group-hover:text-logo-primary" : ""} transition-colors`}
            >
              {displayName}
            </h3>
            {showRecommended && model.is_recommended && (
              <Badge variant="primary">{t("onboarding.recommended")}</Badge>
            )}
            {status === "active" && (
              <Badge variant="primary">
                <Check className="w-3 h-3 mr-1" />
                {t("modelSelector.active")}
              </Badge>
            )}
            {model.is_custom && (
              <Badge variant="secondary">{t("modelSelector.custom")}</Badge>
            )}
            {isLegacySource(model) && (
              <Badge variant="secondary">{t("modelSelector.legacy")}</Badge>
            )}
            {status === "switching" && (
              <Badge variant="secondary">
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                {t("modelSelector.switching")}
              </Badge>
            )}
          </div>
          <p
            className={`${isCatalog ? "text-xs leading-4" : "text-sm leading-relaxed"} text-text/60`}
          >
            {displayDescription}
          </p>
        </div>
        {(model.accuracy_score > 0 || model.speed_score > 0) && (
          <div
            className={`${isCatalog ? "hidden min-[900px]:flex" : "hidden sm:flex"} items-center ms-4`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-xs text-text/60 w-24 text-end">
                  {t("onboarding.modelCard.accuracy")}
                </p>
                <div className="w-16 h-1 bg-mid-gray/20 overflow-hidden">
                  <div
                    className="h-full bg-logo-primary"
                    style={{ width: `${model.accuracy_score * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-xs text-text/60 w-24 text-end">
                  {t("onboarding.modelCard.speed")}
                </p>
                <div className="w-16 h-1 bg-mid-gray/20 overflow-hidden">
                  <div
                    className="h-full bg-logo-primary"
                    style={{ width: `${model.speed_score * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {!isCatalog && <hr className="w-full border-mid-gray/20" />}

      <div
        className={`flex w-full items-center gap-3 ${
          isCatalog ? "border-t border-border pt-2" : "-mb-0.5 mt-0.5 h-5"
        }`}
      >
        {capabilityLanguages.length > 0 && (
          <div
            className="flex items-center gap-1 text-xs text-text/50"
            title={
              capabilityLanguages.length === 1
                ? t("modelSelector.capabilities.singleLanguage")
                : t("modelSelector.capabilities.languageSelection")
            }
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{getLanguageDisplayText(model.supported_languages, t)}</span>
          </div>
        )}
        {model.supports_translation && (
          <div
            className="flex items-center gap-1 text-xs text-text/50"
            title={t("modelSelector.capabilities.translation")}
          >
            <Languages className="w-3.5 h-3.5" />
            <span>{t("modelSelector.capabilities.translate")}</span>
          </div>
        )}
        {model.supports_streaming && (
          <div
            className="flex items-center gap-1 text-xs text-text/50"
            title={t("modelSelector.capabilities.streaming")}
          >
            <AudioLines className="w-3.5 h-3.5" />
            <span>{t("modelSelector.streaming")}</span>
          </div>
        )}
        {showModelSize && (
          <span className="flex items-center gap-1.5 ms-auto text-xs text-text/50">
            {status === "downloadable" ? (
              <Download className="w-3.5 h-3.5" />
            ) : (
              <HardDrive className="w-3.5 h-3.5" />
            )}
            <span>{formattedModelSize}</span>
            {debugMode && quantLabel && (
              <span className="text-text/40">{quantLabel}</span>
            )}
          </span>
        )}
        {onDelete && (status === "available" || status === "active") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            title={t("modelSelector.deleteModel", { modelName: displayName })}
            className="flex items-center gap-1.5 text-logo-primary/85 hover:text-logo-primary hover:bg-logo-primary/10"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t("common.delete")}</span>
          </Button>
        )}
      </div>

      {/* Download/extract progress */}
      {status === "downloading" && downloadProgress !== undefined && (
        <div className={`w-full ${isCatalog ? "mt-1" : "mt-3"}`}>
          <div className="w-full h-1 bg-mid-gray/20 overflow-hidden">
            <div
              className="h-full bg-logo-primary transition-[width] duration-300"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs mt-1">
            <span className="text-text/50">
              {t("modelSelector.downloading", {
                percentage: Math.round(downloadProgress),
              })}
            </span>
            <div className="flex items-center gap-2">
              {downloadSpeed !== undefined && downloadSpeed > 0 && (
                <span className="tabular-nums text-text/50">
                  {t("modelSelector.downloadSpeed", {
                    speed: downloadSpeed.toFixed(1),
                  })}
                </span>
              )}
              {onCancel && (
                <Button
                  variant="danger-ghost"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onCancel(model.id);
                  }}
                  aria-label={t("modelSelector.cancelDownload")}
                >
                  {t("modelSelector.cancel")}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {status === "verifying" && (
        <div className={`w-full ${isCatalog ? "mt-1" : "mt-3"}`}>
          <div className="w-full h-1 bg-mid-gray/20 overflow-hidden">
            <div className="h-full bg-logo-primary animate-pulse w-full" />
          </div>
          <p className="text-xs text-text/50 mt-1">
            {t("modelSelector.verifyingGeneric")}
          </p>
        </div>
      )}
      {status === "extracting" && (
        <div className={`w-full ${isCatalog ? "mt-1" : "mt-3"}`}>
          <div className="w-full h-1 bg-mid-gray/20 overflow-hidden">
            <div className="h-full bg-logo-primary animate-pulse w-full" />
          </div>
          <p className="text-xs text-text/50 mt-1">
            {t("modelSelector.extractingGeneric")}
          </p>
        </div>
      )}
    </div>
  );
};

export default ModelCard;
