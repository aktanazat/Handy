import React, { Suspense, lazy } from "react";
import { Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ModeView } from "@/bindings";
import { Button } from "@/components/vg/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/vg/dropdown-menu";
import { cn } from "@/lib/cn";
import type { OSType } from "@/lib/utils/keyboard";
import { SettingsSurface } from "@/components/settings/rows";
import { ShortcutChord } from "./ModeControls";
import { isPresetMode, modeEngineLabel, modeRowActions } from "./modeModel";
import type { ModeReorderRow } from "./ModesReorder";

/* Dragging costs Motion's full feature set (see ModesReorder.tsx), so it loads
 * on demand. The Suspense fallback is the same list without the drag: rows,
 * menus and the move up/down items are all there, which is also what a keyboard
 * user gets either way. */
const ModesReorder = lazy(() => import("./ModesReorder"));

export interface ModesListProps {
  modes: readonly ModeView[];
  activeModeId: string;
  selectedModeId: string | null;
  /** A mutation is in flight: every revisioned action has to wait for it. */
  busy: boolean;
  osType: OSType;
  onSelect: (mode: ModeView) => void;
  onActivate: (modeId: string) => void;
  onDuplicate: (mode: ModeView) => void;
  onMove: (modeId: string, direction: -1 | 1) => void;
  /** A drop: the whole order, which is what the backend command takes. */
  onReorder: (orderedIds: string[]) => void;
  onRequestDelete: (mode: ModeView) => void;
  onReload: () => void;
}

interface ModeRowBodyProps {
  mode: ModeView;
  /** Position in the list: the move items at either end have nowhere to go. */
  index: number;
  count: number;
  osType: OSType;
  busy: boolean;
  isActive: boolean;
  isSelected: boolean;
  onSelect: (mode: ModeView) => void;
  onActivate: (modeId: string) => void;
  onDuplicate: (mode: ModeView) => void;
  onMove: (modeId: string, direction: -1 | 1) => void;
  onRequestDelete: (mode: ModeView) => void;
}

/* Everything inside a row, on one line: the name, the one word of state, the
 * engine, the dictation chord. Model, language and delivery are the editor's —
 * printing them here as well was the same four values twice on one screen.
 *
 * One definition, rendered by both the draggable list and the plain one, so
 * the two can never drift apart. */
const ModeRowBody: React.FC<ModeRowBodyProps> = ({
  mode,
  index,
  count,
  osType,
  busy,
  isActive,
  isSelected,
  onSelect,
  onActivate,
  onDuplicate,
  onMove,
  onRequestDelete,
}) => {
  const { t } = useTranslation();
  const actionsLabel = t("settings.modes.actionsFor", { mode: mode.name });
  const actions = modeRowActions(mode, { index, count, isActive, busy, t });
  const run = {
    activate: () => onActivate(mode.id),
    duplicate: () => onDuplicate(mode),
    moveUp: () => onMove(mode.id, -1),
    moveDown: () => onMove(mode.id, 1),
    delete: () => onRequestDelete(mode),
  } as const;

  return (
    <>
      <button
        type="button"
        aria-current={isSelected ? "true" : undefined}
        onClick={() => onSelect(mode)}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left",
          "hover:bg-gray-alpha-100 group-data-[dragging]/list:hover:bg-transparent",
          "focus-visible:-outline-offset-2 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none",
        )}
      >
        <span
          className={cn(
            "min-w-0 truncate text-[13px] text-gray-1000",
            isActive && "font-medium",
          )}
        >
          {mode.name}
        </span>
        {/* The four modes Sona ships with read as presets: a starting point,
         * not a fixture. Everything else about the row is identical, because
         * everything else about the mode is. */}
        {isPresetMode(mode.id) ? (
          <span className="flex-none text-[11px] text-gray-700">
            {t("modesV2.list.preset")}
          </span>
        ) : null}
        {/* The one word of state the list carries. Spelled out, so it survives
         * greyscale and reads as a marker rather than as content. */}
        {isActive ? (
          <span className="flex-none text-[13px] leading-5 text-blue-900">
            {t("settings.modes.active")}
          </span>
        ) : null}
        <span className="ml-auto flex-none text-[11px] text-gray-800">
          {modeEngineLabel(mode.asr, t)}
        </span>
        <ShortcutChord
          compact
          className="flex-none"
          chord={mode.shortcuts.transcribe.current_binding}
          osType={osType}
        />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="mr-1.5 size-7 flex-none text-gray-800"
            aria-label={actionsLabel}
            title={actionsLabel}
          >
            <Ellipsis aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.id}
              disabled={action.disabled}
              variant={action.destructive ? "destructive" : "default"}
              onSelect={run[action.id]}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};

export const ModesList: React.FC<ModesListProps> = ({
  modes,
  activeModeId,
  selectedModeId,
  busy,
  osType,
  onSelect,
  onActivate,
  onDuplicate,
  onMove,
  onReorder,
  onRequestDelete,
  onReload,
}) => {
  const { t } = useTranslation();
  /* The visible heading is gone — the page title and the view tab both already
   * say "Modes" — but the list keeps its name for assistive tech and for
   * role-based selectors. */
  const listLabel = t("settings.modes.listTitle");

  if (modes.length === 0) {
    /* Sona keeps one mode at all times, so an empty list is a read failure
     * rather than a blank slate: say so, and pair it with the reload. */
    return (
      <SettingsSurface className="flex flex-col items-start gap-2 px-4 py-6">
        <p className="text-sm text-gray-1000">
          {t("settings.modes.listEmpty", "No modes are configured.")}
        </p>
        <p className="text-[13px] leading-5 text-gray-800">
          {t(
            "settings.modes.listEmptyHint",
            "Sona always keeps one mode. Reload to fetch the current list.",
          )}
        </p>
        <Button variant="outline" size="sm" onClick={onReload}>
          {t("settings.modes.retry")}
        </Button>
      </SettingsSurface>
    );
  }

  const rows: ModeReorderRow[] = modes.map((mode, index) => ({
    id: mode.id,
    active: mode.id === activeModeId,
    selected: selectedModeId === mode.id,
    body: (
      <ModeRowBody
        mode={mode}
        index={index}
        count={modes.length}
        osType={osType}
        busy={busy}
        isActive={mode.id === activeModeId}
        isSelected={selectedModeId === mode.id}
        onSelect={onSelect}
        onActivate={onActivate}
        onDuplicate={onDuplicate}
        onMove={onMove}
        onRequestDelete={onRequestDelete}
      />
    ),
  }));

  return (
    <SettingsSurface>
      <Suspense
        fallback={
          <ul
            aria-label={listLabel}
            className="group/list divide-y divide-gray-alpha-400"
          >
            {rows.map((row) => (
              <li
                key={row.id}
                data-selected={row.selected || undefined}
                className={cn(
                  "flex items-center",
                  row.selected && "bg-gray-alpha-100",
                )}
              >
                {row.body}
              </li>
            ))}
          </ul>
        }
      >
        <ModesReorder
          rows={rows}
          label={listLabel}
          disabled={busy}
          onCommit={onReorder}
        />
      </Suspense>
    </SettingsSurface>
  );
};
