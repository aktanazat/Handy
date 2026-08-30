import React from "react";
import { Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ModelInfo } from "@/bindings";
import { Button } from "@/components/vg/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/vg/dropdown-menu";
import { cn } from "@/lib/cn";
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

export interface ModelRowActions {
  /** The single control the row shows inline, or none. */
  primary: "download" | "cancel" | "activate" | "retry" | null;
  /** Delete is never the row's inline control; it lives in the overflow. */
  canDelete: boolean;
}

/**
 * One action per row, resolved from state.
 *
 * A 68-row catalog with three buttons per row is a wall, so the row shows the
 * one thing to do next and puts the destructive one behind the overflow. A
 * failed transfer replaces Download with Retry rather than offering both, and
 * a transfer in flight offers only the way out of it.
 */
export const modelRowActions = (
  state: ModelRowState,
  hasError: boolean,
): ModelRowActions => {
  switch (state) {
    case "not-downloaded":
      return { primary: hasError ? "retry" : "download", canDelete: false };
    case "downloading":
      return { primary: "cancel", canDelete: false };
    case "verifying":
    case "extracting":
      return { primary: null, canDelete: false };
    case "downloaded":
      return { primary: "activate", canDelete: true };
    case "active":
      return { primary: null, canDelete: true };
    case "loading":
      /* The engine is reading the file: deleting it now would pull it out
       * from under the load. */
      return { primary: null, canDelete: false };
  }
};

export interface ModelCatalogRowProps {
  model: ModelInfo;
  state: ModelRowState;
  /** True when this model is the one resident in the engine. */
  inMemory: boolean;
  /** Determinate download percentage, 0-100. */
  percentage?: number;
  /* No speed: the bar carries the shape, the percentage carries the number,
   * and a third figure that re-renders several times a second is the noise
   * this catalog is being cut down to remove. */
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
  const quant = showQuant ? quantLabelOf(model.filename) : null;

  /* The row is a table row: name, size, state, one action. Everything else
   * the catalog knows about a build — reach, capabilities, provenance,
   * quantization — rides the name's tooltip with the description, because at
   * the 704px content column a fifth column can only be bought by truncating
   * the name to nothing. `Recommended` is the exception: it is the one datum
   * that changes which row a first-run user picks. */
  const detail = [
    getTranslatedModelDescription(model, t),
    languageSummary(model.supported_languages, t),
    model.supports_streaming ? t("modelSelector.streaming") : null,
    model.supports_translation
      ? t("modelSelector.capabilities.translate")
      : null,
    model.is_custom ? t("modelSelector.custom") : null,
    isLegacyModel(model) ? t("modelSelector.legacy") : null,
    quant,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" \u00b7 ");

  /* One status cell per row, always a word, always the same width, so the
   * column above and below it starts in the same place. */
  const status = (() => {
    switch (state) {
      case "loading":
        return t("modelSelector.loadingGeneric");
      case "active":
        return inMemory
          ? t("settings.models.state.activeInMemory", "Active, in memory")
          : t("modelSelector.active");
      case "downloaded":
        return t("settings.models.state.downloaded", "Downloaded");
      case "downloading":
        return t("modelSelector.downloading", {
          percentage: Math.round(percentage ?? 0),
        });
      case "verifying":
        return t("modelSelector.verifyingGeneric");
      case "extracting":
        return t("modelSelector.extractingGeneric");
      case "not-downloaded":
        return t("settings.models.state.notDownloaded", "Not downloaded");
    }
  })();

  /* Discrete phase changes are worth announcing. A percentage that ticks a
   * few times a second is not. */
  const announce =
    state === "loading" || state === "verifying" || state === "extracting";

  const actions = modelRowActions(state, error !== undefined);
  const download = () => onDownload(model.id);
  const retry = () => onRetry(model.id);

  const primary = (() => {
    switch (actions.primary) {
      case "download":
        return {
          label: t("settings.models.actions.download", "Download"),
          name: t(
            "settings.models.actions.downloadNamed",
            "Download {{modelName}}",
            { modelName: displayName },
          ),
          run: download,
        };
      case "retry":
        return {
          label: t("common.retry"),
          name: t(
            "settings.models.actions.retryNamed",
            "Retry downloading {{modelName}}",
            { modelName: displayName },
          ),
          run: retry,
        };
      case "activate":
        return {
          label: t("settings.models.actions.activate", "Use"),
          name: t(
            "settings.models.actions.activateNamed",
            "Use {{modelName}}",
            {
              modelName: displayName,
            },
          ),
          run: () => onActivate(model.id),
        };
      case "cancel":
        return {
          label: t("modelSelector.cancel"),
          name: t("modelSelector.cancelDownload"),
          run: () => onCancel(model.id),
        };
      case null:
        return null;
    }
  })();

  const deleteLabel = t("modelSelector.deleteModel", {
    modelName: displayName,
  });

  return (
    <li
      data-state={state}
      className={cn(
        "relative flex flex-col",
        "focus-within:bg-gray-alpha-100 hover:bg-gray-alpha-100",
        state === "active" && "bg-gray-alpha-100",
      )}
    >
      {/* One line, never wrapped: a catalog of 68 rows only reads as a table
       * if every row is the same height and every column starts where the
       * one above it did. The name is the only cell allowed to shrink. */}
      <div className="flex min-h-11 items-center gap-3 px-4 py-2">
        <h3
          title={detail}
          className="min-w-0 flex-1 truncate text-[13px] text-gray-1000"
        >
          {displayName}
        </h3>
        {model.is_recommended ? (
          <span className="flex-none font-mono text-[11px] text-gray-800">
            {t("onboarding.recommended")}
          </span>
        ) : null}
        <span className="w-16 flex-none text-right font-mono text-[11px] tabular-nums text-gray-800">
          {formatModelSize(Number(model.size_mb))}
        </span>
        <span
          aria-live={announce ? "polite" : undefined}
          className={cn(
            "w-36 flex-none text-right font-mono text-[11px] whitespace-nowrap tabular-nums",
            state === "active" ? "text-blue-900" : "text-gray-800",
          )}
        >
          {status}
        </span>

        <div className="flex min-w-[77px] flex-none items-center justify-end gap-1">
          {primary ? (
            <Button
              variant="outline"
              size="sm"
              aria-label={primary.name}
              onClick={primary.run}
            >
              {primary.label}
            </Button>
          ) : null}
          {actions.canDelete ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-gray-800"
                  aria-label={t("settings.models.actions.moreFor", {
                    modelName: displayName,
                  })}
                >
                  <Ellipsis aria-hidden="true" className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  aria-label={deleteLabel}
                  onSelect={() => onDelete(model.id)}
                >
                  {t("common.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="px-4 pb-2 text-[13px] leading-5 text-red-900"
        >
          {error}
        </p>
      ) : null}

      {/* A transfer in flight is the row's only accent: a hairline on its own
       * bottom edge, so a running download never adds a row of height. */}
      {state === "downloading" ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 bg-gray-alpha-200"
        >
          <span
            className="block h-full bg-blue-700"
            style={{
              width: `${Math.min(100, Math.max(0, percentage ?? 0))}%`,
            }}
          />
        </span>
      ) : null}
    </li>
  );
};
