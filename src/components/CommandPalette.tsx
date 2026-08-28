import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import type { CommandPaletteAction } from "./commandPaletteActions";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  actions: CommandPaletteAction[];
}

interface CommandPaletteGroup {
  label: string;
  items: CommandPaletteAction[];
}

const ICON_SIZE = 16;

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  actions,
}) => {
  const [version, setVersion] = useState("");

  useEffect(() => {
    let active = true;
    void getVersion()
      .then((appVersion) => {
        if (active) setVersion(appVersion);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return open ? (
    <CommandPaletteDialog
      onClose={onClose}
      actions={actions}
      version={version}
    />
  ) : null;
};

interface CommandPaletteDialogProps
  extends Omit<CommandPaletteProps, "open"> {
  version: string;
}

const CommandPaletteDialog: React.FC<CommandPaletteDialogProps> = ({
  onClose,
  actions,
  version,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return actions;
    return actions.filter((action) => action.label.toLowerCase().includes(q));
  }, [actions, query]);

  const grouped = useMemo(() => {
    const navigation = filtered.filter((action) => action.group === "navigation");
    const commandActions = filtered.filter(
      (action) => action.group === "actions",
    );
    const groups: Array<CommandPaletteGroup | null> = [
      navigation.length > 0
        ? { label: t("commandPalette.navigation"), items: navigation }
        : null,
      commandActions.length > 0
        ? { label: t("commandPalette.actions"), items: commandActions }
        : null,
    ];
    return groups.filter(
      (group): group is CommandPaletteGroup => group !== null,
    );
  }, [filtered, t]);

  const close = useCallback(() => dialogRef.current?.close(), []);

  const runHighlighted = useCallback(() => {
    const action = filtered[highlightedIndex];
    if (!action) return;
    action.run();
    close();
  }, [close, filtered, highlightedIndex]);

  useEffect(() => {
    if (highlightedIndex >= filtered.length) {
      setHighlightedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, highlightedIndex]);

  return (
    <dialog
      ref={dialogRef}
      className="command-palette"
      style={{ margin: 0, padding: 0 }}
      aria-label={t("commandPalette.open")}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setHighlightedIndex((current) =>
            Math.min(filtered.length - 1, current + 1),
          );
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setHighlightedIndex((current) => Math.max(0, current - 1));
        } else if (event.key === "Enter") {
          event.preventDefault();
          runHighlighted();
        }
      }}
    >
      <div className="command-palette-input-row">
        <span className="command-palette-search-icon" aria-hidden="true">
          <SearchGlyph />
        </span>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("commandPalette.placeholder")}
          aria-label={t("commandPalette.placeholder")}
          autoComplete="off"
          autoFocus
          spellCheck={false}
        />
      </div>
      <div className="command-palette-list">
        {grouped.length === 0 ? (
          <p className="command-palette-empty" role="status">
            {t("commandPalette.noResults")}
          </p>
        ) : (
          grouped.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h3 className="command-palette-group">{group.label}</h3>
              {group.items.map((action) => {
                const flatIndex = filtered.indexOf(action);
                return (
                  <button
                    key={action.id}
                    type="button"
                    className="command-palette-item"
                    data-highlighted={flatIndex === highlightedIndex || undefined}
                    onMouseEnter={() => setHighlightedIndex(flatIndex)}
                    onClick={() => {
                      action.run();
                      close();
                    }}
                  >
                    <span className="command-palette-item-icon" aria-hidden="true">
                      {action.icon}
                    </span>
                    <span className="command-palette-item-label">
                      {action.label}
                    </span>
                    {action.hint ? (
                      <span className="command-palette-item-hint">
                        {action.hint}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </section>
          ))
        )}
      </div>
      <footer className="command-palette-footer">
        {/* eslint-disable-next-line i18next/no-literal-string */}
        {version ? <span className="command-palette-version">v{version}</span> : null}
        <span className="command-palette-keys">
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          <span>{t("commandPalette.navigate")}</span>
          <kbd>↵</kbd>
          <span>{t("commandPalette.select")}</span>
          <kbd>{t("commandPalette.esc")}</kbd>
        </span>
      </footer>
    </dialog>
  );
};

const SearchGlyph = () => (
  <svg
    width={ICON_SIZE}
    height={ICON_SIZE}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
