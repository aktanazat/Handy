import React, { useState } from "react";
import { Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/vg/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/vg/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/vg/popover";
import { cn } from "@/lib/cn";
import type { ModelOption } from "./types";

const SOURCE_KEYS = {
  provider: "settings.postProcessing.api.model.source.provider",
  cached: "settings.postProcessing.api.model.source.cached",
  saved: "settings.postProcessing.api.model.source.saved",
  manual: "settings.postProcessing.api.model.source.manual",
} as const satisfies Record<ModelOption["source"], string>;

export type ModelSelectProps = {
  value: string;
  options: ModelOption[];
  allowCustom?: boolean;
  disabled?: boolean;
  placeholder?: string;
  isLoading?: boolean;
  onSelect: (value: string) => void;
  onCreate: (value: string) => void;
  /** Requests a catalog only when this selector is intentionally opened. */
  onOpen?: () => void;
  /** Ties the trigger to the field label that names it. */
  id?: string;
  /** The polite discovery state announced with this control. */
  statusId?: string;
  className?: string;
};

/**
 * The one searchable post-processing model chooser. A catalog can suggest
 * IDs, but a provider may still require an intentional manual ID.
 */
export const ModelSelect: React.FC<ModelSelectProps> = React.memo(
  ({
    value,
    options,
    allowCustom = false,
    disabled,
    placeholder,
    isLoading,
    onSelect,
    onCreate,
    onOpen,
    id,
    statusId,
    className,
  }) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");

    const typed = search.trim();
    const creatable =
      allowCustom &&
      typed.length > 0 &&
      !options.some((option) => option.id === typed);
    const selectedLabel =
      options.find((option) => option.id === value)?.label || value;

    const close = () => {
      setOpen(false);
      setSearch("");
    };

    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) onOpen?.();
          else setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-busy={isLoading || undefined}
            aria-describedby={statusId}
            disabled={disabled}
            className={cn("w-full justify-between font-normal", className)}
          >
            <span className={cn("truncate", !value && "text-gray-700")}>
              {value ? selectedLabel : placeholder}
            </span>
            {isLoading ? (
              <Loader2 aria-hidden="true" className="animate-spin opacity-50" />
            ) : (
              <ChevronDown aria-hidden="true" className="opacity-50" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) p-0"
        >
          <Command>
            <CommandInput
              autoFocus
              aria-label={t("settings.postProcessing.api.model.search")}
              value={search}
              onValueChange={setSearch}
              placeholder={placeholder}
            />
            <CommandList>
              <CommandEmpty>{t("common.noOptionsFound")}</CommandEmpty>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  keywords={
                    option.label === option.id ? undefined : [option.label]
                  }
                  onSelect={() => {
                    close();
                    onSelect(option.id);
                  }}
                >
                  <Check
                    aria-hidden="true"
                    className={
                      value === option.id ? "opacity-100" : "opacity-0"
                    }
                  />
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    <span className="shrink-0 text-xs text-gray-800">
                      {t(SOURCE_KEYS[option.source])}
                    </span>
                  </span>
                </CommandItem>
              ))}
              {creatable ? (
                <CommandItem
                  value={typed}
                  onSelect={() => {
                    close();
                    onCreate(typed);
                  }}
                >
                  <Plus aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {t("settings.postProcessing.api.model.useCustom", {
                        modelId: typed,
                      })}
                    </span>
                    <span className="shrink-0 text-xs text-gray-800">
                      {t(SOURCE_KEYS.manual)}
                    </span>
                  </span>
                </CommandItem>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  },
);

ModelSelect.displayName = "ModelSelect";
