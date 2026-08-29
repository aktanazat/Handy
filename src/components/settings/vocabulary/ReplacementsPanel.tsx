import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Dialog,
  IconButton,
  Input,
  SettingContainer,
  Switch,
  ToggleSwitch,
} from "../../ui";
import { useSettings } from "../../../hooks/useSettings";
import { EmptyHint, Hint, LoadingRows } from "./PanelParts";
import {
  getTextReplacements,
  resetTextReplacements,
  saveTextReplacements,
  setTextReplacementsEnabled,
  type ReplacementRule,
} from "../../../lib/powerPackApi";
import "./vocabulary.css";

interface ReplacementsPanelProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

type LoadState = "loading" | "ready" | "failed";

/* The create row above the table shares the table's column model: two text
 * columns and a 7.5rem trailing block matching the switch plus remove pair. */
const ROW_GRID =
  "grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7.5rem]";

/** Rules have no id, so a row is addressed by its position in the list. */
const spokenKey = (spoken: string): string => spoken.trim().toLowerCase();

/**
 * Deterministic spoken-phrase rewrites, applied before vocabulary correction.
 *
 * Distinct from the vocabulary above it: a vocabulary entry biases what the
 * recognizer hears, a replacement rewrites what it already heard. Every write
 * answers with the whole normalized list, so state comes from the command
 * result and never from a second read.
 */
export const ReplacementsPanel: React.FC<ReplacementsPanelProps> = ({
  descriptionMode = "inline",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { settings, refreshSettings } = useSettings();
  const createRowRef = useRef<HTMLDivElement>(null);
  const [rules, setRules] = useState<ReplacementRule[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const [newSpoken, setNewSpoken] = useState("");
  const [newWritten, setNewWritten] = useState("");
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    try {
      setRules(await getTextReplacements());
      setLoadState("ready");
    } catch (error) {
      setLoadError(String(error));
      setLoadState("failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (settings) {
      setEnabled(settings.replacements_enabled ?? true);
    }
  }, [settings]);

  const focusNewSpoken = () => {
    createRowRef.current?.getElementsByTagName("input")[0]?.focus();
  };

  /* Writes are serialized: each command returns the authoritative list, so two
   * in flight at once would let the slower answer overwrite the newer one. */
  const runWrite = async (
    write: () => Promise<ReplacementRule[]>,
    afterWrite?: () => void,
  ) => {
    setBusy(true);
    setWriteError(null);
    try {
      setRules(await write());
      afterWrite?.();
    } catch (error) {
      setWriteError(String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (next: boolean) => {
    const previous = enabled;
    setTogglePending(true);
    setWriteError(null);
    setEnabled(next);
    try {
      await setTextReplacementsEnabled(next);
      // Other surfaces read settings from the store, so leave its copy correct.
      await refreshSettings();
    } catch (error) {
      setEnabled(previous);
      setWriteError(String(error));
    } finally {
      setTogglePending(false);
    }
  };

  const spokenLabel = t("settings.vocabulary.replacements.spoken", "You say");
  const writtenLabel = t(
    "settings.vocabulary.replacements.written",
    "Sona writes",
  );
  const duplicateText = t(
    "settings.vocabulary.replacements.errors.duplicate",
    "Another rule already uses this phrase.",
  );
  const incompleteText = t(
    "settings.vocabulary.replacements.errors.incomplete",
    "Enter both a spoken phrase and its replacement.",
  );

  const trimmedSpoken = newSpoken.trim();
  const spokenTaken =
    trimmedSpoken !== "" &&
    rules.some((rule) => spokenKey(rule.spoken) === spokenKey(newSpoken));
  const newIncomplete = trimmedSpoken === "" || newWritten === "";
  const draftStarted = newSpoken !== "" || newWritten !== "";
  const createHint = spokenTaken
    ? duplicateText
    : newIncomplete && draftStarted
      ? incompleteText
      : null;

  const createRule = () => {
    if (newIncomplete || spokenTaken || busy) return;
    void runWrite(
      () =>
        saveTextReplacements([
          ...rules,
          { spoken: trimmedSpoken, written: newWritten, enabled: true },
        ]),
      () => {
        setNewSpoken("");
        setNewWritten("");
        focusNewSpoken();
      },
    );
  };

  const replaceRuleAt = (index: number, next: ReplacementRule) =>
    rules.map((rule, position) => (position === index ? next : rule));

  /* Saving is deferred until every row is complete. The backend drops a rule
   * that could never fire, so writing mid-edit would delete the row the user is
   * still typing into. */
  const commitRows = () => {
    if (busy) return;
    const incomplete = rules.some(
      (rule) => rule.spoken.trim() === "" || rule.written === "",
    );
    if (incomplete) return;
    void runWrite(() => saveTextReplacements(rules));
  };

  const editor = () => {
    if (loadState === "loading") {
      return (
        <LoadingRows
          label={t(
            "settings.vocabulary.replacements.loading",
            "Loading replacements",
          )}
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
            t(
              "settings.vocabulary.replacements.loadError",
              "Could not load replacements.",
            )}
        </Alert>
      );
    }

    return (
      <>
        <div className={ROW_GRID} ref={createRowRef}>
          <Input
            value={newSpoken}
            onChange={(event) => setNewSpoken(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") createRule();
            }}
            placeholder={t(
              "settings.vocabulary.replacements.spokenPlaceholder",
              "at sign",
            )}
            aria-label={spokenLabel}
            aria-describedby={
              createHint ? "replacement-create-hint" : undefined
            }
            invalid={spokenTaken}
            disabled={busy}
            data-testid="replacement-new-spoken"
          />
          <Input
            value={newWritten}
            onChange={(event) => setNewWritten(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") createRule();
            }}
            placeholder={t(
              "settings.vocabulary.replacements.writtenPlaceholder",
              "@",
            )}
            aria-label={writtenLabel}
            aria-describedby={
              createHint ? "replacement-create-hint" : undefined
            }
            disabled={busy}
            data-testid="replacement-new-written"
          />
          <Button
            size="sm"
            className="gap-1 justify-self-start sm:justify-self-end"
            onClick={createRule}
            disabled={busy || newIncomplete || spokenTaken}
            data-testid="replacement-add"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {t("settings.vocabulary.replacements.add", "Add rule")}
          </Button>
        </div>

        {createHint && (
          <Hint
            id="replacement-create-hint"
            tone={spokenTaken ? "danger" : "muted"}
            live={spokenTaken ? "polite" : "off"}
          >
            {createHint}
          </Hint>
        )}

        {rules.length === 0 ? (
          <EmptyHint
            title={t(
              "settings.vocabulary.replacements.empty.title",
              "No replacements",
            )}
            description={t(
              "settings.vocabulary.replacements.empty.description",
              "Add a phrase such as at sign and Sona writes @ every time you say it.",
            )}
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConfirmReset(true)}
              >
                {t(
                  "settings.vocabulary.replacements.empty.action",
                  "Restore the starter rules",
                )}
              </Button>
            }
          />
        ) : (
          <>
            {/* A named phrase, its replacement and a per-row switch is dense
             * multi-column data with a header, which is what a real table is
             * for: the switch column gets a name once instead of every row
             * carrying an unheaded control. */}
            <table
              className="data-table replacements-table"
              data-striped="true"
            >
              <caption className="sr-only">
                {t(
                  "settings.vocabulary.replacements.title",
                  "Spoken replacements",
                )}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{spokenLabel}</th>
                  <th scope="col">{writtenLabel}</th>
                  <th scope="col" className="replacements-col-apply">
                    {t("settings.vocabulary.replacements.applyColumn", "Apply")}
                  </th>
                  <th scope="col" className="replacements-col-actions">
                    <span className="sr-only">
                      {t(
                        "settings.vocabulary.replacements.actionsColumn",
                        "Actions",
                      )}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule, index) => (
                  <tr key={`${spokenKey(rule.spoken)}-${index}`}>
                    <td>
                      <Input
                        variant="compact"
                        className="w-full"
                        value={rule.spoken}
                        onChange={(event) =>
                          setRules(
                            replaceRuleAt(index, {
                              ...rule,
                              spoken: event.target.value,
                            }),
                          )
                        }
                        onBlur={commitRows}
                        aria-label={spokenLabel}
                        disabled={busy}
                        data-testid={`replacement-spoken-${index}`}
                      />
                    </td>
                    <td>
                      <Input
                        variant="compact"
                        className="w-full"
                        value={rule.written}
                        onChange={(event) =>
                          setRules(
                            replaceRuleAt(index, {
                              ...rule,
                              written: event.target.value,
                            }),
                          )
                        }
                        onBlur={commitRows}
                        aria-label={writtenLabel}
                        disabled={busy}
                        data-testid={`replacement-written-${index}`}
                      />
                    </td>
                    <td className="replacements-col-apply">
                      <Switch
                        checked={rule.enabled}
                        onChange={(next) =>
                          void runWrite(() =>
                            saveTextReplacements(
                              replaceRuleAt(index, { ...rule, enabled: next }),
                            ),
                          )
                        }
                        disabled={busy}
                        label={t(
                          "settings.vocabulary.replacements.ruleEnabled",
                          {
                            defaultValue: "Apply {{spoken}}",
                            spoken: rule.spoken,
                          },
                        )}
                      />
                    </td>
                    <td className="replacements-col-actions">
                      <IconButton
                        size="sm"
                        variant="danger-ghost"
                        label={t("settings.vocabulary.replacements.delete", {
                          defaultValue: "Delete {{spoken}}",
                          spoken: rule.spoken,
                        })}
                        onClick={() => setPendingDelete(index)}
                        disabled={busy}
                        data-testid={`replacement-delete-${index}`}
                        icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button
              size="sm"
              variant="secondary"
              className="gap-1 self-start"
              onClick={() => setConfirmReset(true)}
              disabled={busy}
              data-testid="replacement-reset"
            >
              <RotateCcw aria-hidden="true" className="h-4 w-4" />
              {t("settings.vocabulary.replacements.reset", "Restore defaults")}
            </Button>
          </>
        )}

        {/* While a confirm dialog is up it covers this region, so the failure is
         * repeated inside the dialog instead. */}
        {writeError && pendingDelete === null && !confirmReset && (
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
          {t(
            "settings.vocabulary.replacements.matching",
            "Phrases match whole words and ignore case. When two rules fit the same spot the longer one wins, and replacement runs before vocabulary correction.",
          )}
        </Hint>
      </>
    );
  };

  return (
    <>
      <ToggleSwitch
        grouped={grouped}
        descriptionMode={descriptionMode}
        checked={enabled}
        isUpdating={togglePending || loadState === "loading"}
        onChange={(next) => void toggleEnabled(next)}
        label={t(
          "settings.vocabulary.replacements.enabledLabel",
          "Enable spoken replacements",
        )}
        description={t(
          "settings.vocabulary.replacements.enabledDescription",
          "Rewrite spoken phrases such as at sign into symbols, before vocabulary correction runs.",
        )}
      />

      <SettingContainer
        title={t(
          "settings.vocabulary.replacements.title",
          "Spoken replacements",
        )}
        description={t(
          "settings.vocabulary.replacements.description",
          "Phrases Sona rewrites into exact text. Changes here affect future transcripts only, never text already written.",
        )}
        descriptionMode={descriptionMode}
        grouped={grouped}
        layout="stacked"
      >
        <div className="space-y-3" data-testid="replacements-editor">
          {!enabled && (
            <Hint tone="warning">
              {t(
                "settings.vocabulary.replacements.offState",
                "Spoken replacements are off. Rules stay saved and apply again as soon as you turn this back on.",
              )}
            </Hint>
          )}
          {editor()}
        </div>
      </SettingContainer>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t("settings.vocabulary.replacements.confirmDelete.title", {
          defaultValue: "Delete {{spoken}}?",
          spoken: pendingDelete === null ? "" : rules[pendingDelete]?.spoken,
        })}
        description={t(
          "settings.vocabulary.replacements.confirmDelete.description",
          "The phrase stops being rewritten in future transcripts. Text already written is unchanged.",
        )}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPendingDelete(null)}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => {
                const target = pendingDelete;
                if (target === null) return;
                void runWrite(
                  () =>
                    saveTextReplacements(
                      rules.filter((_, position) => position !== target),
                    ),
                  () => setPendingDelete(null),
                );
              }}
              data-testid="replacement-delete-confirm"
            >
              {t("common.delete")}
            </Button>
          </>
        }
      >
        {pendingDelete !== null && rules[pendingDelete] && (
          <div className="space-y-3">
            <p className="text-[13px] leading-5 text-text-primary">
              {t("settings.vocabulary.replacements.confirmDelete.body", {
                defaultValue: "{{spoken}} currently becomes {{written}}.",
                spoken: rules[pendingDelete].spoken,
                written: rules[pendingDelete].written,
              })}
            </p>
            {writeError && <Alert variant="error">{writeError}</Alert>}
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmReset}
        onOpenChange={(open) => {
          if (!open) setConfirmReset(false);
        }}
        title={t(
          "settings.vocabulary.replacements.confirmReset.title",
          "Restore the default rules?",
        )}
        description={t(
          "settings.vocabulary.replacements.confirmReset.description",
          "Every rule you added or edited is discarded and the shipped starter set comes back.",
        )}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmReset(false)}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() =>
                void runWrite(resetTextReplacements, () =>
                  setConfirmReset(false),
                )
              }
              data-testid="replacement-reset-confirm"
            >
              {t("settings.vocabulary.replacements.reset", "Restore defaults")}
            </Button>
          </>
        }
      >
        {writeError && <Alert variant="error">{writeError}</Alert>}
      </Dialog>
    </>
  );
};
