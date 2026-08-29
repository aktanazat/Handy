import React from "react";
import { useTranslation } from "react-i18next";
import type { PostProcessProvider, PromptPreset, Tone } from "@/bindings";
import {
  Dropdown,
  Input,
  SettingContainer,
  SettingsGroup,
  StatusText,
  ToggleSwitch,
  type DropdownOption,
} from "@/components/ui";
import { SegmentedRadioGroup, type SegmentedOption } from "./ModeControls";
import { PROMPT_PRESETS, TONES, type ModePanelProps } from "./modeModel";

export interface ModeRewritePanelProps extends ModePanelProps {
  providers: readonly PostProcessProvider[];
}

export const ModeRewritePanel: React.FC<ModeRewritePanelProps> = ({
  mode,
  updaters,
  providers,
}) => {
  const { t } = useTranslation();
  const { update, updateLlm, updatePrompt } = updaters;
  const enabled = mode.llm.enabled;

  const providerOptions: DropdownOption[] = providers.map((provider) => ({
    value: provider.id,
    label: provider.label,
  }));
  /* A mode can name a provider this install does not have. Keep it selectable
   * so saving the mode never silently rewrites the choice, and explain it. */
  const selectedProviderConfigured = providers.some(
    (provider) => provider.id === mode.llm.provider_id,
  );
  if (mode.llm.provider_id && !selectedProviderConfigured) {
    providerOptions.unshift({
      value: mode.llm.provider_id,
      label: mode.llm.provider_id,
    });
  }

  const presetOptions: SegmentedOption<PromptPreset>[] = PROMPT_PRESETS.map(
    (preset) => ({
      value: preset,
      label: t(`settings.modes.writing.preset.values.${preset}`),
    }),
  );

  const toneOptions: SegmentedOption<Tone>[] = TONES.map((tone) => ({
    value: tone,
    label: t(`settings.modes.writing.tone.values.${tone}`),
  }));

  return (
    <SettingsGroup title={t("settings.modes.writing.title")}>
      <ToggleSwitch
        grouped
        checked={enabled}
        onChange={(next) => updateLlm("enabled", next)}
        label={t("settings.modes.writing.enabled.label")}
        description={t("settings.modes.writing.enabled.description")}
      />
      {enabled ? null : (
        <div className="py-3">
          <StatusText>
            {t(
              "settings.modes.writing.disabledNote",
              "Turn on AI cleanup to use the preset, tone, provider, and model below.",
            )}
          </StatusText>
        </div>
      )}

      <SettingContainer
        grouped
        layout="stacked"
        disabled={!enabled}
        title={t("settings.modes.writing.preset.label")}
        description={t("settings.modes.writing.preset.description")}
      >
        <SegmentedRadioGroup
          name="mode-prompt-preset"
          legend={t("settings.modes.writing.preset.label")}
          value={mode.prompt.preset}
          options={presetOptions}
          onChange={(preset) => updatePrompt("preset", preset)}
          disabled={!enabled}
        />
      </SettingContainer>

      <SettingContainer
        grouped
        layout="stacked"
        disabled={!enabled}
        title={t("settings.modes.writing.tone.label")}
        description={t("settings.modes.writing.tone.description")}
      >
        <SegmentedRadioGroup
          name="mode-tone"
          legend={t("settings.modes.writing.tone.label")}
          value={mode.tone}
          options={toneOptions}
          onChange={(tone) => update("tone", tone)}
          disabled={!enabled}
        />
      </SettingContainer>

      <SettingContainer
        grouped
        disabled={!enabled}
        title={t("settings.modes.writing.provider.label")}
        description={t("settings.modes.writing.provider.description")}
      >
        <div className="flex flex-col items-end gap-1">
          <Dropdown
            selectedValue={mode.llm.provider_id}
            options={providerOptions}
            onSelect={(providerId) => updateLlm("provider_id", providerId)}
            disabled={!enabled || providerOptions.length === 0}
            placeholder={t("settings.modes.writing.provider.empty")}
          />
          {providers.length === 0 ? (
            <StatusText tone="warning">
              {t(
                "settings.modes.writing.provider.noneConfigured",
                "No AI provider is configured yet. Add one in Settings before this mode can rewrite.",
              )}
            </StatusText>
          ) : selectedProviderConfigured ? null : (
            <StatusText tone="warning">
              {t(
                "settings.modes.writing.provider.unknownSelected",
                "This mode names a provider that is not configured on this install.",
              )}
            </StatusText>
          )}
        </div>
      </SettingContainer>

      <SettingContainer
        grouped
        layout="stacked"
        disabled={!enabled}
        title={t("settings.modes.writing.model.label")}
        description={t("settings.modes.writing.model.description")}
        controlId="mode-llm-model"
      >
        <Input
          id="mode-llm-model"
          value={mode.llm.model_id}
          onChange={(event) => updateLlm("model_id", event.target.value)}
          disabled={!enabled}
          className="w-full"
        />
      </SettingContainer>
    </SettingsGroup>
  );
};
