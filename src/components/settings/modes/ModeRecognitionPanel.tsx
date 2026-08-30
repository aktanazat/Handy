import React, { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ModelInfo, VocabularyEntry } from "@/bindings";
import { SELECTABLE_LANGUAGES } from "@/lib/constants/languages";
import { getTranslatedModelName } from "@/lib/utils/modelTranslation";
import {
  Microlabel,
  Notice,
  SettingsField,
  SettingsRow,
  SettingsSection,
  SettingsSurface,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { Switch } from "@/components/vg/switch";
import { Textarea } from "@/components/vg/textarea";
import {
  DEFAULT_FALLBACK_MODEL_OPTION,
  REQUESTED_ENGINES,
  downloadedModelOptions,
  modeEngineOptions,
  type ModeCloudState,
  type ModePanelProps,
} from "./modeModel";

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

/* A select item cannot carry an empty value, and "" is what the draft stores
 * for "inherit the global model". The sentinel lives between this Select and
 * its handler only: "" is still what reaches `updateAsr`. */
const INHERIT_GLOBAL = "__mode_inherit_global__";

/* Shared by the column header and every row, so the two fields line up and
 * the trailing column stays wide enough for the remove button. */
const VOCABULARY_GRID =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 px-4 py-2";

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
          "Default: the global model ({{name}})",
          { name: getTranslatedModelName(globalModel, t) },
        )
      : t(
          "settings.modes.recognition.model.inheritGlobal",
          "Default: the global model",
        );
  }, [globalModelId, models, t]);

  /* The list is a model rather than markup: a provider without a saved key
   * stays in it carrying the reason it cannot be picked, and the menu that
   * shows it only exists once a pointer has opened it. */
  const engineOptions = useMemo(
    () => modeEngineOptions(cloud.isConfigured, t),
    [cloud.isConfigured, t],
  );
  const selectedEngineLabel = engineOptions.find(
    (option) => option.value === cloud.requestedEngine,
  )?.label;

  const localModelOptions = useMemo(() => {
    const options = downloadedModelOptions(models);
    // A mode can name a model this install no longer has. Keep it selectable
    // so opening the editor never silently rewrites the saved choice.
    if (
      mode.asr.model_id !== "" &&
      !options.some((option) => option.value === mode.asr.model_id)
    ) {
      options.unshift({ value: mode.asr.model_id, label: mode.asr.model_id });
    }
    options.unshift({ value: INHERIT_GLOBAL, label: inheritGlobalLabel });
    return options;
  }, [inheritGlobalLabel, mode.asr.model_id, models]);

  const fallbackModelOptions = useMemo(() => {
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

  const languageOptions = useMemo(
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
      {/* The tab is already named Recognition, so this surface is not. */}
      <SettingsSurface>
        <SettingsRow
          label={t("settings.modes.recognition.engine.label")}
          controlId="mode-engine"
        >
          <Select
            value={cloud.requestedEngine}
            onValueChange={(value) => {
              const next = REQUESTED_ENGINES.find(
                (candidate) => candidate === value,
              );
              if (next) cloud.selectEngine(next);
            }}
          >
            <SelectTrigger
              aria-label={t("settings.modes.recognition.engine.label")}
              id="mode-engine"
              size="sm"
              className="w-56"
            >
              {/* Radix resolves a trigger's text from its items, which only
               * mount client-side. Naming the selected option here keeps the
               * trigger legible in the server pass too. */}
              <SelectValue>{selectedEngineLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {engineOptions
                .filter((option) => !option.cloud)
                .map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              <SelectGroup>
                <SelectLabel>
                  {t("settings.modes.recognition.engine.cloud")}
                </SelectLabel>
                {engineOptions
                  .filter((option) => option.cloud)
                  .map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>

        {cloud.selectedProvider ? null : (
          <SettingsRow
            label={t("settings.modes.recognition.model.label")}
            controlId="mode-model"
          >
            <Select
              value={
                mode.asr.model_id === "" ? INHERIT_GLOBAL : mode.asr.model_id
              }
              onValueChange={(value) =>
                updateAsr("model_id", value === INHERIT_GLOBAL ? "" : value)
              }
            >
              <SelectTrigger id="mode-model" size="sm" className="w-56">
                <SelectValue placeholder={inheritGlobalLabel} />
              </SelectTrigger>
              <SelectContent>
                {localModelOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
        )}

        <SettingsRow
          label={t("settings.modes.recognition.language.label")}
          /* The cloud sentence is the one a reader cannot get from the label:
           * on a cloud engine the language is sent with the request rather
           * than handed to a local model. */
          hint={
            cloud.selectedProvider
              ? t("settings.modes.recognition.language.cloudDescription")
              : undefined
          }
          controlId="mode-language"
        >
          <Select
            value={mode.asr.language}
            onValueChange={(language) => updateAsr("language", language)}
          >
            <SelectTrigger id="mode-language" size="sm" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languageOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          label={t("settings.modes.recognition.translate.label")}
          controlId="mode-translate"
        >
          <Switch
            id="mode-translate"
            checked={mode.asr.translate_to_english}
            onCheckedChange={(enabled) =>
              updateAsr("translate_to_english", enabled)
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings.modes.recognition.vad.label")}
          controlId="mode-vad"
        >
          <Switch
            id="mode-vad"
            checked={mode.asr.vad_enabled}
            onCheckedChange={(enabled) => updateAsr("vad_enabled", enabled)}
          />
        </SettingsRow>
      </SettingsSurface>

      {cloud.selectedProvider && !cloud.controlsAvailable ? (
        <Notice tone="warning" live>
          {t("settings.modes.recognition.cloud.setupRequired", {
            provider: t(cloud.selectedProvider.labelKey),
          })}
        </Notice>
      ) : null}

      {cloud.selectedProvider && cloud.controlsAvailable ? (
        <SettingsSection
          label={t("settings.modes.recognition.cloud.title", "Cloud transport")}
        >
          <SettingsRow
            label={t("settings.modes.recognition.cloud.fallback.label")}
            /* Which failure hands the run back to a local model, and that the
             * captured audio is what gets re-transcribed. */
            hint={t("settings.modes.recognition.cloud.fallback.description")}
            controlId="mode-local-fallback"
          >
            <Switch
              id="mode-local-fallback"
              checked={localFallbackEnabled}
              onCheckedChange={(enabled) =>
                updateAsr("local_fallback_enabled", enabled)
              }
            />
          </SettingsRow>
          {localFallbackEnabled ? (
            /* Stacked rather than flush right: the unsaved-mode warning below
             * the select is a full sentence, and a shrink-0 control slot would
             * push it off the row. */
            <SettingsField
              label={t("settings.modes.recognition.cloud.fallback.model.label")}
              controlId="mode-fallback-model"
            >
              <div className="flex flex-col gap-1.5">
                <Select
                  value={
                    mode.asr.local_fallback_model_id ??
                    DEFAULT_FALLBACK_MODEL_OPTION
                  }
                  onValueChange={(modelId) =>
                    updateAsr(
                      "local_fallback_model_id",
                      modelId === DEFAULT_FALLBACK_MODEL_OPTION
                        ? null
                        : modelId,
                    )
                  }
                >
                  {/* Full width, not the w-56 the flush-right rows use: this
                   * control is stacked in a field, its sibling textarea is
                   * full width, and this list can carry a bare model ID as a
                   * label (see fallbackModelOptions). Nothing is gained by
                   * boxing it narrower than the field it sits in. */}
                  <SelectTrigger
                    id="mode-fallback-model"
                    size="sm"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fallbackModelOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {missingFallbackModel ? (
                  <Notice tone="danger" live>
                    {t(
                      "settings.modes.recognition.cloud.fallback.model.required",
                    )}
                  </Notice>
                ) : null}
              </div>
            </SettingsField>
          ) : null}
          <SettingsField
            label={t("settings.modes.recognition.cloud.keyterms.label")}
            /* One term per line is the parsing contract, and the terms leave
             * the device with the request. */
            hint={t("settings.modes.recognition.cloud.keyterms.description")}
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
            />
          </SettingsField>
          <SettingsRow
            label={t("settings.modes.recognition.cloud.timestamps.label")}
            /* The only account of why a switch that is on cannot be moved. */
            hint={t("settings.modes.recognition.cloud.timestamps.description")}
            controlId="mode-cloud-timestamps"
            disabled
          >
            <Switch
              id="mode-cloud-timestamps"
              checked
              disabled
              onCheckedChange={() => undefined}
            />
          </SettingsRow>
        </SettingsSection>
      ) : null}

      <SettingsSection
        label={t("settings.modes.cleanup.title", "Transcript cleanup")}
      >
        <SettingsRow
          label={t("settings.modes.recognition.literalPunctuation.label")}
          /* Which direction the conversion runs, and that it happens before
           * vocabulary corrections. */
          hint={t("settings.modes.recognition.literalPunctuation.description")}
          controlId="mode-literal-punctuation"
        >
          <Switch
            id="mode-literal-punctuation"
            checked={mode.asr.literal_punctuation ?? false}
            onCheckedChange={(enabled) =>
              updateAsr("literal_punctuation", enabled)
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings.modes.recognition.fillerRemoval.label")}
          controlId="mode-filler-removal"
        >
          <Switch
            id="mode-filler-removal"
            checked={mode.asr.filler_word_removal_enabled}
            onCheckedChange={(enabled) =>
              updateAsr("filler_word_removal_enabled", enabled)
            }
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        label={t("settings.modes.recognition.vocabulary.label")}
        action={
          <Button variant="outline" size="sm" onClick={vocabulary.add}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            {t("settings.modes.recognition.vocabulary.add")}
          </Button>
        }
      >
        {mode.asr.custom_words.length === 0 ? (
          <div className="px-4 py-3">
            <Notice live={false}>
              {t(
                "settings.modes.recognition.vocabulary.empty",
                "This mode has no vocabulary of its own. Global vocabulary still applies.",
              )}
            </Notice>
          </div>
        ) : (
          <>
            {/* Hidden from assistive tech: every field below carries its own
             * label, so this is a visual alignment cue. */}
            <div aria-hidden="true" className={VOCABULARY_GRID}>
              <Microlabel className="truncate">
                {t("settings.modes.recognition.vocabulary.spoken")}
              </Microlabel>
              <Microlabel className="truncate">
                {t("settings.modes.recognition.vocabulary.written")}
              </Microlabel>
            </div>
            <ul
              // Tailwind's reset drops the marker, which also drops list
              // semantics in WebKit. The explicit role puts them back.
              role="list"
              aria-label={t("settings.modes.recognition.vocabulary.label")}
              className="divide-y divide-gray-alpha-400"
            >
              {mode.asr.custom_words.map((entry, index) => (
                <li key={vocabulary.rowKey(entry)} className={VOCABULARY_GRID}>
                  <Input
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
                    aria-invalid={entry.spoken.trim() === "" || undefined}
                  />
                  <Input
                    value={entry.written}
                    onChange={(event) =>
                      vocabulary.setField(index, "written", event.target.value)
                    }
                    placeholder={t(
                      "settings.modes.recognition.vocabulary.writtenPlaceholder",
                    )}
                    aria-label={t(
                      "settings.modes.recognition.vocabulary.written",
                    )}
                    aria-invalid={entry.written.trim() === "" || undefined}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="justify-self-end text-red-900 hover:text-red-900"
                    aria-label={t(
                      "settings.modes.recognition.vocabulary.remove",
                      { spoken: entry.spoken },
                    )}
                    onClick={() => vocabulary.remove(index)}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
        {vocabulary.incomplete ? (
          <div className="px-4 py-3">
            <Notice tone="danger" live>
              {t("settings.modes.recognition.vocabulary.incomplete")}
            </Notice>
          </div>
        ) : null}
      </SettingsSection>
    </>
  );
};
