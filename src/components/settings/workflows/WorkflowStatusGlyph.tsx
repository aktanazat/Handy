import React from "react";
import { Check, Minus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorkflowRunStatus } from "@/bindings";
import { cn } from "@/lib/cn";

interface WorkflowStatusGlyphProps {
  status: WorkflowRunStatus;
  className?: string;
}

const STATUS_TONE = {
  ok: "text-gray-900",
  failed: "text-red-900",
  skipped: "text-gray-700",
} as const satisfies Record<WorkflowRunStatus, string>;

export const WorkflowStatusGlyph: React.FC<WorkflowStatusGlyphProps> = ({
  status,
  className,
}) => {
  const { t } = useTranslation();
  const Icon = status === "ok" ? Check : status === "failed" ? X : Minus;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center",
        STATUS_TONE[status],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">
        {t(`settings.workflows.status.${status}`)}
      </span>
    </span>
  );
};
