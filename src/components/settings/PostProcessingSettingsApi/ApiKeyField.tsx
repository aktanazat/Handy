import React, { useCallback, useState } from "react";
import { Input } from "../../ui/Input";

interface ApiKeyFieldProps {
  onCommit: (value: string) => Promise<boolean>;
  disabled: boolean;
  placeholder?: string;
  className?: string;
}

export const ApiKeyField: React.FC<ApiKeyFieldProps> = React.memo(
  ({ onCommit, disabled, placeholder, className = "" }) => {
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
        type="password"
        value={localValue}
        onChange={(event) => setLocalValue(event.target.value)}
        onBlur={() => void commit()}
        autoComplete="new-password"
        placeholder={placeholder}
        variant="compact"
        disabled={disabled}
        className={`w-full min-w-0 flex-1 ${className}`}
      />
    );
  },
);

ApiKeyField.displayName = "ApiKeyField";
