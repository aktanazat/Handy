import React from "react";
import { useTranslation } from "react-i18next";
import type { ModelInfo } from "@/bindings";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/vg/command";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "@/lib/utils/modelTranslation";

interface ModelDropdownProps {
  models: ModelInfo[];
  currentModelId: string;
  onModelSelect: (modelId: string) => void;
}

/**
 * The switcher's list: one command row per downloaded model.
 *
 * The filter field is not decoration — cmdk routes arrow keys through its
 * input, so without it the list is unreachable from the keyboard. The active
 * model is spelled out rather than ticked, so the state survives greyscale.
 */
const ModelDropdown: React.FC<ModelDropdownProps> = ({
  models,
  currentModelId,
  onModelSelect,
}) => {
  const { t } = useTranslation();
  const downloadedModels = models.filter((model) => model.is_downloaded);

  return (
    <Command label={t("modelSelector.model")}>
      <CommandInput placeholder={t("modelSelector.searchPlaceholder")} />
      <CommandList>
        <CommandEmpty>{t("modelSelector.noModelsAvailable")}</CommandEmpty>
        {downloadedModels.map((model) => {
          const name = getTranslatedModelName(model, t);
          const description = getTranslatedModelDescription(model, t);
          return (
            <CommandItem
              key={model.id}
              value={`${name} ${description}`}
              aria-selected={currentModelId === model.id}
              onSelect={() => onModelSelect(model.id)}
              className="flex-col items-start gap-0.5"
            >
              <span className="flex w-full min-w-0 items-center gap-2">
                <span className="min-w-0 truncate text-[13px] text-gray-1000">
                  {name}
                </span>
                {currentModelId === model.id ? (
                  <span className="ml-auto flex-none font-mono text-[10px] uppercase tracking-[0.12em] text-blue-900">
                    {t("modelSelector.active")}
                  </span>
                ) : null}
              </span>
              <span
                title={description}
                className="w-full truncate text-[12px] text-gray-800"
              >
                {description}
              </span>
            </CommandItem>
          );
        })}
      </CommandList>
    </Command>
  );
};

export default ModelDropdown;
