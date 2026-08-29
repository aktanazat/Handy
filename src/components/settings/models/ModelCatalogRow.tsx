import React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ModelInfo } from "@/bindings";
import { Badge, Button, ProgressBar, StatusText } from "@/components/ui";
import { formatModelSize } from "@/lib/utils/format";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "@/lib/utils/modelTranslation";
import {
  getLanguageLabel,
  getUniqueCapabilityLanguages,
} from "@/lib/constants/languages";
import { isLegacyModel, quantLabelOf } from "./modelFamily";

/**
 * What the catalog knows about one row right now. Exactly one applies, and the
 * row renders it as words: no state is carried by color alone.
 */
export type ModelRowState =
  | "not-downloaded"
  | "downloading"
  | "verifying"
  | "extracting"
  | "downloaded"
  | "active"
  | "loading";

export interface ModelCatalogRowProps {
  model: ModelInfo;
  state: ModelRowState;
  /** True when this model is the one resident in the engine. */
  inMemory: boolean;
  /** Determinate download percentage, 0-100. */
  percentage?: number;
  /** Download speed in MB/s. */
  speed?: number;
  /** Last download or extraction failure for this model. */
  error?: string;
  /** Reveals the GGUF quantization label, matching the rest of debug mode. */
  showQuant: boolean;
  onDownload: (modelId: string) => void;
  onCancel: (modelId: string) => void;
  onDelete: (modelId: string) => void;
  onActivate: (modelId: string) => void;
  onRetry: (modelId: string) => void;
}

const languageSummary = (
  supportedLanguages: string[],
  t: TFunction,
): string | null => {
  const languages = getUniqueCapabilityLanguages(supportedLanguages);
  if (languages.length === 0) return null;
  if (languages.length === 1) {
    const code = languages[0];
    return t("modelSelector.capabilities.languageOnly", {
      language: getLanguageLabel(code) || code,
    });
  }
  return t("modelSelector.capabilities.languageCount", {
    total: languages.length,
  });
};

export const ModelCatalogRow: React.FC<ModelCatalogRowProps> = ({
  model,
  state,
  inMemory,
  percentage,
  speed,
  error,
  showQuant,
  onDownload,
  onCancel,
  onDelete,
  onActivate,
  onRetry,
}) => {
  const { t } = useTranslation();
  const displayName = getTranslatedModelName(model, t);
  const displayDescription = getTranslatedModelDescription(model, t);
  const quant = showQuant ? quantLabelOf(model.filename) : null;

  const tags: string[] = [];
  if (model.is_recommended) tags.push(t("onboarding.recommended"));
  if (model.is_custom) tags.push(t("modelSelector.custom"));
  if (isLegacyModel(model)) tags.push(t("modelSelector.legacy"));
  if (quant) tags.push(quant);

  const meta = [
    formatModelSize(Number(model.size_mb)),
    languageSummary(model.supported_languages, t),
    model.supports_streaming ? t("modelSelector.streaming") : null,
    model.supports_translation
      ? t("modelSelector.capabilities.translate")
      : null,
  ].filter((part): part is string => part !== null);

  /* One status line per row, and one primary action beside it. Delete is the
   * only destructive control here and stays ghost-red until hovered. */
  const status = (() => {
    switch (state) {
      case "loading":
        return {
          tone: "info" as const,
          text: t("modelSelector.loadingGeneric"),
        };
      case "active":
        return {
          tone: "success" as const,
          text: inMemory
            ? t("settings.models.state.activeInMemory", "Active, in memory")
            : t("modelSelector.active"),
        };
      case "downloaded":
        return {
          tone: "muted" as const,
          text: t("settings.models.state.downloaded", "Downloaded"),
        };
      case "downloading":
        return {
          tone: "neutral" as const,
          text: t("modelSelector.downloading", {
            percentage: Math.round(percentage ?? 0),
          }),
        };
      case "verifying":
        return {
          tone: "neutral" as const,
          text: t("modelSelector.verifyingGeneric"),
        };
      case "extracting":
        return {
          tone: "neutral" as const,
          text: t("modelSelector.extractingGeneric"),
        };
      case "not-downloaded":
        return {
          tone: "muted" as const,
          text: t("settings.models.state.notDownloaded", "Not downloaded"),
        };
    }
  })();

  /* Discrete phase changes are worth announcing. A percentage that ticks a
   * few times a second is not: the <progress> element carries that value for
   * anyone who asks for it. */
  const announce =
    state === "loading" || state === "verifying" || state === "extracting";

  return (
    <li className="models-row">
      <div className="models-row-main">
        <div className="models-row-identity">
          <div className="models-row-name">
            <h3>{displayName}</h3>
            {/* Provenance and quantization are categorical facts about the
             * build, so they earn a chip. Size, language reach and capability
             * are ordinary metadata and stay plain mono text below. */}
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
          {displayDescription && (
            <p className="models-row-description">{displayDescription}</p>
          )}
          <p className="models-row-meta">{meta.join(" \u00b7 ")}</p>
        </div>

        <div className="models-row-actions">
          <span className="models-row-status">
            {state === "active" ? (
              /* Exactly one row in the catalog is the current model, which is
               * what Geist's inverted badge is for. */
              <Badge>{status.text}</Badge>
            ) : (
              <StatusText tone={status.tone} live={announce ? "polite" : "off"}>
                {status.text}
              </StatusText>
            )}
          </span>
          {/* Every row shows the same three words, so each control carries the
           * model name in its accessible name. The visible label stays a
           * subset of it, which is what WCAG 2.5.3 asks for. */}
          {state === "not-downloaded" && !error && (
            <Button
              size="sm"
              aria-label={t(
                "settings.models.actions.downloadNamed",
                "Download {{modelName}}",
                { modelName: displayName },
              )}
              onClick={() => onDownload(model.id)}
            >
              {t("settings.models.actions.download", "Download")}
            </Button>
          )}
          {state === "downloading" && (
            <Button
              variant="danger-ghost"
              size="sm"
              aria-label={t("modelSelector.cancelDownload")}
              onClick={() => onCancel(model.id)}
            >
              {t("modelSelector.cancel")}
            </Button>
          )}
          {state === "downloaded" && (
            <Button
              size="sm"
              aria-label={t(
                "settings.models.actions.activateNamed",
                "Use {{modelName}}",
                { modelName: displayName },
              )}
              onClick={() => onActivate(model.id)}
            >
              {t("settings.models.actions.activate", "Use")}
            </Button>
          )}
          {(state === "downloaded" ||
            state === "active" ||
            state === "loading") && (
            <Button
              variant="danger-ghost"
              size="sm"
              disabled={state === "loading"}
              aria-label={t("modelSelector.deleteModel", {
                modelName: displayName,
              })}
              onClick={() => onDelete(model.id)}
            >
              {t("common.delete")}
            </Button>
          )}
        </div>
      </div>

      {state === "downloading" && (
        <div className="models-row-progress">
          <ProgressBar
            progress={[
              { id: model.id, percentage: Math.max(0, percentage ?? 0) },
            ]}
            size="small"
            className="models-row-progress-bar"
          />
          {speed !== undefined && speed > 0 && (
            <span className="models-row-speed numeric">
              <StatusText>
                {t("modelSelector.downloadSpeed", { speed: speed.toFixed(1) })}
              </StatusText>
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="models-row-error">
          <StatusText tone="danger" live="assertive">
            {error}
          </StatusText>
          <Button
            variant="secondary"
            size="sm"
            aria-label={t(
              "settings.models.actions.retryNamed",
              "Retry downloading {{modelName}}",
              { modelName: displayName },
            )}
            onClick={() => onRetry(model.id)}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}
    </li>
  );
};
