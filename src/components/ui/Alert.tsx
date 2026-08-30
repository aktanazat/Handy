import React from "react";
import { AlertCircle, AlertTriangle, Info, CheckCircle } from "lucide-react";

export type AlertVariant = "error" | "warning" | "info" | "success";

export interface AlertProps {
  variant?: AlertVariant;
  /** When true, removes rounded corners for use inside containers */
  contained?: boolean;
  /** One control, right-aligned: usually a retry or a dismiss. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

interface AlertStyle {
  container: string;
  icon: string;
  text: string;
}

/* `satisfies` rather than an annotation: it still proves the map covers every
 * `AlertVariant` and rejects a stray one, while keeping the literal key set so
 * the lookups below stay total without a fallback. */
const variantStyles = {
  error: {
    container: "border-border bg-surface-raised",
    icon: "text-danger-strong",
    text: "text-text-primary",
  },
  warning: {
    container: "border-border bg-surface-raised",
    icon: "text-text-secondary",
    text: "text-text-primary",
  },
  info: {
    container: "border-border bg-surface-raised",
    icon: "text-text-secondary",
    text: "text-text-primary",
  },
  success: {
    container: "border-border bg-surface-raised",
    icon: "text-text-secondary",
    text: "text-text-primary",
  },
} satisfies Record<AlertVariant, AlertStyle>;

const variantIcons = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle,
} satisfies Record<AlertVariant, React.ElementType>;

export const Alert: React.FC<AlertProps> = ({
  variant = "error",
  contained = false,
  action,
  children,
  className = "",
}) => {
  const styles = variantStyles[variant];
  const Icon = variantIcons[variant];

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`flex items-start gap-2.5 border p-3 ${styles.container} ${contained ? "border-x-0 rounded-none" : "rounded-control"} ${className}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${styles.icon}`} />
      <p className={`min-w-0 flex-1 text-[13px] leading-[19px] ${styles.text}`}>
        {children}
      </p>
      {action && <div className="flex flex-none items-center">{action}</div>}
    </div>
  );
};
