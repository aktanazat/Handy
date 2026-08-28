import React from "react";
import { Ellipsis, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ModeView } from "@/bindings";
import { Button, EmptyState, IconButton } from "@/components/ui";
import type { OSType } from "@/lib/utils/keyboard";
import { ShortcutChord } from "./ModeControls";
import { DEFAULT_MODE_ID } from "./modeModel";

export interface ModesListProps {
  modes: readonly ModeView[];
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
  onRequestDelete: (mode: ModeView) => void;
  onReload: () => void;
}

/* The menu is a details/summary popover. Closing it after a choice keeps the
 * next click on the list rather than on a stale menu. */
const closeMenu = (target: HTMLElement) => {
  const menu = target.closest("details");
  if (menu) menu.open = false;
};

export const ModesList: React.FC<ModesListProps> = ({
  modes,
  activeModeId,
  selectedModeId,
  busy,
  osType,
  onSelect,
  onCreate,
  onActivate,
  onDuplicate,
  onMove,
  onRequestDelete,
  onReload,
}) => {
  const { t } = useTranslation();

  return (
    <aside className="modes-master" aria-labelledby="modes-list-heading">
      <div className="modes-master-heading">
        <h2 id="modes-list-heading">{t("settings.modes.listTitle")}</h2>
        <div className="modes-master-actions">
          <span>{modes.length}</span>
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
        <EmptyState
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
        <ul className="modes-list">
          {modes.map((mode, index) => {
            const isActive = mode.id === activeModeId;
            const isDefault = mode.id === DEFAULT_MODE_ID;
            const isSelected = selectedModeId === mode.id;
            const actionsLabel = t("settings.modes.actionsFor", {
              mode: mode.name,
            });
            return (
              <li
                key={mode.id}
                className="modes-list-row"
                data-selected={isSelected || undefined}
                data-active={isActive || undefined}
              >
                <button
                  type="button"
                  className="modes-list-button"
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() => onSelect(mode)}
                >
                  <span className="modes-list-name">{mode.name}</span>
                  <span className="modes-list-meta">
                    {isActive ? (
                      <span className="modes-list-active">
                        {t("settings.modes.active")}
                      </span>
                    ) : null}
                    <ShortcutChord
                      chord={mode.shortcuts.transcribe.current_binding}
                      osType={osType}
                    />
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
                      disabled={busy || index === modes.length - 1}
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
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
};
