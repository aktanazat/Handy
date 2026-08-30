import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { Button } from "@/components/vg/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/vg/dialog";
import { Input } from "@/components/vg/input";
import { Switch } from "@/components/vg/switch";
import {
  Notice,
  SettingsField,
  SettingsSection,
} from "@/components/settings/rows";
import { useSettings } from "../../../hooks/useSettings";
import {
  ColumnHeader,
  EmptyLine,
  Hint,
  literalText,
  LoadingRows,
  RowActions,
  RuleList,
  RuleRow,
} from "./PanelParts";
import {
  getTextReplacements,
  resetTextReplacements,
  saveTextReplacements,
  setTextReplacementsEnabled,
  type ReplacementRule,
} from "../../../lib/powerPackApi";

type LoadState = "loading" | "ready" | "failed";

/* One grid template for the column names, the create field and every row, so
 * cells line up. The trailing column is fixed because it holds the apply
 * switch and the remove button, both of which come and go. */
const ROW_GRID =
  "grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_70px]";

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
export const ReplacementsPanel: React.FC = () => {
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

  const sectionLabel = t(
    "settings.vocabulary.replacements.title",
    "Spoken replacements",
  );
  const spokenLabel = t("settings.vocabulary.replacements.spoken", "You say");
  const writtenLabel = t(
    "settings.vocabulary.replacements.written",
    "Sona writes",
  );
  const addLabel = t("settings.vocabulary.replacements.add", "Add rule");
  const resetLabel = t(
    "settings.vocabulary.replacements.reset",
    "Restore defaults",
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
        createRowRef.current?.getElementsByTagName("input")[0]?.focus();
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

  const list = () => {
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
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Notice tone="danger">
            {loadError ??
              t(
                "settings.vocabulary.replacements.loadError",
                "Could not load replacements.",
              )}
          </Notice>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t("common.retry")}
          </Button>
        </div>
      );
    }

    if (rules.length === 0) {
      return (
        <EmptyLine
          text={t(
            "settings.vocabulary.replacements.empty.description",
            "Add a phrase such as at sign and Sona writes @ every time you say it.",
          )}
        />
      );
    }

    return (
      <div>
        <ColumnHeader
          gridClassName={ROW_GRID}
          start={spokenLabel}
          end={writtenLabel}
        />
        <RuleList label={sectionLabel}>
          {rules.map((rule, index) => (
            <RuleRow
              key={`${spokenKey(rule.spoken)}-${index}`}
              data-testid="replacement-row"
            >
              <div className={ROW_GRID}>
                <Input
                  className={cn(literalText, "h-8")}
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
                <Input
                  className={cn(literalText, "h-8")}
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
                <span className="flex items-center justify-end gap-1.5">
                  {/* The switch is state, not an action: it stays visible
                   * while the destructive control waits to be asked for. */}
                  <Switch
                    size="sm"
                    checked={rule.enabled}
                    onCheckedChange={(next) =>
                      void runWrite(() =>
                        saveTextReplacements(
                          replaceRuleAt(index, { ...rule, enabled: next }),
                        ),
                      )
                    }
                    disabled={busy}
                    aria-label={t(
                      "settings.vocabulary.replacements.ruleEnabled",
                      {
                        defaultValue: "Apply {{spoken}}",
                        spoken: rule.spoken,
                      },
                    )}
                  />
                  <RowActions>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-gray-700 hover:text-red-900"
                      onClick={() => setPendingDelete(index)}
                      disabled={busy}
                      aria-label={t("settings.vocabulary.replacements.delete", {
                        defaultValue: "Delete {{spoken}}",
                        spoken: rule.spoken,
                      })}
                      data-testid={`replacement-delete-${index}`}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </RowActions>
                </span>
              </div>
            </RuleRow>
          ))}
        </RuleList>
      </div>
    );
  };

  return (
    <>
      <SettingsSection
        label={sectionLabel}
        action={
          <span className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmReset(true)}
              disabled={busy}
              data-testid="replacement-reset"
            >
              <RotateCcw aria-hidden="true" />
              {resetLabel}
            </Button>
            <Switch
              checked={enabled}
              disabled={togglePending || loadState === "loading"}
              onCheckedChange={(next) => void toggleEnabled(next)}
              aria-label={t(
                "settings.vocabulary.replacements.enabledLabel",
                "Enable spoken replacements",
              )}
            />
          </span>
        }
      >
        <div
          className="divide-y divide-gray-alpha-400"
          data-testid="replacements-editor"
        >
          <SettingsField label={addLabel}>
            <div className={ROW_GRID} ref={createRowRef}>
              <Input
                className={literalText}
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
                aria-invalid={spokenTaken}
                disabled={busy}
                data-testid="replacement-new-spoken"
              />
              <Input
                className={literalText}
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
              {/* Same shape as the vocabulary editor: the field carries the
               * name, the button carries the verb as its accessible name. */}
              <Button
                size="icon-sm"
                variant="outline"
                className="justify-self-start sm:justify-self-end"
                onClick={createRule}
                disabled={busy || newIncomplete || spokenTaken}
                aria-label={addLabel}
                data-testid="replacement-add"
              >
                <Plus aria-hidden="true" />
              </Button>
            </div>
            {createHint && (
              <Hint
                id="replacement-create-hint"
                tone={spokenTaken ? "danger" : "muted"}
                live={spokenTaken ? "polite" : "off"}
                className="mt-2"
              >
                {createHint}
              </Hint>
            )}
          </SettingsField>

          {list()}

          {/* While a confirm dialog is up it covers this region, so the failure
           * is repeated inside the dialog instead. */}
          {writeError && pendingDelete === null && !confirmReset && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <Notice tone="danger">{writeError}</Notice>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t("common.retry")}
              </Button>
            </div>
          )}

          <Notice live={false} className="px-4 py-3">
            {t(
              "settings.vocabulary.replacements.matching",
              "Phrases match whole words and ignore case. When two rules fit the same spot the longer one wins, and replacement runs before vocabulary correction.",
            )}
          </Notice>
        </div>
      </SettingsSection>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.vocabulary.replacements.confirmDelete.title", {
                defaultValue: "Delete {{spoken}}?",
                spoken:
                  pendingDelete === null ? "" : rules[pendingDelete]?.spoken,
              })}
            </DialogTitle>
            <DialogDescription>
              {t(
                "settings.vocabulary.replacements.confirmDelete.description",
                "The phrase stops being rewritten in future transcripts. Text already written is unchanged.",
              )}
            </DialogDescription>
          </DialogHeader>
          {writeError && <Notice tone="danger">{writeError}</Notice>}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPendingDelete(null)}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
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
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmReset}
        onOpenChange={(open) => {
          if (!open) setConfirmReset(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(
                "settings.vocabulary.replacements.confirmReset.title",
                "Restore the default rules?",
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                "settings.vocabulary.replacements.confirmReset.description",
                "Every rule you added or edited is discarded and the shipped starter set comes back.",
              )}
            </DialogDescription>
          </DialogHeader>
          {writeError && <Notice tone="danger">{writeError}</Notice>}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmReset(false)}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() =>
                void runWrite(resetTextReplacements, () =>
                  setConfirmReset(false),
                )
              }
              data-testid="replacement-reset-confirm"
            >
              {resetLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
