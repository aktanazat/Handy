import React, { useCallback, useState } from "react";
import { Input } from "@/components/vg/input";

interface ApiKeyFieldProps {
  onCommit: (value: string) => Promise<boolean>;
  disabled: boolean;
  placeholder?: string;
  /** Ties the input to the field label that names it. */
  id?: string;
}

export const ApiKeyField: React.FC<ApiKeyFieldProps> = React.memo(
  ({ onCommit, disabled, placeholder, id }) => {
    const [localValue, setLocalValue] = useState("");

    const commit = useCallback(async () => {
      const value = localValue;
      setLocalValue("");
      if (!value.trim()) {
        return;
      }
      await onCommit(value);
    }, [localValue, onCommit]);

    return (
      <Input
        id={id}
        type="password"
        value={localValue}
        onChange={(event) => setLocalValue(event.target.value)}
        onBlur={() => void commit()}
        autoComplete="new-password"
        placeholder={placeholder}
        disabled={disabled}
        className="h-8 min-w-0 flex-1"
      />
    );
  },
);

ApiKeyField.displayName = "ApiKeyField";
