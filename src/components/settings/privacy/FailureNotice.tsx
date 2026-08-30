import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { Button } from "@/components/vg/button";
import { Notice } from "@/components/settings/rows";

/** A failure and the one control that clears it, on one line — not a box. */
export const FailureNotice: React.FC<{
  children: React.ReactNode;
  onRetry?: () => void;
  retryDisabled?: boolean;
  className?: string;
}> = ({ children, onRetry, retryDisabled, className }) => {
  const { t } = useTranslation();

  return (
    <div
      className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1", className)}
    >
      <Notice tone="danger">{children}</Notice>
      {onRetry ? (
        <Button
          variant="link"
          size="xs"
          className="h-auto px-0 text-red-900"
          onClick={onRetry}
          disabled={retryDisabled}
        >
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  );
};
