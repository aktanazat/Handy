import React from "react";
import { useTranslation } from "react-i18next";
import type { PostProcessProvider, PromptPreset, Tone } from "@/bindings";
import {
  Notice,
  SettingsField,
  SettingsRow,
  SettingsSurface,
} from "@/components/settings/rows";
import { Input } from "@/components/vg/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { Switch } from "@/components/vg/switch";
import { SegmentedRadioGroup, type SegmentedOption } from "./ModeControls";
import { PROMPT_PRESETS, TONES, type ModePanelProps } from "./modeModel";

export interface ModeRewritePanelProps extends ModePanelProps {
  providers: readonly PostProcessProvider[];
}

/* The Rewrite tab is one group, and the tab already names it, so the surface
 * carries no heading of its own. */
export const ModeRewritePanel: React.FC<ModeRewritePanelProps> = ({
  mode,
  updaters,
  providers,
}) => {
  const { t } = useTranslation();
  const { update, updateLlm, updatePrompt } = updaters;
  const enabled = mode.llm.enabled;

  const providerOptions: { value: string; label: string }[] = providers.map(
    (provider) => ({
      value: provider.id,
      label: provider.label,
    }),
  );
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
  /* Radix reads the trigger's text out of the mounted items, which only exist
   * once the list has been opened in a browser. Name the selected label here
   * so the row states its own value the way the old dropdown did. */
  const selectedProviderLabel = providerOptions.find(
    (option) => option.value === mode.llm.provider_id,
  )?.label;

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
    <SettingsSurface>
      <SettingsRow
        label={t("settings.modes.writing.enabled.label")}
        controlId="mode-llm-enabled"
      >
        <Switch
          id="mode-llm-enabled"
          checked={enabled}
          onCheckedChange={(next) => updateLlm("enabled", next)}
        />
      </SettingsRow>
      {enabled ? null : (
        <div className="px-4 py-3">
          <Notice live={false}>
            {t(
              "settings.modes.writing.disabledNote",
              "Turn on AI cleanup to use the preset, tone, provider, and model below.",
            )}
          </Notice>
        </div>
      )}

      <SettingsField
        disabled={!enabled}
        label={t("settings.modes.writing.preset.label")}
        /* The one thing the segments cannot show: what a preset actually
         * instructs stays hidden and unexportable. */
        hint={t("settings.modes.writing.preset.description")}
      >
        <SegmentedRadioGroup
          name="mode-prompt-preset"
          legend={t("settings.modes.writing.preset.label")}
          value={mode.prompt.preset}
          options={presetOptions}
          onChange={(preset) => updatePrompt("preset", preset)}
          disabled={!enabled}
        />
      </SettingsField>

      <SettingsField
        disabled={!enabled}
        label={t("settings.modes.writing.tone.label")}
      >
        <SegmentedRadioGroup
          name="mode-tone"
          legend={t("settings.modes.writing.tone.label")}
          value={mode.tone}
          options={toneOptions}
          onChange={(tone) => update("tone", tone)}
          disabled={!enabled}
        />
      </SettingsField>

      <SettingsRow
        disabled={!enabled}
        label={t("settings.modes.writing.provider.label")}
        controlId="mode-llm-provider"
      >
        <div className="flex flex-col items-end gap-1">
          <Select
            value={mode.llm.provider_id}
            onValueChange={(providerId) => updateLlm("provider_id", providerId)}
            disabled={!enabled || providerOptions.length === 0}
          >
            <SelectTrigger id="mode-llm-provider" className="w-56">
              <SelectValue
                placeholder={t("settings.modes.writing.provider.empty")}
              >
                {selectedProviderLabel}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {providerOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {providers.length === 0 ? (
            <Notice tone="warning" live={false}>
              {t(
                "settings.modes.writing.provider.noneConfigured",
                "No AI provider is configured yet. Add one in Settings before this mode can rewrite.",
              )}
            </Notice>
          ) : selectedProviderConfigured ? null : (
            <Notice tone="warning" live={false}>
              {t(
                "settings.modes.writing.provider.unknownSelected",
                "This mode names a provider that is not configured on this install.",
              )}
            </Notice>
          )}
        </div>
      </SettingsRow>

      <SettingsField
        disabled={!enabled}
        label={t("settings.modes.writing.model.label")}
        controlId="mode-llm-model"
      >
        <Input
          id="mode-llm-model"
          value={mode.llm.model_id}
          onChange={(event) => updateLlm("model_id", event.target.value)}
          disabled={!enabled}
          className="w-full"
        />
      </SettingsField>
    </SettingsSurface>
  );
};
