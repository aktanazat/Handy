import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import type { ProviderOption } from "./types";

interface ProviderSelectProps {
  options: ProviderOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Ties the trigger to the field label that names it. */
  id?: string;
}

export const ProviderSelect: React.FC<ProviderSelectProps> = React.memo(
  ({ options, value, onChange, disabled, id }) => {
    /* A stored provider id with no matching option is still the chosen value —
     * a list that has not enumerated yet — so the raw id stands in for a name
     * this layer does not have. Radix takes the trigger's text from a mounted
     * item, which does not exist until the menu opens, so it is resolved here
     * rather than left to the item. */
    const selectedLabel =
      options.find((option) => option.value === value)?.label || value;

    return (
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} size="sm" className="w-full">
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  },
);

ProviderSelect.displayName = "ProviderSelect";
