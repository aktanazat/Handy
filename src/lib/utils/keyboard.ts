/**
 * Keyboard utility functions for handling keyboard events
 */

export type OSType = "macos" | "windows" | "linux" | "unknown";

/* The four modifiers whose display name is not the same on every platform. */
type Modifier = "shift" | "ctrl" | "alt" | "meta";

/* Every table below is a Map for the same reason as the glyph tables further
 * down: the lookup key is a raw `KeyboardEvent.code`/`.key` string, so `.get`
 * is the total lookup, and an annotated `Record<string, string>` would be the
 * open dictionary the repo's anti-slop rule rejects.
 *
 * They live at module scope because they are constants: building forty entries
 * inside `getKeyName` rebuilt all of them on every keystroke. */
const MODIFIER_CODES = new Map<string, Modifier>([
  ["ShiftLeft", "shift"],
  ["ShiftRight", "shift"],
  ["ControlLeft", "ctrl"],
  ["ControlRight", "ctrl"],
  ["AltLeft", "alt"],
  ["AltRight", "alt"],
  ["MetaLeft", "meta"],
  ["MetaRight", "meta"],
  ["OSLeft", "meta"],
  ["OSRight", "meta"],
]);

/* Non-modifier `code` values whose name is the same on every platform. */
const CODE_NAMES = new Map([
  ["CapsLock", "caps lock"],
  ["Tab", "tab"],
  ["Enter", "enter"],
  ["Space", "space"],
  ["Backspace", "backspace"],
  ["Delete", "delete"],
  ["Escape", "esc"],
  ["ArrowUp", "up"],
  ["ArrowDown", "down"],
  ["ArrowLeft", "left"],
  ["ArrowRight", "right"],
  ["Home", "home"],
  ["End", "end"],
  ["PageUp", "page up"],
  ["PageDown", "page down"],
  ["Insert", "insert"],
  ["PrintScreen", "print screen"],
  ["ScrollLock", "scroll lock"],
  ["Pause", "pause"],
  ["ContextMenu", "menu"],
  ["NumpadMultiply", "numpad *"],
  ["NumpadAdd", "numpad +"],
  ["NumpadSubtract", "numpad -"],
  ["NumpadDecimal", "numpad ."],
  ["NumpadDivide", "numpad /"],
  ["NumLock", "num lock"],
]);

/* Punctuation and symbol `code` values. */
const PUNCTUATION_NAMES = new Map([
  ["Semicolon", ";"],
  ["Equal", "="],
  ["Comma", ","],
  ["Minus", "-"],
  ["Period", "."],
  ["Slash", "/"],
  ["Backquote", "`"],
  ["BracketLeft", "["],
  ["Backslash", "\\"],
  ["BracketRight", "]"],
  ["Quote", "'"],
]);

/* `KeyboardEvent.key` fallbacks whose name is the same on every platform. */
const KEY_NAMES = new Map([
  ["Control", "ctrl"],
  ["Shift", "shift"],
  ["CapsLock", "caps lock"],
  ["ArrowUp", "up"],
  ["ArrowDown", "down"],
  ["ArrowLeft", "left"],
  ["ArrowRight", "right"],
  ["Escape", "esc"],
  [" ", "space"],
]);

/** How this OS spells a modifier. */
const modifierName = (modifier: Modifier, osType: OSType): string => {
  switch (modifier) {
    case "shift":
      return "shift";
    case "ctrl":
      return "ctrl";
    case "alt":
      return osType === "macos" ? "option" : "alt";
    case "meta":
      // Windows key on Windows/Linux, Command key on Mac
      return osType === "macos" ? "command" : "super";
  }
};

/* The `key` fallback spells the Windows key "win" where the `code` path above
 * says "super". Both predate this refactor and are left as they were. */
const osKeyName = (key: string, osType: OSType): string | undefined => {
  if (key === "Alt") return osType === "macos" ? "option" : "alt";
  if (key !== "Meta" && key !== "OS") return undefined;
  if (osType === "macos") return "command";
  return osType === "windows" ? "win" : "super";
};

/**
 * Extract a consistent key name from a KeyboardEvent
 * This function provides cross-platform keyboard event handling
 * and returns key names appropriate for the target operating system
 */
export const getKeyName = (
  e: KeyboardEvent,
  osType: OSType = "unknown",
): string => {
  // Handle special cases first
  if (e.code) {
    const code = e.code;

    // Handle function keys (F1-F24)
    if (code.match(/^F\d+$/)) {
      return code.toLowerCase(); // F1, F2, ..., F14, F15, etc.
    }

    // Handle regular letter keys (KeyA -> a)
    if (code.match(/^Key[A-Z]$/)) {
      return code.replace("Key", "").toLowerCase();
    }

    // Handle digit keys (Digit0 -> 0)
    if (code.match(/^Digit\d$/)) {
      return code.replace("Digit", "");
    }

    // Handle numpad digit keys (Numpad0 -> numpad 0)
    if (code.match(/^Numpad\d$/)) {
      return code.replace("Numpad", "numpad ").toLowerCase();
    }

    // Handle modifier keys - OS-specific naming
    const modifier = MODIFIER_CODES.get(code);
    if (modifier !== undefined) return modifierName(modifier, osType);

    const codeName = CODE_NAMES.get(code);
    if (codeName !== undefined) return codeName;

    // Handle punctuation and special characters
    const punctuation = PUNCTUATION_NAMES.get(code);
    if (punctuation !== undefined) return punctuation;

    // For any other codes, try to convert to a reasonable format
    return code.toLowerCase().replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  // Fallback to e.key if e.code is not available
  if (e.key) {
    const key = e.key;

    // Handle special key names with OS-specific formatting
    const osName = osKeyName(key, osType);
    if (osName !== undefined) return osName;

    const keyName = KEY_NAMES.get(key);
    if (keyName !== undefined) return keyName;

    return key.toLowerCase();
  }

  // Last resort fallback
  return `unknown-${e.keyCode || e.which || 0}`;
};

/**
 * Capitalize a key name for display (e.g. "space" -> "Space", "f1" -> "F1")
 */
const capitalizeKey = (key: string): string => {
  // fn key: keep lowercase
  if (key === "fn") return "fn";
  // Function keys: f1 -> F1
  if (/^f\d+$/.test(key)) return key.toUpperCase();
  // Single char: a -> A
  if (key.length === 1) return key.toUpperCase();
  // Multi-word: capitalize first letter of each word
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * Format a single key part for display.
 * Handles _left/_right suffixes and capitalizes names.
 * e.g. "shift_left" -> "Left Shift", "option" -> "Option", "space" -> "Space"
 */
const formatKeyPart = (part: string): string => {
  const trimmed = part.trim();
  if (!trimmed) return "";

  if (trimmed.endsWith("_left")) {
    const name = trimmed.slice(0, -5);
    return `Left ${capitalizeKey(name)}`;
  }
  if (trimmed.endsWith("_right")) {
    const name = trimmed.slice(0, -6);
    return `Right ${capitalizeKey(name)}`;
  }

  return capitalizeKey(trimmed);
};

/**
 * Split a raw hotkey string into one display label per physical key.
 * "option_left+shift+space" -> ["Left Option", "Shift", "Space"]
 *
 * Each entry is one keycap: Vercel's product kbd spec gives every physical key
 * its own chip and never puts a "+" inside one, so a chip row needs the parts,
 * not the joined string.
 */
export const keyCombinationParts = (combination: string): string[] => {
  if (!combination) return [];
  return combination.split("+").map(formatKeyPart).filter(Boolean);
};

/**
 * Get display-friendly key combination string for the current OS
 * Formats raw hotkey strings like "option_left+shift+space" into
 * human-readable form like "Left Option + Shift + Space"
 */
export const formatKeyCombination = (
  combination: string,
  _osType: OSType,
): string => keyCombinationParts(combination).join(" + ");

/* macOS engraves its modifiers on the physical key and prints the same glyphs
 * in every native menu, so a row too narrow for "Left Option" is not losing
 * information by showing ⌥ — it is showing what the keyboard shows. Every
 * other platform spells its modifiers short already and keeps the word.
 *
 * Maps rather than object literals because the key is one part of a chord
 * string and is therefore `string`: an annotated `Record<string, string>` is
 * the open dictionary the repo's anti-slop rule rejects, and a closed key
 * union needs a cast or a guard per table to index. `.get` is the total
 * lookup both tables actually want. */
const MAC_MODIFIER_GLYPHS = new Map([
  ["command", "⌘"],
  ["option", "⌥"],
  ["alt", "⌥"],
  ["shift", "⇧"],
  ["ctrl", "⌃"],
]);

/* Keys whose engraving is a glyph on every platform Sona ships to. */
const COMPACT_KEY_GLYPHS = new Map([
  ["enter", "↩"],
  ["tab", "⇥"],
  ["backspace", "⌫"],
  ["delete", "⌦"],
  ["esc", "⎋"],
  ["caps lock", "⇪"],
  ["up", "↑"],
  ["down", "↓"],
  ["left", "←"],
  ["right", "→"],
]);

/**
 * One short cap per physical key, for rows too dense for the spelled-out form.
 * "option_left+shift+2" -> ["⌥", "⇧", "2"] on macOS, ["Option", "Shift", "2"]
 * elsewhere.
 *
 * The left/right qualifier is dropped because both sides carry the same
 * engraving; callers pair this with `formatKeyCombination` as the row's title
 * so the qualified form stays one hover away. Naming still comes from
 * `capitalizeKey`, so there is no second key vocabulary.
 */
export const keyCapParts = (combination: string, osType: OSType): string[] => {
  if (!combination) return [];
  const caps: string[] = [];
  for (const raw of combination.split("+")) {
    const key = raw.trim().replace(/_(?:left|right)$/, "");
    if (!key) continue;
    const glyph =
      (osType === "macos" ? MAC_MODIFIER_GLYPHS.get(key) : undefined) ??
      COMPACT_KEY_GLYPHS.get(key);
    caps.push(glyph ?? capitalizeKey(key));
  }
  return caps;
};

/**
 * Normalize modifier keys to handle left/right variants
 */
export const normalizeKey = (key: string): string => {
  // Handle left/right variants of modifier keys
  if (key.startsWith("left ") || key.startsWith("right ")) {
    const parts = key.split(" ");
    if (parts.length === 2) {
      // Return just the modifier name without left/right prefix
      return parts[1];
    }
  }
  return key;
};
