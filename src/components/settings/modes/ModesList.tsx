import React, { Suspense, lazy } from "react";
import { Ellipsis, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ModelInfo, ModeView } from "@/bindings";
import { Button, EmptyState, IconButton } from "@/components/ui";
import type { OSType } from "@/lib/utils/keyboard";
import { ShortcutChord } from "./ModeControls";
import { DEFAULT_MODE_ID, modeConfigSummary } from "./modeModel";
import type { ModeReorderRow } from "./ModesReorder";

/* Dragging costs Motion's full feature set (see ModesReorder.tsx), so it loads
 * on demand. The Suspense fallback is the same list without the drag: rows,
 * menus and the move up/down items are all there, which is also what a keyboard
 * user gets either way. */
const ModesReorder = lazy(() => import("./ModesReorder"));

export interface ModesListProps {
  modes: readonly ModeView[];
  /** Resolves each mode's `model_id`, which is a repo path, to a name. */
  models: readonly ModelInfo[];
  activeModeId: string;
  selectedModeId: string | null;
  /** A mutation is in flight: every revisioned action has to wait for it. */
  busy: boolean;
  osType: OSType;
  onSelect: (mode: ModeView) => void;
  onCreate: () => void;
  onActivate: (modeId: string) => void;
  onDuplicate: (mode: ModeView) => void;
  onMove: (modeId: string, direction: -1 | 1) => void;
  /** A drop: the whole order, which is what the backend command takes. */
  onReorder: (orderedIds: string[]) => void;
  onRequestDelete: (mode: ModeView) => void;
  onReload: () => void;
}

/* The menu is a details/summary popover. Closing it after a choice keeps the
 * next click on the list rather than on a stale menu. */
const closeMenu = (target: HTMLElement) => {
  const menu = target.closest("details");
  if (menu) menu.open = false;
};

interface ModeRowBodyProps {
  mode: ModeView;
  /** Position in the list: the move items at either end have nowhere to go. */
  index: number;
  count: number;
  models: readonly ModelInfo[];
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

/* Everything inside a row. One definition, rendered by both the draggable list
 * and the plain one, so the two can never drift apart. */
const ModeRowBody: React.FC<ModeRowBodyProps> = ({
  mode,
  index,
  count,
  models,
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
  const isDefault = mode.id === DEFAULT_MODE_ID;
  const actionsLabel = t("settings.modes.actionsFor", { mode: mode.name });
  /* engine · model · language · delivery, on one truncating line: the row
   * exposes what a run in this mode will actually do without anyone opening
   * the editor. */
  const config = modeConfigSummary(mode, t, models);

  return (
    <>
      <button
        type="button"
        className="modes-list-button"
        aria-current={isSelected ? "true" : undefined}
        onClick={() => onSelect(mode)}
      >
        <span className="modes-list-headline">
          <span className="modes-list-name type-row-title">{mode.name}</span>
          {isActive ? (
            /* The one word of state the list carries, worn as the same small
             * accent chip the model menu uses. It survives greyscale as a
             * spelled word, and it sits beside the name rather than pushing a
             * second line under it. */
            <span className="modes-list-active">
              {t("settings.modes.active")}
            </span>
          ) : null}
          <ShortcutChord
            compact
            chord={mode.shortcuts.transcribe.current_binding}
            osType={osType}
          />
        </span>
        <span className="modes-list-config type-data" title={config}>
          {config}
        </span>
      </button>
      <details className="mode-actions-menu">
        <summary aria-label={actionsLabel} title={actionsLabel}>
          <Ellipsis aria-hidden="true" className="h-4 w-4" />
        </summary>
        <div role="menu">
          {isActive ? null : (
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={(event) => {
                onActivate(mode.id);
                closeMenu(event.currentTarget);
              }}
            >
              {t("settings.modes.activate")}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={(event) => {
              onDuplicate(mode);
              closeMenu(event.currentTarget);
            }}
          >
            {t("settings.modes.duplicate")}
          </button>
          {/* The keyboard route to the same reorder the pointer drags. It is
           * the only route for anyone not using a pointer, so it stays
           * exactly as it was. */}
          <button
            type="button"
            role="menuitem"
            disabled={busy || index === 0}
            onClick={(event) => {
              onMove(mode.id, -1);
              closeMenu(event.currentTarget);
            }}
          >
            {t("settings.modes.moveUp")}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy || index === count - 1}
            onClick={(event) => {
              onMove(mode.id, 1);
              closeMenu(event.currentTarget);
            }}
          >
            {t("settings.modes.moveDown")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger-menu-item"
            disabled={busy || isDefault}
            onClick={(event) => {
              onRequestDelete(mode);
              closeMenu(event.currentTarget);
            }}
          >
            {isDefault
              ? t("settings.modes.defaultProtected")
              : t("settings.modes.delete")}
          </button>
        </div>
      </details>
    </>
  );
};

export const ModesList: React.FC<ModesListProps> = ({
  modes,
  models,
  activeModeId,
  selectedModeId,
  busy,
  osType,
  onSelect,
  onCreate,
  onActivate,
  onDuplicate,
  onMove,
  onReorder,
  onRequestDelete,
  onReload,
}) => {
  const { t } = useTranslation();

  const rows: ModeReorderRow[] = modes.map((mode, index) => ({
    id: mode.id,
    active: mode.id === activeModeId,
    selected: selectedModeId === mode.id,
    body: (
      <ModeRowBody
        mode={mode}
        index={index}
        count={modes.length}
        models={models}
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
    <aside className="modes-master" aria-labelledby="modes-list-heading">
      <div className="modes-master-heading">
        <h2 id="modes-list-heading">{t("settings.modes.listTitle")}</h2>
        <div className="modes-master-actions">
          <span className="microlabel modes-master-count">{modes.length}</span>
          <IconButton
            size="sm"
            className="modes-add-button"
            label={t("settings.modes.new")}
            icon={<Plus aria-hidden="true" className="h-4 w-4" />}
            disabled={busy || modes.length === 0}
            onClick={onCreate}
          />
        </div>
      </div>

      {modes.length === 0 ? (
        /* Sona keeps one mode at all times, so an empty list is a read
         * failure rather than a blank slate: the error variant says so and
         * pairs the sentence with the reload that fixes it. */
        <EmptyState
          variant="error"
          title={t("settings.modes.listEmpty", "No modes are configured.")}
          description={t(
            "settings.modes.listEmptyHint",
            "Sona always keeps one mode. Reload to fetch the current list.",
          )}
          action={
            <Button variant="secondary" size="sm" onClick={onReload}>
              {t("settings.modes.retry")}
            </Button>
          }
        />
      ) : (
        <Suspense
          fallback={
            <ul className="modes-list">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="modes-list-row"
                  data-selected={row.selected || undefined}
                  data-active={row.active || undefined}
                >
                  {row.body}
                </li>
              ))}
            </ul>
          }
        >
          <ModesReorder rows={rows} disabled={busy} onCommit={onReorder} />
        </Suspense>
      )}
    </aside>
  );
};
