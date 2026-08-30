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

type ModelSelectProps = {
  value: string;
  options: ModelOption[];
  disabled?: boolean;
  placeholder?: string;
  isLoading?: boolean;
  onSelect: (value: string) => void;
  onCreate: (value: string) => void;
  /** Ties the trigger to the field label that names it. */
  id?: string;
  className?: string;
};

/**
 * The post-processing model, as a searchable list that also accepts a name the
 * list does not have.
 *
 * A Command inside a Popover rather than a Select, because naming a model the
 * endpoint was never asked to enumerate is the whole custom-provider flow: a
 * local llama.cpp or vLLM server, or a provider whose key is not saved yet,
 * returns no options at all, and a plain Select would leave that install with
 * no way to say which model to call.
 */
export const ModelSelect: React.FC<ModelSelectProps> = React.memo(
  ({
    value,
    options,
    disabled,
    placeholder,
    isLoading,
    onSelect,
    onCreate,
    id,
    className,
  }) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");

    const typed = search.trim();
    /* Offered only for a name no option already carries, so the list never
     * shows the same model twice. */
    const creatable =
      typed.length > 0 && !options.some((option) => option.value === typed);

    const close = () => {
      setOpen(false);
      setSearch("");
    };

    const selectedLabel =
      options.find((option) => option.value === value)?.label || value;

    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch("");
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
            {/* cmdk filters on each item's `value`, and a model's id is also
                the name a reader types, so the two are the same string. */}
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder={placeholder}
            />
            <CommandList>
              <CommandEmpty>{t("common.noOptionsFound")}</CommandEmpty>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    close();
                    onSelect(option.value);
                  }}
                >
                  <Check
                    aria-hidden="true"
                    className={
                      value === option.value ? "opacity-100" : "opacity-0"
                    }
                  />
                  <span className="truncate">{option.label}</span>
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
                  <span className="truncate">{`Use "${typed}"`}</span>
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
