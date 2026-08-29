import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { Search } from "lucide-react";
import { useOsType } from "@/hooks/useOsType";
import { Kbd, KbdChord } from "./ui/Kbd";
import type { CommandPaletteAction } from "./commandPaletteActions";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  actions: CommandPaletteAction[];
}

interface CommandPaletteGroup {
  label: string;
  items: CommandPaletteAction[];
}

const ICON_SIZE = 16;
const LISTBOX_ID = "command-palette-listbox";

const optionId = (action: CommandPaletteAction) =>
  `command-palette-option-${action.id}`;

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

interface CommandPaletteDialogProps extends Omit<CommandPaletteProps, "open"> {
  version: string;
}

/* Combobox over a listbox: the input keeps focus and owns the keyboard, and
 * aria-activedescendant moves the announced option. Mounted only while open,
 * so the query and the highlight reset every time it is summoned. */
const CommandPaletteDialog: React.FC<CommandPaletteDialogProps> = ({
  onClose,
  actions,
  version,
}) => {
  const { t } = useTranslation();
  /* Same caps as the nav chip that opens this, so the field the chip becomes
   * still shows the chord that summoned it. */
  const paletteChord =
    useOsType() === "macos" ? ["\u2318", "K"] : ["Ctrl", "K"];
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /* StrictMode runs this effect twice: the first cleanup closes the dialog,
   * and that close event must not reach the parent as a user close or the
   * palette dismisses itself the moment it opens. */
  const closingFromCleanup = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) {
        closingFromCleanup.current = true;
        dialog.close();
      }
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return actions;
    return actions.filter((action) => action.label.toLowerCase().includes(q));
  }, [actions, query]);

  const grouped = useMemo(() => {
    const navigation = filtered.filter(
      (action) => action.group === "navigation",
    );
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

  const run = useCallback(
    (action: CommandPaletteAction | undefined) => {
      if (!action) return;
      action.run();
      close();
    },
    [close],
  );

  const safeIndex = Math.min(
    highlightedIndex,
    Math.max(0, filtered.length - 1),
  );
  const highlighted = filtered[safeIndex];

  useEffect(() => {
    if (highlightedIndex !== safeIndex) setHighlightedIndex(safeIndex);
  }, [highlightedIndex, safeIndex]);

  // Keep the highlighted option in view when the arrows walk past the fold.
  useLayoutEffect(() => {
    if (!highlighted) return;
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(highlighted))}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) =>
        Math.min(filtered.length - 1, current + 1),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(0, current - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlightedIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlightedIndex(Math.max(0, filtered.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(highlighted);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="command-palette"
      aria-label={t("commandPalette.open")}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={() => {
        if (closingFromCleanup.current) {
          closingFromCleanup.current = false;
          return;
        }
        onClose();
      }}
      // Clicking the backdrop targets the dialog element itself.
      onMouseDown={(event) => {
        if (event.target === dialogRef.current) close();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="command-palette-input-row">
        <span className="command-palette-search-icon" aria-hidden="true">
          <Search size={ICON_SIZE} />
        </span>
        <input
          type="text"
          role="combobox"
          aria-expanded={true}
          aria-controls={LISTBOX_ID}
          aria-activedescendant={
            highlighted ? optionId(highlighted) : undefined
          }
          aria-autocomplete="list"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlightedIndex(0);
          }}
          placeholder={t("commandPalette.placeholder")}
          aria-label={t("commandPalette.placeholder")}
          autoComplete="off"
          autoFocus
          spellCheck={false}
        />
        <span className="command-palette-input-cap" aria-hidden="true">
          {query === "" ? (
            <KbdChord keys={paletteChord} />
          ) : (
            <Kbd>{t("commandPalette.esc")}</Kbd>
          )}
        </span>
      </div>
      <div ref={listRef} className="command-palette-list">
        {grouped.length === 0 ? (
          <p className="command-palette-empty" role="status">
            {t("commandPalette.noResults")}
          </p>
        ) : (
          <div
            id={LISTBOX_ID}
            role="listbox"
            aria-label={t("commandPalette.open")}
          >
            {grouped.map((group) => (
              <div key={group.label} role="group" aria-label={group.label}>
                <p className="command-palette-group" aria-hidden="true">
                  {group.label}
                </p>
                {group.items.map((action) => {
                  const index = filtered.indexOf(action);
                  return (
                    <button
                      key={action.id}
                      id={optionId(action)}
                      type="button"
                      role="option"
                      aria-selected={index === safeIndex}
                      tabIndex={-1}
                      className="command-palette-item"
                      data-highlighted={index === safeIndex || undefined}
                      onMouseMove={() => setHighlightedIndex(index)}
                      onClick={() => run(action)}
                    >
                      <span
                        className="command-palette-item-icon"
                        aria-hidden="true"
                      >
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
              </div>
            ))}
          </div>
        )}
      </div>
      <footer className="command-palette-footer">
        {version ? (
          <span className="command-palette-version">{`v${version}`}</span>
        ) : (
          <span />
        )}
        <span className="command-palette-keys">
          <Kbd>{"\u2191"}</Kbd>
          <Kbd>{"\u2193"}</Kbd>
          <span>{t("commandPalette.navigate")}</span>
          <Kbd>{"\u21B5"}</Kbd>
          <span>{t("commandPalette.select")}</span>
          <Kbd>{t("commandPalette.esc")}</Kbd>
        </span>
      </footer>
    </dialog>
  );
};
