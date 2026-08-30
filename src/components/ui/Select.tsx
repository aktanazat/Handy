import React from "react";
import SelectComponent from "react-select";
import CreatableSelect from "react-select/creatable";
import type {
  ActionMeta,
  Props as ReactSelectProps,
  SingleValue,
  StylesConfig,
} from "react-select";

export type SelectOption = {
  value: string;
  label: string;
  isDisabled?: boolean;
};

type BaseProps = {
  value: string | null;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  isClearable?: boolean;
  onChange: (value: string | null, action: ActionMeta<SelectOption>) => void;
  onBlur?: () => void;
  className?: string;
  formatCreateLabel?: (input: string) => string;
};

type CreatableProps = {
  isCreatable: true;
  onCreateOption: (value: string) => void;
};

type NonCreatableProps = {
  isCreatable?: false;
  onCreateOption?: never;
};

export type SelectProps = BaseProps & (CreatableProps | NonCreatableProps);

const selectStyles: StylesConfig<SelectOption, false> = {
  control: (base, state) => ({
    ...base,
    minHeight: 32,
    borderRadius: "var(--radius-control)",
    borderColor: state.isFocused
      ? "var(--color-accent-strong)"
      : "var(--color-border)",
    boxShadow: state.isFocused ? "0 0 0 2px var(--color-focus-soft)" : "none",
    backgroundColor: "var(--color-control)",
    color: "var(--color-text-primary)",
    fontSize: 13,
    transition:
      "background-color var(--duration-fast) var(--ease-in-out), border-color var(--duration-fast) var(--ease-in-out), box-shadow var(--duration-fast) var(--ease-in-out)",
    ":hover": {
      borderColor: state.isFocused
        ? "var(--color-accent-strong)"
        : "var(--color-border-strong)",
      backgroundColor: state.isFocused
        ? "var(--color-control)"
        : "var(--color-hover)",
    },
  }),
  valueContainer: (base) => ({
    ...base,
    paddingInline: "var(--space-2-5)",
    paddingBlock: 0,
  }),
  input: (base) => ({
    ...base,
    color: "var(--color-text-primary)",
  }),
  singleValue: (base) => ({
    ...base,
    color: "var(--color-text-primary)",
  }),
  dropdownIndicator: (base) => ({
    ...base,
    color: "var(--color-text-secondary)",
    ":hover": { color: "var(--color-text-primary)" },
  }),
  clearIndicator: (base) => ({
    ...base,
    color: "var(--color-text-secondary)",
    ":hover": { color: "var(--color-text-primary)" },
  }),
  menu: (base) => ({
    ...base,
    zIndex: 30,
    backgroundColor: "var(--color-surface-raised)",
    color: "var(--color-text-primary)",
    /* The 1px ring leading --shadow-popover is the menu's edge; a painted
       border on top of it would draw a 2px double edge. Width kept so the
       box does not shift against the glass-popover pattern. */
    border: "1px solid transparent",
    borderRadius: "var(--radius-panel)",
    boxShadow: "var(--shadow-popover)",
  }),
  option: (base, state) => ({
    ...base,
    minHeight: 36,
    backgroundColor: state.isSelected
      ? "var(--color-accent-soft)"
      : state.isFocused
        ? "var(--color-hover)"
        : "transparent",
    color: "var(--color-text-primary)",
    fontWeight: state.isSelected ? 500 : 400,
    cursor: state.isDisabled ? "not-allowed" : "pointer",
    opacity: state.isDisabled ? 0.5 : 1,
  }),
  placeholder: (base) => ({
    ...base,
    color: "var(--color-text-tertiary)",
  }),
};

export const Select: React.FC<SelectProps> = React.memo(
  ({
    value,
    options,
    placeholder,
    disabled,
    isLoading,
    isClearable = true,
    onChange,
    onBlur,
    className = "",
    isCreatable,
    formatCreateLabel,
    onCreateOption,
  }) => {
    const selectValue = React.useMemo(() => {
      if (!value) return null;
      const existing = options.find((option) => option.value === value);
      if (existing) return existing;
      return { value, label: value, isDisabled: false };
    }, [value, options]);

    const handleChange = (
      option: SingleValue<SelectOption>,
      action: ActionMeta<SelectOption>,
    ) => {
      onChange(option?.value ?? null, action);
    };

    const sharedProps: Partial<ReactSelectProps<SelectOption, false>> = {
      className,
      classNamePrefix: "app-select",
      value: selectValue,
      options,
      onChange: handleChange,
      placeholder,
      isDisabled: disabled,
      isLoading,
      onBlur,
      isClearable,
      styles: selectStyles,
    };

    if (isCreatable) {
      return (
        <CreatableSelect<SelectOption, false>
          {...sharedProps}
          onCreateOption={onCreateOption}
          formatCreateLabel={formatCreateLabel}
        />
      );
    }

    return <SelectComponent<SelectOption, false> {...sharedProps} />;
  },
);

Select.displayName = "Select";
