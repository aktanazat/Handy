import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, m, useReducedMotionConfig } from "motion/react";
import { Search } from "lucide-react";
import { useOsType } from "@/hooks/useOsType";
import { MotionScope, springSnappy } from "@/lib/motion";
import { Kbd, KbdChord } from "./ui/Kbd";
import type { CommandPaletteAction } from "./commandPaletteActions";

/* The palette itself, in its own module so the animation runtime is not in the
 * eager chunk: nothing here is needed until a chord asks for it.
 *
 * Combobox over a listbox: the input keeps focus and owns the keyboard, and
 * aria-activedescendant moves the announced option. Mounted only while open, so
 * the query and the highlight reset every time it is summoned. */

const ICON_SIZE = 16;
const LISTBOX_ID = "command-palette-listbox";

const optionId = (action: CommandPaletteAction) =>
  `command-palette-option-${action.id}`;

interface CommandPaletteGroup {
  label: string;
  items: CommandPaletteAction[];
}

export interface CommandPaletteSurfaceProps {
  open: boolean;
  onClose: () => void;
  actions: CommandPaletteAction[];
  version: string;
}

/* AnimatePresence keeps the dialog mounted through its exit spring, so the
 * parent's `open` is the single source of truth: the dialog never closes
 * itself and then tells us about it. */
export const CommandPaletteSurface: React.FC<CommandPaletteSurfaceProps> = ({
  open,
  onClose,
  actions,
  version,
}) => (
  <MotionScope>
    <AnimatePresence>
      {open ? (
        <CommandPaletteDialog
          key="command-palette"
          onClose={onClose}
          actions={actions}
          version={version}
        />
      ) : null}
    </AnimatePresence>
  </MotionScope>
);

export default CommandPaletteSurface;

interface CommandPaletteDialogProps {
  onClose: () => void;
  actions: CommandPaletteAction[];
  version: string;
}

const CommandPaletteDialog: React.FC<CommandPaletteDialogProps> = ({
  onClose,
  actions,
  version,
}) => {
  const { t } = useTranslation();
  /* Motion makes the scale *animation* instant for a device that asked to
   * reduce motion, but `initial` is still painted once — a 0.97 frame is
   * exactly the flinch the setting exists to remove. So under reduce the
   * palette has no scale state at all and only cross-fades. */
  const reduce = useReducedMotionConfig() === true;
  /* Same caps as the nav chip that opens this, so the field the chip becomes
   * still shows the chord that summoned it. */
  const paletteChord =
    useOsType() === "macos" ? ["\u2318", "K"] : ["Ctrl", "K"];
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /* The native modal has to stay open while the exit spring plays: a closed
   * `<dialog>` is `display: none` and there would be nothing to animate. So
   * opening and closing the element is purely a mount concern, and dismissal
   * goes through the parent instead. StrictMode's double invoke is then
   * harmless — close, then show again on the same element. */
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

  const run = useCallback(
    (action: CommandPaletteAction | undefined) => {
      if (!action) return;
      action.run();
      onClose();
    },
    [onClose],
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
    } else if (event.key === "Escape") {
      /* The dialog's own `cancel` event would close the element itself, which
       * is display:none and would leave the exit spring nothing to play. So
       * Escape is handled here, on the way in, and asks the parent instead. */
      event.preventDefault();
      onClose();
    }
  };

  return (
    <m.dialog
      ref={dialogRef}
      className="command-palette glass-surface"
      aria-label={t("commandPalette.open")}
      /* The palette is centred by a transform, so the transform has to be
       * Motion's: it composes translateX(-50%) with the scale instead of one
       * clobbering the other. The matching CSS rule stays as the pre-script
       * position. */
      style={{ x: "-50%" }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      transition={springSnappy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // Clicking the backdrop targets the dialog element itself.
      onMouseDown={(event) => {
        if (event.target === dialogRef.current) onClose();
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
      {/* Typing rewrites this list, so the rows that survive a keystroke close
       * the gaps the filtered-out rows left instead of teleporting. That is
       * layout projection, from the same bundle the surface already loaded;
       * `layoutScroll` is what tells it this list scrolls. */}
      <m.div ref={listRef} layoutScroll className="command-palette-list">
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
              <m.div
                key={group.label}
                layout
                transition={springSnappy}
                role="group"
                aria-label={group.label}
              >
                <p className="command-palette-group" aria-hidden="true">
                  {group.label}
                </p>
                {group.items.map((action) => {
                  const index = filtered.indexOf(action);
                  return (
                    <m.button
                      key={action.id}
                      layout
                      transition={springSnappy}
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
                    </m.button>
                  );
                })}
              </m.div>
            ))}
          </div>
        )}
      </m.div>
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
    </m.dialog>
  );
};
