import React, { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ModelInfo, VocabularyEntry } from "@/bindings";
import { CLOUD_STT_PROVIDERS } from "@/lib/cloudStt";
import { SELECTABLE_LANGUAGES } from "@/lib/constants/languages";
import { getTranslatedModelName } from "@/lib/utils/modelTranslation";
import {
  Button,
  Dropdown,
  IconButton,
  Input,
  SettingContainer,
  SettingsGroup,
  StatusText,
  Textarea,
  ToggleSwitch,
  type DropdownOption,
} from "@/components/ui";
import {
  DEFAULT_FALLBACK_MODEL_OPTION,
  REQUESTED_ENGINES,
  downloadedModelOptions,
  type ModeCloudState,
  type ModePanelProps,
} from "./modeModel";
import { ColumnHeader, Hint, RuleList } from "../vocabulary/PanelParts";

export interface ModeVocabularyEditor {
  /** Stable key per entry object, so editing one row never remounts another. */
  rowKey: (entry: VocabularyEntry) => string;
  setField: (index: number, field: "spoken" | "written", value: string) => void;
  add: () => void;
  remove: (index: number) => void;
  incomplete: boolean;
}

export interface ModeRecognitionPanelProps extends ModePanelProps {
  models: ModelInfo[];
  /** The globally selected model an empty per-mode model inherits. */
  globalModelId: string;
  cloud: ModeCloudState;
  vocabulary: ModeVocabularyEditor;
  /** Cloud fallback is on but neither this mode nor the fallback names a model. */
  missingFallbackModel: boolean;
}

/* Shared by the column header and every row, so the two fields line up and
 * the trailing column stays wide enough for the 28px remove button. */
const VOCABULARY_GRID =
  "grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem]";

export const ModeRecognitionPanel: React.FC<ModeRecognitionPanelProps> = ({
  mode,
  updaters,
  models,
  globalModelId,
  cloud,
  vocabulary,
  missingFallbackModel,
}) => {
  const { t } = useTranslation();
  const { updateAsr } = updaters;

  /* An empty per-mode model is not "unset", it means "use whatever the app is
   * set to", which the backend resolves when it builds the plan. Naming the
   * model that will actually run is the difference between a default and a
   * gap. */
  const inheritGlobalLabel = useMemo(() => {
    const globalModel = models.find((model) => model.id === globalModelId);
    return globalModel
      ? t(
          "settings.modes.recognition.model.inheritGlobalNamed",
          "Default \u2014 uses the global model ({{name}})",
          { name: getTranslatedModelName(globalModel, t) },
        )
      : t(
          "settings.modes.recognition.model.inheritGlobal",
          "Default \u2014 uses the global model",
        );
  }, [globalModelId, models, t]);

  const localModelOptions = useMemo<DropdownOption[]>(() => {
    const options = downloadedModelOptions(models);
    // A mode can name a model this install no longer has. Keep it selectable
    // so opening the editor never silently rewrites the saved choice.
    if (
      mode.asr.model_id !== "" &&
      !options.some((option) => option.value === mode.asr.model_id)
    ) {
      options.unshift({ value: mode.asr.model_id, label: mode.asr.model_id });
    }
    options.unshift({ value: "", label: inheritGlobalLabel });
    return options;
  }, [inheritGlobalLabel, mode.asr.model_id, models]);

  const fallbackModelOptions = useMemo<DropdownOption[]>(() => {
    const options = downloadedModelOptions(models);
    const selected = mode.asr.local_fallback_model_id;
    if (selected && !options.some((option) => option.value === selected)) {
      options.unshift({ value: selected, label: selected });
    }
    options.unshift({
      value: DEFAULT_FALLBACK_MODEL_OPTION,
      label: t("settings.modes.recognition.cloud.fallback.useModeModel"),
    });
    return options;
  }, [mode.asr.local_fallback_model_id, models, t]);

  const languageOptions = useMemo<DropdownOption[]>(
    () =>
      SELECTABLE_LANGUAGES.map((language) => ({
        value: language.value,
        label:
          language.value === "auto"
            ? t("settings.modes.recognition.language.auto")
            : language.label,
      })),
    [t],
  );

  const localFallbackEnabled = mode.asr.local_fallback_enabled ?? true;

  return (
    <>
      <SettingsGroup title={t("settings.modes.recognition.title")}>
        <SettingContainer
          grouped
          title={t("settings.modes.recognition.engine.label")}
          description={t("settings.modes.recognition.engine.description")}
          controlId="mode-engine"
        >
          <select
            aria-label={t("settings.modes.recognition.engine.label")}
            id="mode-engine"
            value={cloud.requestedEngine}
            onChange={(event) => {
              const next = REQUESTED_ENGINES.find(
                (candidate) => candidate === event.target.value,
              );
              if (next) cloud.selectEngine(next);
            }}
            /* Fill, border, radius, height, padding and hover all come from
             * `.settings-main select` in primitives.css. Only the type scale
             * and the flex sizing are this control's own. */
            className="min-w-0 text-[13px] font-medium text-text-primary"
          >
            <option value="local">
              {t("settings.modes.recognition.engine.local")}
            </option>
            <optgroup label={t("settings.modes.recognition.engine.cloud")}>
              {CLOUD_STT_PROVIDERS.map((provider) => {
                const configured = cloud.isConfigured(provider.provider);
                return (
                  <option
                    key={provider.provider}
                    value={provider.provider}
                    disabled={!configured}
                  >
                    {configured
                      ? t(provider.labelKey)
                      : t("settings.modes.recognition.engine.unavailable", {
                          provider: t(provider.labelKey),
                        })}
                  </option>
                );
              })}
            </optgroup>
          </select>
        </SettingContainer>

        {cloud.selectedProvider ? null : (
          <SettingContainer
            grouped
            title={t("settings.modes.recognition.model.label")}
            description={t("settings.modes.recognition.model.description")}
          >
            <Dropdown
              selectedValue={mode.asr.model_id}
              options={localModelOptions}
              onSelect={(modelId) => updateAsr("model_id", modelId)}
              placeholder={inheritGlobalLabel}
            />
          </SettingContainer>
        )}

        <SettingContainer
          grouped
          title={t("settings.modes.recognition.language.label")}
          description={
            cloud.selectedProvider
              ? t("settings.modes.recognition.language.cloudDescription")
              : t("settings.modes.recognition.language.description")
          }
        >
          <Dropdown
            selectedValue={mode.asr.language}
            options={languageOptions}
            onSelect={(language) => updateAsr("language", language)}
          />
        </SettingContainer>

        <ToggleSwitch
          grouped
          checked={mode.asr.translate_to_english}
          onChange={(enabled) => updateAsr("translate_to_english", enabled)}
          label={t("settings.modes.recognition.translate.label")}
          description={t("settings.modes.recognition.translate.description")}
        />
        <ToggleSwitch
          grouped
          checked={mode.asr.vad_enabled}
          onChange={(enabled) => updateAsr("vad_enabled", enabled)}
          label={t("settings.modes.recognition.vad.label")}
          description={t("settings.modes.recognition.vad.description")}
        />
      </SettingsGroup>

      {cloud.selectedProvider && !cloud.controlsAvailable ? (
        <StatusText tone="warning" live="polite">
          {t("settings.modes.recognition.cloud.setupRequired", {
            provider: t(cloud.selectedProvider.labelKey),
          })}
        </StatusText>
      ) : null}

      {cloud.selectedProvider && cloud.controlsAvailable ? (
        <SettingsGroup
          title={t("settings.modes.recognition.cloud.title", "Cloud transport")}
        >
          <ToggleSwitch
            grouped
            checked={localFallbackEnabled}
            onChange={(enabled) => updateAsr("local_fallback_enabled", enabled)}
            label={t("settings.modes.recognition.cloud.fallback.label")}
            description={t(
              "settings.modes.recognition.cloud.fallback.description",
            )}
          />
          {localFallbackEnabled ? (
            <SettingContainer
              grouped
              title={t("settings.modes.recognition.cloud.fallback.model.label")}
              description={t(
                "settings.modes.recognition.cloud.fallback.model.description",
              )}
            >
              <div className="flex flex-col items-end gap-1">
                <Dropdown
                  selectedValue={
                    mode.asr.local_fallback_model_id ??
                    DEFAULT_FALLBACK_MODEL_OPTION
                  }
                  options={fallbackModelOptions}
                  onSelect={(modelId) =>
                    updateAsr(
                      "local_fallback_model_id",
                      modelId === DEFAULT_FALLBACK_MODEL_OPTION
                        ? null
                        : modelId,
                    )
                  }
                />
                {missingFallbackModel ? (
                  <StatusText tone="danger" live="polite">
                    {t(
                      "settings.modes.recognition.cloud.fallback.model.required",
                    )}
                  </StatusText>
                ) : null}
              </div>
            </SettingContainer>
          ) : null}
          <SettingContainer
            grouped
            layout="stacked"
            title={t("settings.modes.recognition.cloud.keyterms.label")}
            description={t(
              "settings.modes.recognition.cloud.keyterms.description",
            )}
            controlId="mode-cloud-keyterms"
          >
            <Textarea
              id="mode-cloud-keyterms"
              value={mode.asr.cloud_keyterms?.join("\n") ?? ""}
              onChange={(event) => {
                const keyterms: string[] = [];
                for (const line of event.target.value.split("\n")) {
                  const keyterm = line.trim();
                  if (keyterm.length > 0) keyterms.push(keyterm);
                }
                updateAsr("cloud_keyterms", keyterms);
              }}
              placeholder={t(
                "settings.modes.recognition.cloud.keyterms.placeholder",
              )}
              rows={3}
              className="w-full"
            />
          </SettingContainer>
          <ToggleSwitch
            grouped
            checked
            disabled
            onChange={() => undefined}
            label={t("settings.modes.recognition.cloud.timestamps.label")}
            description={t(
              "settings.modes.recognition.cloud.timestamps.description",
            )}
          />
        </SettingsGroup>
      ) : null}

      <SettingsGroup
        title={t("settings.modes.cleanup.title", "Transcript cleanup")}
      >
        <ToggleSwitch
          grouped
          checked={mode.asr.literal_punctuation ?? false}
          onChange={(enabled) => updateAsr("literal_punctuation", enabled)}
          label={t("settings.modes.recognition.literalPunctuation.label")}
          description={t(
            "settings.modes.recognition.literalPunctuation.description",
          )}
        />
        <ToggleSwitch
          grouped
          checked={mode.asr.filler_word_removal_enabled}
          onChange={(enabled) =>
            updateAsr("filler_word_removal_enabled", enabled)
          }
          label={t("settings.modes.recognition.fillerRemoval.label")}
          description={t(
            "settings.modes.recognition.fillerRemoval.description",
          )}
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.modes.recognition.vocabulary.label")}
        description={t("settings.modes.recognition.vocabulary.description")}
      >
        <div className="flex flex-col gap-3 py-3">
          {mode.asr.custom_words.length === 0 ? (
            <Hint>
              {t(
                "settings.modes.recognition.vocabulary.empty",
                "This mode has no vocabulary of its own. Global vocabulary still applies.",
              )}
            </Hint>
          ) : (
            <>
              <ColumnHeader
                gridClassName={VOCABULARY_GRID}
                start={t("settings.modes.recognition.vocabulary.spoken")}
                end={t("settings.modes.recognition.vocabulary.written")}
              />
              <RuleList
                label={t("settings.modes.recognition.vocabulary.label")}
              >
                {mode.asr.custom_words.map((entry, index) => (
                  <li
                    key={vocabulary.rowKey(entry)}
                    className={`${VOCABULARY_GRID} py-2`}
                  >
                    <Input
                      variant="compact"
                      value={entry.spoken}
                      onChange={(event) =>
                        vocabulary.setField(index, "spoken", event.target.value)
                      }
                      placeholder={t(
                        "settings.modes.recognition.vocabulary.spokenPlaceholder",
                      )}
                      aria-label={t(
                        "settings.modes.recognition.vocabulary.spoken",
                      )}
                      invalid={entry.spoken.trim() === ""}
                    />
                    <Input
                      variant="compact"
                      value={entry.written}
                      onChange={(event) =>
                        vocabulary.setField(
                          index,
                          "written",
                          event.target.value,
                        )
                      }
                      placeholder={t(
                        "settings.modes.recognition.vocabulary.writtenPlaceholder",
                      )}
                      aria-label={t(
                        "settings.modes.recognition.vocabulary.written",
                      )}
                      invalid={entry.written.trim() === ""}
                    />
                    <IconButton
                      size="sm"
                      variant="danger-ghost"
                      className="justify-self-end"
                      icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                      label={t("settings.modes.recognition.vocabulary.remove", {
                        spoken: entry.spoken,
                      })}
                      onClick={() => vocabulary.remove(index)}
                    />
                  </li>
                ))}
              </RuleList>
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="gap-1"
              onClick={vocabulary.add}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              {t("settings.modes.recognition.vocabulary.add")}
            </Button>
            {vocabulary.incomplete ? (
              <StatusText tone="danger" live="polite">
                {t("settings.modes.recognition.vocabulary.incomplete")}
              </StatusText>
            ) : null}
          </div>
        </div>
      </SettingsGroup>
    </>
  );
};
