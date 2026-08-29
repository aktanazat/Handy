import { invoke } from "@tauri-apps/api/core";

/**
 * Power-pack commands invoked by name rather than through `commands.*`.
 *
 * The generated wrappers exist, but these twelve calls declare their payload
 * shapes locally and go through `invoke` exactly like `read_history_audio_chunk`
 * already does in `HistorySettings.tsx`. Keeping one accessor per command here
 * means the panels below never import a second settings surface.
 */

/** Mirrors `ReplacementRule` in `src-tauri/src/settings.rs`. */
export interface ReplacementRule {
  spoken: string;
  written: string;
  enabled: boolean;
}

/** Mirrors `PersonaSample` in `src-tauri/src/settings.rs`. */
export interface PersonaSample {
  id: string;
  text: string;
}

/** Mirrors `OverlayPosition` in `src-tauri/src/settings.rs`. */
export type OverlayPosition = "top" | "bottom";

/** Mirrors `HudPillState` in `src-tauri/src/commands/hud.rs`. */
export interface HudPillState {
  enabled: boolean;
  position: OverlayPosition;
  mode_name: string | null;
  mode_id: string | null;
}

/** The persisted ceiling; the backend enforces the same two bounds. */
export const PERSONA_SAMPLES_MAX = 5;
export const PERSONA_SAMPLE_MAX_WORDS = 500;

export const countWords = (text: string): number =>
  text.trim() === "" ? 0 : text.trim().split(/\s+/).length;

export const getTextReplacements = (): Promise<ReplacementRule[]> =>
  invoke<ReplacementRule[]>("get_text_replacements");

/** Answers with the normalized list, so callers set state from the result. */
export const saveTextReplacements = (
  rules: ReplacementRule[],
): Promise<ReplacementRule[]> =>
  invoke<ReplacementRule[]>("save_text_replacements", { rules });

export const resetTextReplacements = (): Promise<ReplacementRule[]> =>
  invoke<ReplacementRule[]>("reset_text_replacements");

export const setTextReplacementsEnabled = (enabled: boolean): Promise<void> =>
  invoke<void>("update_text_replacements_enabled", { enabled });

export const getPersonaSamples = (): Promise<PersonaSample[]> =>
  invoke<PersonaSample[]>("get_persona_samples");

export const savePersonaSamples = (
  samples: PersonaSample[],
): Promise<PersonaSample[]> =>
  invoke<PersonaSample[]>("save_persona_samples", { samples });

export const getHudPillState = (): Promise<HudPillState> =>
  invoke<HudPillState>("hud_pill_state");

export const setHudPillEnabled = (enabled: boolean): Promise<void> =>
  invoke<void>("set_hud_pill_enabled", { enabled });

export const setHudPillPosition = (position: OverlayPosition): Promise<void> =>
  invoke<void>("set_hud_pill_position", { position });

export const hudToggleRecording = (): Promise<void> =>
  invoke<void>("hud_toggle_recording");

export const hudOpenModeMenu = (): Promise<void> =>
  invoke<void>("hud_open_mode_menu");

/** Runs a stored recording through `modeId`, saving a new linked entry. */
export const reprocessHistoryEntry = (
  id: number,
  modeId: string,
): Promise<void> => invoke<void>("reprocess_history_entry", { id, modeId });
