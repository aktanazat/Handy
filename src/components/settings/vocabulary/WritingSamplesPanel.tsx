import React, { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/vg/button";
import { Textarea } from "@/components/vg/textarea";
import {
  Microlabel,
  Notice,
  SettingsField,
  SettingsSection,
} from "@/components/settings/rows";
import { EmptyLine, LoadingRows } from "./PanelParts";
import {
  countWords,
  getPersonaSamples,
  savePersonaSamples,
  PERSONA_SAMPLES_MAX,
  PERSONA_SAMPLE_MAX_WORDS,
  type PersonaSample,
} from "../../../lib/powerPackApi";

type LoadState = "loading" | "ready" | "failed";

/**
 * Samples of the user's own writing, injected into every rewrite as
 * voice-matching examples.
 *
 * They are global rather than per mode because a person has one writing voice;
 * copying it into each mode would create several sources of truth for the same
 * fact. They apply to every mode that rewrites, including the preset-based
 * modes the mode editor creates.
 */
export const WritingSamplesPanel: React.FC = () => {
  const { t } = useTranslation();
  const [samples, setSamples] = useState<PersonaSample[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    try {
      setSamples(await getPersonaSamples());
      setLoadState("ready");
    } catch (error) {
      setLoadError(String(error));
      setLoadState("failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* The backend drops blank samples, so an empty editor row is kept local until
   * it has text. Saving answers with the normalized list. */
  const commit = async (next: PersonaSample[]) => {
    if (busy) return;
    setBusy(true);
    setWriteError(null);
    try {
      setSamples(await savePersonaSamples(next));
    } catch (error) {
      setWriteError(String(error));
    } finally {
      setBusy(false);
    }
  };

  const addSample = () => {
    if (samples.length >= PERSONA_SAMPLES_MAX) return;
    setSamples([
      ...samples,
      { id: `sample_${Date.now()}_${samples.length}`, text: "" },
    ]);
  };

  const body = () => {
    if (loadState === "loading") {
      return (
        <LoadingRows
          label={t("settings.prompts.samples.loading", "Loading samples")}
        />
      );
    }

    if (loadState === "failed") {
      return (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Notice tone="danger">
            {loadError ??
              t(
                "settings.prompts.samples.loadError",
                "Could not load samples.",
              )}
          </Notice>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t("common.retry")}
          </Button>
        </div>
      );
    }

    if (samples.length === 0) {
      return (
        <EmptyLine
          text={t(
            "settings.prompts.samples.empty.description",
            "Paste a few paragraphs you wrote yourself and rewrites will follow your vocabulary, sentence length, and formality.",
          )}
          action={
            <Button variant="outline" size="sm" onClick={addSample}>
              <Plus aria-hidden="true" />
              {t("settings.prompts.samples.add", "Add sample")}
            </Button>
          }
        />
      );
    }

    return (
      <>
        {samples.map((sample, index) => {
          const words = countWords(sample.text);
          const overLimit = words > PERSONA_SAMPLE_MAX_WORDS;
          const fieldId = `persona-sample-${sample.id}`;
          return (
            <SettingsField
              key={sample.id}
              label={t("settings.prompts.samples.sampleLabel", {
                defaultValue: "Writing sample {{number}}",
                number: index + 1,
              })}
              controlId={fieldId}
              fact={
                <span
                  aria-live={overLimit ? "polite" : "off"}
                  className={overLimit ? "text-amber-900" : undefined}
                >
                  {overLimit
                    ? t("settings.prompts.samples.overLimit", {
                        defaultValue:
                          "{{words}} words. Only the first {{max}} are used.",
                        words,
                        max: PERSONA_SAMPLE_MAX_WORDS,
                      })
                    : t("settings.prompts.samples.wordCount", {
                        defaultValue: "{{words}} of {{max}} words",
                        words,
                        max: PERSONA_SAMPLE_MAX_WORDS,
                      })}
                </span>
              }
            >
              {/* `SettingsField` takes only its documented props, so the
               * row's test handle rides on the block it wraps. */}
              <div
                className="flex items-start gap-2"
                data-testid="persona-sample-row"
              >
                {/* Prose in the person's own voice, so it is set as prose. */}
                <Textarea
                  id={fieldId}
                  /* 13px prose at the app's body leading. `leading-5` is
                   * 17.5px at the 14px root, which is tight for paragraphs. */
                  className="min-h-24 flex-1 text-[13px] leading-[19px]"
                  rows={5}
                  value={sample.text}
                  onChange={(event) =>
                    setSamples(
                      samples.map((current, position) =>
                        position === index
                          ? { ...current, text: event.target.value }
                          : current,
                      ),
                    )
                  }
                  onBlur={() => void commit(samples)}
                  placeholder={t(
                    "settings.prompts.samples.placeholder",
                    "Paste a paragraph you wrote.",
                  )}
                  disabled={busy}
                  data-testid={`persona-sample-${index}`}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-gray-700 hover:text-red-900"
                  onClick={() =>
                    void commit(
                      samples.filter((_, position) => position !== index),
                    )
                  }
                  disabled={busy}
                  aria-label={t("settings.prompts.samples.delete", {
                    defaultValue: "Delete sample {{number}}",
                    number: index + 1,
                  })}
                  data-testid={`persona-sample-delete-${index}`}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </SettingsField>
          );
        })}

        {samples.length < PERSONA_SAMPLES_MAX && (
          <div className="px-4 py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={addSample}
              disabled={busy}
              data-testid="persona-sample-add"
            >
              <Plus aria-hidden="true" />
              {t("settings.prompts.samples.add", "Add sample")}
            </Button>
          </div>
        )}

        {writeError && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Notice tone="danger">{writeError}</Notice>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t("common.retry")}
            </Button>
          </div>
        )}
      </>
    );
  };

  return (
    <SettingsSection
      label={t("settings.prompts.samples.title", "Writing samples")}
      action={
        loadState === "ready" && samples.length > 0 ? (
          /* The cap is the reason this count is worth printing: it is the only
           * thing that explains where the Add button goes. */
          <Microlabel className="tabular-nums">
            {samples.length} / {PERSONA_SAMPLES_MAX}
          </Microlabel>
        ) : undefined
      }
    >
      <div
        className="divide-y divide-gray-alpha-400"
        data-testid="persona-samples-editor"
      >
        {body()}
        <Notice live={false} className="px-4 py-3">
          {/* The cap moved to the count in the header, so this sentence is
           * being trimmed to its privacy half. `max` stays supplied until that
           * catalogue edit lands, so neither version renders a raw
           * placeholder. */}
          {t("settings.prompts.samples.privacy", {
            defaultValue:
              "Samples are sent wherever the transcript itself already goes, and nowhere else.",
            max: PERSONA_SAMPLES_MAX,
          })}
        </Notice>
      </div>
    </SettingsSection>
  );
};
