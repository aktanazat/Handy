import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { listen } from "@tauri-apps/api/event";
import {
  commands,
  type AppSettings as Settings,
  type AudioDevice,
  type TranscribeAcceleratorSetting,
  type OrtAcceleratorSetting,
} from "@/bindings";

export interface SettingsStore {
  settings: Settings | null;
  defaultSettings: Settings | null;
  isLoading: boolean;
  isUpdating: Record<string, boolean>;
  audioDevices: AudioDevice[];
  outputDevices: AudioDevice[];
  customSounds: { start: boolean; stop: boolean };
  postProcessModelOptions: Record<string, string[]>;

  // Actions
  initialize: () => Promise<void>;
  loadDefaultSettings: () => Promise<void>;
  updateSetting: <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => Promise<void>;
  resetSetting: (key: keyof Settings) => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshAudioDevices: () => Promise<void>;
  refreshOutputDevices: () => Promise<void>;
  updateBinding: (id: string, binding: string) => Promise<void>;
  resetBinding: (id: string) => Promise<void>;
  getSetting: <K extends keyof Settings>(key: K) => Settings[K] | undefined;
  isUpdatingKey: (key: string) => boolean;
  playTestSound: (soundType: "start" | "stop") => Promise<void>;
  checkCustomSounds: () => Promise<void>;
  setPostProcessProvider: (providerId: string) => Promise<void>;
  updatePostProcessBaseUrl: (
    providerId: string,
    baseUrl: string,
  ) => Promise<void>;
  replacePostProcessSecret: (
    providerId: string,
    secret: string,
  ) => Promise<boolean>;
  removePostProcessSecret: (providerId: string) => Promise<boolean>;
  refreshPostProcessSecretState: (providerId: string) => Promise<void>;
  updatePostProcessModel: (providerId: string, model: string) => Promise<void>;
  fetchPostProcessModels: (providerId: string) => Promise<string[]>;
  setPostProcessModelOptions: (providerId: string, models: string[]) => void;

  // Internal state setters
  setSettings: (settings: Settings | null) => void;
  setDefaultSettings: (defaultSettings: Settings | null) => void;
  setLoading: (loading: boolean) => void;
  setUpdating: (key: string, updating: boolean) => void;
  setAudioDevices: (devices: AudioDevice[]) => void;
  setOutputDevices: (devices: AudioDevice[]) => void;
  setCustomSounds: (sounds: { start: boolean; stop: boolean }) => void;
}

// Note: Default settings are now fetched from Rust via commands.getDefaultSettings()
// This ensures platform-specific defaults (like overlay_position, shortcuts, paste_method) work correctly

const DEFAULT_AUDIO_DEVICE: AudioDevice = {
  index: "default",
  name: "Default",
  is_default: true,
};

type SettingUpdater = (value: unknown) => Promise<unknown>;

const settingUpdaters: Partial<Record<keyof Settings, SettingUpdater>> = {
  always_on_microphone: (value) =>
    commands.updateMicrophoneMode(value as boolean),
  audio_feedback: (value) =>
    commands.changeAudioFeedbackSetting(value as boolean),
  audio_feedback_volume: (value) =>
    commands.changeAudioFeedbackVolumeSetting(value as number),
  sound_theme: (value) => commands.changeSoundThemeSetting(value as string),
  start_hidden: (value) => commands.changeStartHiddenSetting(value as boolean),
  autostart_enabled: (value) =>
    commands.changeAutostartSetting(value as boolean),
  show_whats_new_on_update: (value) =>
    commands.changeShowWhatsNewOnUpdateSetting(value as boolean),
  whats_new_last_seen_version: (value) =>
    commands.changeWhatsNewLastSeenVersionSetting(value as string),
  push_to_talk: (value) => commands.changePttSetting(value as boolean),
  /* SAFETY: `updateSetting` only ever calls the updater registered under the
   * key whose value it was given, so `value` is this field's own `boolean`;
   * `SettingUpdater` erases that to `unknown` because one map holds them all. */
  command_mode_enabled: (value) =>
    commands.changeCommandModeEnabledSetting(value as boolean),
  selected_microphone: (value) =>
    commands.setSelectedMicrophone(
      (value as string) === "Default" || value === null
        ? "default"
        : (value as string),
    ),
  selected_channel: async (value) => {
    const result = await commands.setSelectedChannel(
      (value as number | null | undefined) ?? null,
    );
    if (result.status === "error") {
      throw new Error(result.error);
    }
  },
  clamshell_microphone: (value) =>
    commands.setClamshellMicrophone(
      (value as string) === "Default" ? "default" : (value as string),
    ),
  selected_output_device: (value) =>
    commands.setSelectedOutputDevice(
      (value as string) === "Default" || value === null
        ? "default"
        : (value as string),
    ),
  recording_retention_period: (value) =>
    commands.updateRecordingRetentionPeriod(value as string),
  translate_to_english: (value) =>
    commands.changeTranslateToEnglishSetting(value as boolean),
  selected_language: (value) =>
    commands.changeSelectedLanguageSetting(value as string),
  english_spelling: (value) => {
    if (value !== "as_spoken" && value !== "british") {
      return Promise.reject(new Error("Invalid English spelling setting"));
    }
    return commands.changeEnglishSpellingSetting(value);
  },
  overlay_position: (value) =>
    commands.changeOverlayPositionSetting(value as string),
  debug_mode: (value) => commands.changeDebugModeSetting(value as boolean),
  word_correction_threshold: (value) =>
    commands.changeWordCorrectionThresholdSetting(value as number),
  paste_delay_ms: (value) =>
    commands.changePasteDelayMsSetting(value as number),
  paste_delay_after_ms: (value) =>
    commands.changePasteDelayAfterMsSetting(value as number),
  reliable_paste: (value) =>
    commands.changeReliablePasteSetting(value as boolean),
  paste_method: (value) => commands.changePasteMethodSetting(value as string),
  typing_tool: (value) => commands.changeTypingToolSetting(value as string),
  external_script_path: (value) =>
    commands.changeExternalScriptPathSetting(value as string | null),
  clipboard_handling: (value) =>
    commands.changeClipboardHandlingSetting(value as string),
  auto_submit: (value) => commands.changeAutoSubmitSetting(value as boolean),
  auto_submit_key: (value) =>
    commands.changeAutoSubmitKeySetting(value as string),
  history_limit: (value) => commands.updateHistoryLimit(value as number),
  post_process_enabled: (value) =>
    commands.changePostProcessEnabledSetting(value as boolean),
  post_process_selected_prompt_id: (value) =>
    commands.setPostProcessSelectedPrompt(value as string),
  mute_while_recording: (value) =>
    commands.changeMuteWhileRecordingSetting(value as boolean),
  append_trailing_space: (value) =>
    commands.changeAppendTrailingSpaceSetting(value as boolean),
  log_level: (value) => commands.setLogLevel(value as any),
  app_language: (value) => commands.changeAppLanguageSetting(value as string),
  theme: (value) => commands.changeThemeSetting(value as string),
  /* The Rust side resolves intent against whether native vibrancy actually
   * applied and writes the resulting `data-material` into every webview
   * itself, so there is nothing to do here with the return value. */
  appearance_material: (value) =>
    commands.changeAppearanceMaterialSetting(String(value)),
  experimental_enabled: (value) =>
    commands.changeExperimentalEnabledSetting(value as boolean),
  lazy_stream_close: (value) =>
    commands.changeLazyStreamCloseSetting(value as boolean),
  overlay_style: (value) => commands.changeOverlayStyleSetting(value as string),
  vad_enabled: (value) => commands.changeVadEnabledSetting(value as boolean),
  filler_word_removal_enabled: (value) =>
    commands.changeFillerWordRemovalEnabledSetting(value as boolean),
  show_tray_icon: (value) =>
    commands.changeShowTrayIconSetting(value as boolean),
  transcribe_accelerator: (value) =>
    commands.changeTranscribeAcceleratorSetting(
      value as TranscribeAcceleratorSetting,
    ),
  ort_accelerator: (value) =>
    commands.changeOrtAcceleratorSetting(value as OrtAcceleratorSetting),
  transcribe_gpu_device: (value) =>
    commands.changeTranscribeGpuDevice(value as string | null),
  extra_recording_buffer_ms: (value) =>
    commands.changeExtraRecordingBufferSetting(value as number),
};

/* The in-flight (then settled) first load. See `initialize` for why the latch
 * lives beside the store rather than inside its state. */
let initialization: Promise<void> | null = null;

export const useSettingsStore = create<SettingsStore>()(
  subscribeWithSelector((set, get) => ({
    settings: null,
    defaultSettings: null,
    isLoading: true,
    isUpdating: {},
    audioDevices: [],
    outputDevices: [],
    customSounds: { start: false, stop: false },
    postProcessModelOptions: {},

    // Internal setters
    setSettings: (settings) => set({ settings }),
    setDefaultSettings: (defaultSettings) => set({ defaultSettings }),
    setLoading: (isLoading) => set({ isLoading }),
    setUpdating: (key, updating) =>
      set((state) => ({
        isUpdating: { ...state.isUpdating, [key]: updating },
      })),
    setAudioDevices: (audioDevices) => set({ audioDevices }),
    setOutputDevices: (outputDevices) => set({ outputDevices }),
    setCustomSounds: (customSounds) => set({ customSounds }),

    // Getters
    getSetting: (key) => get().settings?.[key],
    isUpdatingKey: (key) => get().isUpdating[key] || false,

    // Load settings from store
    refreshSettings: async () => {
      try {
        const result = await commands.getAppSettings();
        if (result.status === "ok") {
          const settings = result.data;
          const normalizedSettings: Settings = {
            ...settings,
            always_on_microphone: settings.always_on_microphone ?? false,
            selected_microphone: settings.selected_microphone ?? "Default",
            clamshell_microphone: settings.clamshell_microphone ?? "Default",
            selected_output_device:
              settings.selected_output_device ?? "Default",
          };
          set({ settings: normalizedSettings, isLoading: false });
        } else {
          console.error("Failed to load settings:", result.error);
          set({ isLoading: false });
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
        set({ isLoading: false });
      }
    },

    // Load audio devices
    refreshAudioDevices: async () => {
      try {
        const result = await commands.getAvailableMicrophones();
        if (result.status === "ok") {
          const devicesWithDefault = [
            DEFAULT_AUDIO_DEVICE,
            ...result.data.filter(
              (d) => d.name !== "Default" && d.name !== "default",
            ),
          ];
          set({ audioDevices: devicesWithDefault });
        } else {
          set({ audioDevices: [DEFAULT_AUDIO_DEVICE] });
        }
      } catch (error) {
        console.error("Failed to load audio devices:", error);
        set({ audioDevices: [DEFAULT_AUDIO_DEVICE] });
      }
    },

    // Load output devices
    refreshOutputDevices: async () => {
      try {
        const result = await commands.getAvailableOutputDevices();
        if (result.status === "ok") {
          const devicesWithDefault = [
            DEFAULT_AUDIO_DEVICE,
            ...result.data.filter(
              (d) => d.name !== "Default" && d.name !== "default",
            ),
          ];
          set({ outputDevices: devicesWithDefault });
        } else {
          set({ outputDevices: [DEFAULT_AUDIO_DEVICE] });
        }
      } catch (error) {
        console.error("Failed to load output devices:", error);
        set({ outputDevices: [DEFAULT_AUDIO_DEVICE] });
      }
    },

    // Play a test sound
    playTestSound: async (soundType: "start" | "stop") => {
      try {
        await commands.playTestSound(soundType);
      } catch (error) {
        console.error(`Failed to play test sound (${soundType}):`, error);
      }
    },

    checkCustomSounds: async () => {
      try {
        const sounds = await commands.checkCustomSounds();
        get().setCustomSounds(sounds);
      } catch (error) {
        console.error("Failed to check custom sounds:", error);
      }
    },

    // Update a specific setting
    updateSetting: async <K extends keyof Settings>(
      key: K,
      value: Settings[K],
    ) => {
      const { settings, setUpdating } = get();
      const updateKey = String(key);
      const originalValue = settings?.[key];

      setUpdating(updateKey, true);

      try {
        set((state) => ({
          settings: state.settings ? { ...state.settings, [key]: value } : null,
        }));

        const updater = settingUpdaters[key];
        if (updater) {
          await updater(value);
        } else if (key !== "bindings" && key !== "selected_model") {
          console.warn(`No handler for setting: ${String(key)}`);
        }
      } catch (error) {
        console.error(`Failed to update setting ${String(key)}:`, error);
        if (settings) {
          set({ settings: { ...settings, [key]: originalValue } });
        }
      } finally {
        setUpdating(updateKey, false);
      }
    },

    // Reset a setting to its default value
    resetSetting: async (key) => {
      const { defaultSettings } = get();
      if (defaultSettings) {
        const defaultValue = defaultSettings[key];
        if (defaultValue !== undefined) {
          await get().updateSetting(key, defaultValue as any);
        }
      }
    },

    // Update a specific binding
    updateBinding: async (id, binding) => {
      const { settings, setUpdating } = get();
      const updateKey = `binding_${id}`;
      const originalBinding = settings?.bindings?.[id]?.current_binding;

      setUpdating(updateKey, true);

      try {
        // Optimistic update
        set((state) => {
          const currentSettings = state.settings;
          const bindings = currentSettings?.bindings;
          const currentBinding = bindings?.[id];
          if (!currentSettings || !bindings || !currentBinding) return {};
          return {
            settings: {
              ...currentSettings,
              bindings: {
                ...bindings,
                [id]: { ...currentBinding, current_binding: binding },
              },
            } as Settings,
          };
        });

        const result = await commands.changeBinding(id, binding);

        // Check if the command executed successfully
        if (result.status === "error") {
          throw new Error(result.error);
        }

        // Check if the binding change was successful
        if (!result.data.success) {
          throw new Error(result.data.error || "Failed to update binding");
        }
      } catch (error) {
        console.error(`Failed to update binding ${id}:`, error);

        // Roll back only the binding record that the optimistic update changed.
        if (originalBinding) {
          set((state) => {
            const currentSettings = state.settings;
            const bindings = currentSettings?.bindings;
            const currentBinding = bindings?.[id];
            if (!currentSettings || !bindings || !currentBinding) return {};
            return {
              settings: {
                ...currentSettings,
                bindings: {
                  ...bindings,
                  [id]: { ...currentBinding, current_binding: originalBinding },
                },
              } as Settings,
            };
          });
        }

        // Re-throw to let the caller know it failed
        throw error;
      } finally {
        setUpdating(updateKey, false);
      }
    },

    // Reset a specific binding
    resetBinding: async (id) => {
      const { setUpdating, refreshSettings } = get();
      const updateKey = `binding_${id}`;

      setUpdating(updateKey, true);

      try {
        await commands.resetBinding(id);
        await refreshSettings();
      } catch (error) {
        console.error(`Failed to reset binding ${id}:`, error);
      } finally {
        setUpdating(updateKey, false);
      }
    },

    setPostProcessProvider: async (providerId) => {
      const {
        settings,
        setUpdating,
        refreshSettings,
        setPostProcessModelOptions,
      } = get();
      const updateKey = "post_process_provider_id";
      const previousId = settings?.post_process_provider_id ?? null;

      setUpdating(updateKey, true);

      if (settings) {
        set((state) => ({
          settings: state.settings
            ? { ...state.settings, post_process_provider_id: providerId }
            : null,
        }));
      }

      // Clear cached model options for the new provider so the dropdown
      // doesn't show stale models from a previous fetch or base_url.
      setPostProcessModelOptions(providerId, []);

      try {
        await commands.setPostProcessProvider(providerId);
        await refreshSettings();
      } catch (error) {
        console.error("Failed to set post-process provider:", error);
        if (previousId !== null) {
          set((state) => ({
            settings: state.settings
              ? { ...state.settings, post_process_provider_id: previousId }
              : null,
          }));
        }
      } finally {
        setUpdating(updateKey, false);
      }
    },

    updatePostProcessBaseUrl: async (providerId, baseUrl) => {
      const { setUpdating, refreshSettings } = get();
      const updateKey = `post_process_base_url:${providerId}`;

      setUpdating(updateKey, true);
      try {
        const urlResult = await commands.changePostProcessBaseUrlSetting(
          providerId,
          baseUrl,
        );
        if (urlResult.status === "error") {
          console.error("Failed to persist base URL:", urlResult.error);
          return;
        }

        const modelResult = await commands.changePostProcessModelSetting(
          providerId,
          "",
        );
        if (modelResult.status === "error") {
          console.error("Failed to reset model setting:", modelResult.error);
          return;
        }

        set((state) => ({
          postProcessModelOptions: {
            ...state.postProcessModelOptions,
            [providerId]: [],
          },
        }));
        await refreshSettings();
      } catch (error) {
        console.error("Failed to update post-process base URL:", error);
      } finally {
        setUpdating(updateKey, false);
      }
    },

    replacePostProcessSecret: async (providerId, secret) => {
      const updateKey = `post_process_secret:${providerId}`;
      const { setUpdating } = get();
      setUpdating(updateKey, true);

      try {
        const result = await commands.setProviderSecret(
          "llm",
          providerId,
          secret,
        );
        if (result.status === "error") {
          console.error("Failed to store provider credential:", result.error);
          return false;
        }
        set((state) => ({
          settings: state.settings
            ? {
                ...state.settings,
                post_process_secret_states: {
                  ...state.settings.post_process_secret_states,
                  [providerId]: result.data,
                },
              }
            : null,
          postProcessModelOptions: {
            ...state.postProcessModelOptions,
            [providerId]: [],
          },
        }));
        return true;
      } catch (error) {
        console.error("Failed to store provider credential:", error);
        return false;
      } finally {
        setUpdating(updateKey, false);
      }
    },

    removePostProcessSecret: async (providerId) => {
      const updateKey = `post_process_secret:${providerId}`;
      const { setUpdating } = get();
      setUpdating(updateKey, true);

      try {
        const result = await commands.deleteProviderSecret("llm", providerId);
        if (result.status === "error") {
          console.error("Failed to remove provider credential:", result.error);
          return false;
        }
        set((state) => ({
          settings: state.settings
            ? {
                ...state.settings,
                post_process_secret_states: {
                  ...state.settings.post_process_secret_states,
                  [providerId]: result.data,
                },
              }
            : null,
          postProcessModelOptions: {
            ...state.postProcessModelOptions,
            [providerId]: [],
          },
        }));
        return true;
      } catch (error) {
        console.error("Failed to remove provider credential:", error);
        return false;
      } finally {
        setUpdating(updateKey, false);
      }
    },

    refreshPostProcessSecretState: async (providerId) => {
      const updateKey = `post_process_secret:${providerId}`;
      const { setUpdating } = get();
      setUpdating(updateKey, true);

      try {
        const result = await commands.getProviderSecretState("llm", providerId);
        if (result.status === "error") {
          console.error(
            "Failed to read provider credential state:",
            result.error,
          );
          return;
        }
        set((state) => ({
          settings: state.settings
            ? {
                ...state.settings,
                post_process_secret_states: {
                  ...state.settings.post_process_secret_states,
                  [providerId]: result.data,
                },
              }
            : null,
        }));
      } catch (error) {
        console.error("Failed to read provider credential state:", error);
      } finally {
        setUpdating(updateKey, false);
      }
    },

    updatePostProcessModel: async (providerId, model) => {
      const updateKey = `post_process_model:${providerId}`;
      const { setUpdating, refreshSettings } = get();
      setUpdating(updateKey, true);

      try {
        const result = await commands.changePostProcessModelSetting(
          providerId,
          model,
        );
        if (result.status === "error") {
          console.error("Failed to update post-process model:", result.error);
          return;
        }
        await refreshSettings();
      } catch (error) {
        console.error("Failed to update post-process model:", error);
      } finally {
        setUpdating(updateKey, false);
      }
    },

    fetchPostProcessModels: async (providerId) => {
      const updateKey = `post_process_models_fetch:${providerId}`;
      const { setUpdating, setPostProcessModelOptions } = get();

      setUpdating(updateKey, true);

      try {
        // Call Tauri backend command instead of fetch
        const result = await commands.fetchPostProcessModels(providerId);
        if (result.status === "ok") {
          setPostProcessModelOptions(providerId, result.data);
          return result.data;
        } else {
          console.error("Failed to fetch models:", result.error);
          return [];
        }
      } catch (error) {
        console.error("Failed to fetch models:", error);
        // Don't cache empty array on error - let user retry
        return [];
      } finally {
        setUpdating(updateKey, false);
      }
    },

    setPostProcessModelOptions: (providerId, models) =>
      set((state) => ({
        postProcessModelOptions: {
          ...state.postProcessModelOptions,
          [providerId]: models,
        },
      })),

    // Load default settings from Rust
    loadDefaultSettings: async () => {
      try {
        const result = await commands.getDefaultSettings();
        if (result.status === "ok") {
          set({ defaultSettings: result.data });
        } else {
          console.error("Failed to load default settings:", result.error);
        }
      } catch (error) {
        console.error("Failed to load default settings:", error);
      }
    },

    /* One load per window, however many consumers ask for it.
     *
     * Every `useSettings()` consumer arms this from its mount effect while
     * `isLoading` is still true, and `isLoading` only clears once the first
     * `refreshSettings()` answers — so on a settings page with eighteen
     * consumers this ran eighteen times concurrently. That cost eighteen
     * `get_app_settings`, `get_default_settings` and `check_custom_sounds`
     * round-trips, and it registered the two backend listeners eighteen times
     * over, after which a single `settings-changed` emit fanned out into
     * eighteen refreshes and eighteen store writes.
     *
     * The latch is module state rather than store state because it is not
     * rendered and must not wake a subscriber; the store is a module singleton
     * already. Callers still await the same completion they always did. The body
     * cannot reject — each of the three loads catches its own failure — so
     * there is nothing here to reset and retry. */
    initialize: async () => {
      initialization ??= (async () => {
        const { refreshSettings, checkCustomSounds, loadDefaultSettings } =
          get();

        // Note: Audio devices are NOT refreshed here. The frontend (App.tsx)
        // is responsible for calling refreshAudioDevices/refreshOutputDevices
        // after onboarding completes. This avoids triggering permission dialogs
        // on macOS before the user is ready.
        await Promise.all([
          loadDefaultSettings(),
          refreshSettings(),
          checkCustomSounds(),
        ]);

        // Re-fetch settings when the backend changes them (e.g. language
        // reset during model switch). The backend is the source of truth.
        listen("model-state-changed", () => {
          get().refreshSettings();
        });
        listen<{ setting?: string }>("settings-changed", (event) => {
          get().refreshSettings();
          if (event.payload.setting === "selected_microphone") {
            get().refreshAudioDevices();
          }
        });
      })();

      return initialization;
    },
  })),
);
