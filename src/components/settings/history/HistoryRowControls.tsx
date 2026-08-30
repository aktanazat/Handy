import React from "react";
import { Check, ChevronDown, ChevronUp, Copy, Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/vg/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/vg/dropdown-menu";
import type { HistoryRowAction } from "./historyRowActions";

/* One quiet 28px control, the row's unit of chrome. Geist rows do not shout:
 * the icon sits at gray-800 and only reaches full contrast under the pointer. */
const ROW_CONTROL = "size-7 text-gray-800 hover:text-gray-1000";

interface HistoryRowControlsProps {
  actions: HistoryRowAction[];
  hasText: boolean;
  busy: boolean;
  /** True for the two seconds after a copy, while the check mark shows. */
  showCopied: boolean;
  expanded: boolean;
  /** The receipt panel the expander controls, referenced only while it is open. */
  detailsId: string;
  onCopy: () => void;
  onToggleExpanded: () => void;
}

/* Copy, expand and one menu. Everything that changes or destroys the entry is
 * inside the menu, so the row carries three controls rather than six of three
 * different weights. */
export const HistoryRowControls: React.FC<HistoryRowControlsProps> = ({
  actions,
  hasText,
  busy,
  showCopied,
  expanded,
  detailsId,
  onCopy,
  onToggleExpanded,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-none items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className={ROW_CONTROL}
        aria-label={t("settings.history.copyToClipboard")}
        onClick={onCopy}
        disabled={!hasText || busy}
        data-testid="history-entry-copy"
      >
        {showCopied ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={ROW_CONTROL}
        aria-label={
          expanded
            ? t("settings.history.collapseEntry", "Hide full entry")
            : t("settings.history.expandEntry", "Show full entry")
        }
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        aria-controls={expanded ? detailsId : undefined}
        data-testid="history-entry-expand"
      >
        {expanded ? (
          <ChevronUp aria-hidden="true" className="size-4" />
        ) : (
          <ChevronDown aria-hidden="true" className="size-4" />
        )}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={ROW_CONTROL}
            aria-label={t("settings.history.moreActions", "More actions")}
            data-testid="history-entry-actions"
          >
            <Ellipsis aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        {/* No fixed width. The kit's content ships `min-w-[8rem]` and
         * `overflow-x-hidden`, so a pinned `w-48` (168px of text budget) would
         * CLIP, not ellipsize, the longest of these five labels:
         * "Aus Gespeicherten entfernen" (de, 27 chars) and
         * "फेरि ट्रान्सक्राइब गर्नुहोस्" (ne, 28) both need well over 200px, and SF — which is
         * what actually paints today — is ~18% wider than Geist. Sizing to
         * content cannot clip in any of the 24 locales. */}
        <DropdownMenuContent align="end">
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.id}
              disabled={action.disabled}
              variant={action.destructive ? "destructive" : "default"}
              onSelect={action.onSelect}
              data-testid={`history-entry-${action.id}`}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
