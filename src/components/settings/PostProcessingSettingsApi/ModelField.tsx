import React, { useId } from "react";
import { RefreshCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Notice } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { cn } from "@/lib/cn";
import { ModelSelect } from "./ModelSelect";
import type { ModelOption } from "./types";

export type ModelFieldProps = {
  /** The id the surrounding field's label points at. */
  id: string;
  value: string;
  options: ModelOption[];
  /** The catalog says this provider accepts an id it did not list. */
  allowCustom: boolean;
  /** A write is in flight, or the whole feature is off. */
  disabled?: boolean;
  isLoading: boolean;
  /** Discovery state, already ordered; empty means there is nothing to say. */
  statusKeys: string[];
  onSelect: (modelId: string) => void;
  onCreate: (modelId: string) => void;
  /** For a chooser that asks for a catalog only when it is opened. */
  onOpen?: () => void;
  onRefresh: () => void;
};

/**
 * The model chooser as both surfaces use it: the searchable select, the
 * refresh beside it, and the one line of discovery state that names the
 * control through `aria-describedby`.
 *
 * The global provider form and a mode's explicit override each rendered their
 * own copy of this, and the copies drifted: only one offered lazy discovery,
 * they disabled refresh on different conditions, and the mode's status element
 * carried a fixed id that repeats as soon as two editors mount.
 */
export const ModelField: React.FC<ModelFieldProps> = ({
  id,
  value,
  options,
  allowCustom,
  disabled = false,
  isLoading,
  statusKeys,
  onSelect,
  onCreate,
  onOpen,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const fieldId = useId();
  const statusId = `${fieldId}-model-status`;
  const hasStatus = statusKeys.length > 0;

  return (
    <>
      <div className="flex items-center gap-2">
        <ModelSelect
          id={id}
          value={value}
          options={options}
          allowCustom={allowCustom}
          disabled={disabled}
          isLoading={isLoading}
          statusId={hasStatus ? statusId : undefined}
          placeholder={
            options.length > 0
              ? t("settings.postProcessing.api.model.placeholderWithOptions")
              : t("settings.postProcessing.api.model.placeholderNoOptions")
          }
          onSelect={onSelect}
          onCreate={onCreate}
          onOpen={onOpen}
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("settings.postProcessing.api.model.refreshModels")}
          onClick={onRefresh}
          disabled={disabled || isLoading}
        >
          <RefreshCcw
            aria-hidden="true"
            className={cn(isLoading && "animate-spin")}
          />
        </Button>
      </div>
      {hasStatus ? (
        <div id={statusId} className="pt-1">
          <Notice>{statusKeys.map((key) => t(key)).join(" ")}</Notice>
        </div>
      ) : null}
    </>
  );
};
