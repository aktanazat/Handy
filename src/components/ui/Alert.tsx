import React from "react";
import { AlertCircle, AlertTriangle, Info, CheckCircle } from "lucide-react";

type AlertVariant = "error" | "warning" | "info" | "success";

interface AlertProps {
  variant?: AlertVariant;
  /** When true, removes rounded corners for use inside containers */
  contained?: boolean;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<
  AlertVariant,
  { container: string; icon: string; text: string }
> = {
  error: {
    container: "border-border bg-surface",
    icon: "text-danger",
    text: "text-text-primary",
  },
  warning: {
    container: "border-border bg-surface",
    icon: "text-text-secondary",
    text: "text-text-primary",
  },
  info: {
    container: "border-border bg-surface",
    icon: "text-text-secondary",
    text: "text-text-primary",
  },
  success: {
    container: "border-border bg-surface",
    icon: "text-text-secondary",
    text: "text-text-primary",
  },
};

const variantIcons: Record<AlertVariant, React.ElementType> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle,
};

export const Alert: React.FC<AlertProps> = ({
  variant = "error",
  contained = false,
  children,
  className = "",
}) => {
  const styles = variantStyles[variant];
  const Icon = variantIcons[variant];

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`flex items-start gap-2.5 border p-3 ${styles.container} ${contained ? "border-x-0 rounded-none" : "rounded-md"} ${className}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${styles.icon}`} />
      <p className={`text-sm leading-5 ${styles.text}`}>{children}</p>
    </div>
  );
};
