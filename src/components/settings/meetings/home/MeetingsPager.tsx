import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/vg/button";

interface MeetingsPagerProps {
  loading: boolean;
  paging: boolean;
  hasMore: boolean;
  page: number;
  onNextPage: () => void;
  onPreviousPage: () => void;
}

export const MeetingsPager: React.FC<MeetingsPagerProps> = ({
  loading,
  paging,
  hasMore,
  page,
  onNextPage,
  onPreviousPage,
}) => {
  const { t } = useTranslation();
  if (loading || (page === 1 && !hasMore)) return null;

  return (
    <div className="flex items-center justify-end border-t border-gray-alpha-400 py-2">
      <span className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onPreviousPage}
          disabled={page === 1 || paging}
        >
          <ChevronLeft aria-hidden="true" className="size-3.5 rtl:rotate-180" />
          {t("meetings.list.previousPage", "Newer")}
        </Button>
        <span className="snap-measured px-1 text-[13px] leading-[18px] text-gray-900 tabular-nums">
          {t("meetings.list.pagePosition", "Page {{page}}", { page })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onNextPage}
          disabled={!hasMore || paging}
        >
          {t("meetings.list.nextPage", "Older")}
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 rtl:rotate-180"
          />
        </Button>
      </span>
    </div>
  );
};
