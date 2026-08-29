import React, { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  IconButton,
  SettingContainer,
  Textarea,
} from "../../ui";
import { EmptyHint, Hint, LoadingRows } from "./PanelParts";
import {
  countWords,
  getPersonaSamples,
  savePersonaSamples,
  PERSONA_SAMPLES_MAX,
  PERSONA_SAMPLE_MAX_WORDS,
  type PersonaSample,
} from "../../../lib/powerPackApi";
import "./vocabulary.css";

interface WritingSamplesPanelProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

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
export const WritingSamplesPanel: React.FC<WritingSamplesPanelProps> = ({
  descriptionMode = "inline",
  grouped = false,
}) => {
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
        <Alert
          variant="error"
          action={
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              {t("common.retry")}
            </Button>
          }
        >
          {loadError ??
            t("settings.prompts.samples.loadError", "Could not load samples.")}
        </Alert>
      );
    }

    return (
      <>
        {samples.length === 0 ? (
          <EmptyHint
            title={t("settings.prompts.samples.empty.title", "No samples yet")}
            description={t(
              "settings.prompts.samples.empty.description",
              "Paste a few paragraphs you wrote yourself and rewrites will follow your vocabulary, sentence length, and formality.",
            )}
            action={
              <Button size="sm" variant="secondary" onClick={addSample}>
                {t("settings.prompts.samples.empty.action", "Add a sample")}
              </Button>
            }
          />
        ) : (
          <ul className="persona-samples">
            {samples.map((sample, index) => {
              const words = countWords(sample.text);
              const overLimit = words > PERSONA_SAMPLE_MAX_WORDS;
              return (
                /* A sample is a block of the person's own prose quoted back at
                 * them, which is what the recessed panel is for. The textarea
                 * gives up its own border so the panel is the only edge. */
                <li
                  key={sample.id}
                  className="inset-panel persona-sample"
                  data-testid="persona-sample-row"
                >
                  <Textarea
                    className="w-full"
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
                    aria-label={t("settings.prompts.samples.sampleLabel", {
                      defaultValue: "Writing sample {{number}}",
                      number: index + 1,
                    })}
                    disabled={busy}
                    data-testid={`persona-sample-${index}`}
                  />
                  <div className="persona-sample-footer">
                    <Hint
                      className="numeric"
                      tone={overLimit ? "warning" : "muted"}
                      live={overLimit ? "polite" : "off"}
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
                    </Hint>
                    <IconButton
                      size="sm"
                      variant="danger-ghost"
                      label={t("settings.prompts.samples.delete", {
                        defaultValue: "Delete sample {{number}}",
                        number: index + 1,
                      })}
                      onClick={() =>
                        void commit(
                          samples.filter((_, position) => position !== index),
                        )
                      }
                      disabled={busy}
                      data-testid={`persona-sample-delete-${index}`}
                      icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {samples.length > 0 && samples.length < PERSONA_SAMPLES_MAX && (
          <Button
            size="sm"
            variant="secondary"
            className="gap-1"
            onClick={addSample}
            disabled={busy}
            data-testid="persona-sample-add"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {t("settings.prompts.samples.add", "Add sample")}
          </Button>
        )}

        {writeError && (
          <Alert
            variant="error"
            action={
              <Button size="sm" variant="secondary" onClick={() => void load()}>
                {t("common.retry")}
              </Button>
            }
          >
            {writeError}
          </Alert>
        )}

        <Hint>
          {t("settings.prompts.samples.privacy", {
            defaultValue:
              "Samples are sent wherever the transcript itself already goes, and nowhere else. Up to {{max}} samples are used.",
            max: PERSONA_SAMPLES_MAX,
          })}
        </Hint>
      </>
    );
  };

  return (
    <SettingContainer
      title={t("settings.prompts.samples.title", "Writing samples")}
      description={t(
        "settings.prompts.samples.description",
        "Examples of your own writing. Every mode that rewrites a transcript matches their voice.",
      )}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="stacked"
    >
      <div className="space-y-3" data-testid="persona-samples-editor">
        {body()}
      </div>
    </SettingContainer>
  );
};
