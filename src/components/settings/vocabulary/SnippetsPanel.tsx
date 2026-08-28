import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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
import {
  ColumnHeader,
  EmptyHint,
  Hint,
  LoadingRows,
  RuleList,
} from "./PanelParts";
import {
  deleteSnippet,
  draftSnippet,
  fetchSnippetsEnabled,
  listSnippets,
  setSnippetEnabled,
  setSnippetsEnabled,
  triggerKey,
  upsertSnippet,
  type Snippet,
} from "./snippetsApi";

interface SnippetsPanelProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

interface RowDraft {
  trigger: string;
  expansion: string;
}

type LoadState = "loading" | "ready" | "failed";

/* One grid template for the column header and every row, so cells line up.
 * The trailing column is a fixed width because its controls come and go. */
const ROW_GRID =
  "grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9.5rem]";

/**
 * Global text expansion: triggers the transcript pipeline replaces right after
 * vocabulary correction. Every mutating command answers with the whole list,
 * so state comes from the command result and never from a second read.
 */
export const SnippetsPanel: React.FC<SnippetsPanelProps> = ({
  descriptionMode = "inline",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { refreshSettings } = useSettings();
  const createRowRef = useRef<HTMLDivElement>(null);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [expansionEnabled, setExpansionEnabled] = useState(true);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const [newTrigger, setNewTrigger] = useState("");
  const [newExpansion, setNewExpansion] = useState("");
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [pendingDelete, setPendingDelete] = useState<Snippet | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    try {
      const [saved, enabled] = await Promise.all([
        listSnippets(),
        fetchSnippetsEnabled(),
      ]);
      setSnippets(saved);
      setExpansionEnabled(enabled);
      setLoadState("ready");
    } catch (error) {
      setLoadError(String(error));
      setLoadState("failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const focusNewTrigger = () => {
    createRowRef.current?.getElementsByTagName("input")[0]?.focus();
  };

  /* Writes are serialized: each command returns the authoritative list, so two
   * in flight at once would let the slower answer overwrite the newer one. */
  const runWrite = async (
    write: () => Promise<Snippet[]>,
    afterWrite?: () => void,
  ) => {
    setBusy(true);
    setWriteError(null);
    try {
      setSnippets(await write());
      afterWrite?.();
    } catch (error) {
      setWriteError(String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleExpansion = async (enabled: boolean) => {
    const previous = expansionEnabled;
    setTogglePending(true);
    setWriteError(null);
    setExpansionEnabled(enabled);
    try {
      await setSnippetsEnabled(enabled);
      // Other surfaces read settings from the store, so leave its copy correct.
      await refreshSettings();
    } catch (error) {
      setExpansionEnabled(previous);
      setWriteError(String(error));
    } finally {
      setTogglePending(false);
    }
  };

  const duplicateText = t(
    "settings.advanced.snippets.errors.duplicate",
    "Another snippet already uses this trigger.",
  );
  const incompleteText = t(
    "settings.advanced.snippets.errors.incomplete",
    "Enter both a trigger and an expansion.",
  );
  const triggerLabel = t("settings.advanced.snippets.trigger", "Trigger");
  const expansionLabel = t("settings.advanced.snippets.expansion", "Expansion");

  const trimmedNewTrigger = newTrigger.trim();
  const trimmedNewExpansion = newExpansion.trim();
  const newTriggerTaken =
    trimmedNewTrigger !== "" &&
    snippets.some(
      (snippet) => triggerKey(snippet.trigger) === triggerKey(newTrigger),
    );
  const newIncomplete = trimmedNewTrigger === "" || trimmedNewExpansion === "";
  const newDraftStarted = newTrigger !== "" || newExpansion !== "";
  const createHint = newTriggerTaken
    ? duplicateText
    : newIncomplete && newDraftStarted
      ? incompleteText
      : null;

  const createSnippet = () => {
    if (newIncomplete || newTriggerTaken || busy) return;
    void runWrite(
      () => upsertSnippet(draftSnippet(trimmedNewTrigger, trimmedNewExpansion)),
      () => {
        setNewTrigger("");
        setNewExpansion("");
        focusNewTrigger();
      },
    );
  };

  const draftFor = (snippet: Snippet): RowDraft =>
    drafts[snippet.id] ?? {
      trigger: snippet.trigger,
      expansion: snippet.expansion,
    };

  const editRow = (snippet: Snippet, field: keyof RowDraft, value: string) => {
    setDrafts((current) => ({
      ...current,
      [snippet.id]: { ...draftFor(snippet), [field]: value },
    }));
  };

  const revertRow = (snippet: Snippet) => {
    setDrafts((current) => {
      if (!(snippet.id in current)) return current;
      const next = { ...current };
      delete next[snippet.id];
      return next;
    });
  };

  /** The trigger uniqueness and completeness the backend enforces, checked
   * before the write so a collision reads as a hint on the field. */
  const rowProblem = (snippet: Snippet): string | null => {
    const draft = draftFor(snippet);
    if (draft.trigger.trim() === "" || draft.expansion.trim() === "") {
      return incompleteText;
    }
    const taken = snippets.some(
      (other) =>
        other.id !== snippet.id &&
        triggerKey(other.trigger) === triggerKey(draft.trigger),
    );
    return taken ? duplicateText : null;
  };

  const saveRow = (snippet: Snippet) => {
    if (busy || rowProblem(snippet) !== null) return;
    const draft = draftFor(snippet);
    void runWrite(
      () =>
        upsertSnippet({
          ...snippet,
          trigger: draft.trigger.trim(),
          expansion: draft.expansion.trim(),
        }),
      () => revertRow(snippet),
    );
  };

  const editor = () => {
    if (loadState === "loading") {
      return (
        <LoadingRows
          label={t("settings.advanced.snippets.loading", "Loading snippets")}
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
              "settings.advanced.snippets.loadError",
              "Could not load snippets.",
            )}
        </Alert>
      );
    }

    return (
      <>
        <div className={ROW_GRID} ref={createRowRef}>
          <Input
            value={newTrigger}
            onChange={(event) => setNewTrigger(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") createSnippet();
            }}
            placeholder={t(
              "settings.advanced.snippets.triggerPlaceholder",
              "omw",
            )}
            aria-label={triggerLabel}
            aria-describedby={createHint ? "snippet-create-hint" : undefined}
            invalid={newTriggerTaken}
            disabled={busy}
            data-testid="snippet-new-trigger"
          />
          <Input
            value={newExpansion}
            onChange={(event) => setNewExpansion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") createSnippet();
            }}
            placeholder={t(
              "settings.advanced.snippets.expansionPlaceholder",
              "on my way",
            )}
            aria-label={expansionLabel}
            aria-describedby={createHint ? "snippet-create-hint" : undefined}
            disabled={busy}
            data-testid="snippet-new-expansion"
          />
          <Button
            size="sm"
            className="gap-1 justify-self-start sm:justify-self-end"
            onClick={createSnippet}
            disabled={busy || newIncomplete || newTriggerTaken}
            data-testid="snippet-add"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {t("settings.advanced.snippets.add", "Add snippet")}
          </Button>
        </div>

        {createHint && (
          <Hint
            id="snippet-create-hint"
            tone={newTriggerTaken ? "danger" : "muted"}
            live={newTriggerTaken ? "polite" : "off"}
          >
            {createHint}
          </Hint>
        )}

        {snippets.length === 0 ? (
          <EmptyHint
            title={t(
              "settings.advanced.snippets.empty.title",
              "No snippets yet",
            )}
            description={t(
              "settings.advanced.snippets.empty.description",
              "Add a trigger such as omw and Sona writes on my way every time you say it.",
            )}
            action={
              <Button size="sm" variant="secondary" onClick={focusNewTrigger}>
                {t(
                  "settings.advanced.snippets.empty.action",
                  "Write your first snippet",
                )}
              </Button>
            }
          />
        ) : (
          <>
            <ColumnHeader
              gridClassName={ROW_GRID}
              start={triggerLabel}
              end={expansionLabel}
            />
            <RuleList
              label={t("settings.advanced.snippets.title", "Text expansion")}
            >
              {snippets.map((snippet) => {
                const draft = draftFor(snippet);
                const dirty =
                  draft.trigger.trim() !== snippet.trigger ||
                  draft.expansion.trim() !== snippet.expansion;
                const problem = dirty ? rowProblem(snippet) : null;
                const hintId = `snippet-hint-${snippet.id}`;

                return (
                  <li
                    key={snippet.id}
                    className="py-2"
                    data-testid="snippet-row"
                    data-snippet-id={snippet.id}
                  >
                    <div className={ROW_GRID}>
                      <Input
                        variant="compact"
                        value={draft.trigger}
                        onChange={(event) =>
                          editRow(snippet, "trigger", event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") saveRow(snippet);
                          if (event.key === "Escape") revertRow(snippet);
                        }}
                        aria-label={triggerLabel}
                        aria-describedby={dirty ? hintId : undefined}
                        invalid={problem !== null}
                        disabled={busy}
                        data-testid="snippet-trigger"
                      />
                      <Input
                        variant="compact"
                        value={draft.expansion}
                        onChange={(event) =>
                          editRow(snippet, "expansion", event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") saveRow(snippet);
                          if (event.key === "Escape") revertRow(snippet);
                        }}
                        aria-label={expansionLabel}
                        aria-describedby={dirty ? hintId : undefined}
                        disabled={busy}
                        data-testid="snippet-expansion"
                      />
                      <span className="flex items-center justify-end gap-1.5">
                        {dirty && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => saveRow(snippet)}
                            disabled={busy || problem !== null}
                            aria-label={t(
                              "settings.advanced.snippets.saveRow",
                              {
                                defaultValue: "Save {{trigger}}",
                                trigger: snippet.trigger,
                              },
                            )}
                            data-testid="snippet-save"
                          >
                            {t("common.save")}
                          </Button>
                        )}
                        <Switch
                          checked={snippet.enabled}
                          disabled={busy}
                          onChange={(enabled) =>
                            void runWrite(() =>
                              setSnippetEnabled(snippet.id, enabled),
                            )
                          }
                          label={t("settings.advanced.snippets.enableRow", {
                            defaultValue: "Enable {{trigger}}",
                            trigger: snippet.trigger,
                          })}
                        />
                        <IconButton
                          variant="danger-ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => setPendingDelete(snippet)}
                          label={t("settings.advanced.snippets.remove", {
                            defaultValue: "Delete {{trigger}}",
                            trigger: snippet.trigger,
                          })}
                          icon={
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          }
                          data-testid="snippet-delete"
                        />
                      </span>
                    </div>
                    {dirty && (
                      <Hint
                        id={hintId}
                        tone={problem ? "danger" : "muted"}
                        live="polite"
                        className="mt-1"
                      >
                        {problem ??
                          t(
                            "settings.advanced.snippets.unsaved",
                            "Press Enter or Save to keep this change.",
                          )}
                      </Hint>
                    )}
                  </li>
                );
              })}
            </RuleList>
          </>
        )}

        {/* While the confirm dialog is up it covers this region, so the
         * failure is repeated inside the dialog instead. */}
        {writeError && pendingDelete === null && (
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
            "settings.advanced.snippets.matching",
            "Triggers match whole words and ignore case. When two triggers fit the same spot the longer one wins, and expansion runs right after vocabulary corrections.",
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
        checked={expansionEnabled}
        isUpdating={togglePending || loadState === "loading"}
        onChange={(enabled) => void toggleExpansion(enabled)}
        label={t(
          "settings.advanced.snippets.enabledLabel",
          "Enable text expansion",
        )}
        description={t(
          "settings.advanced.snippets.enabledDescription",
          "Replace snippet triggers in every transcript, immediately after vocabulary corrections.",
        )}
      />

      <SettingContainer
        title={t("settings.advanced.snippets.title", "Text expansion")}
        description={t(
          "settings.advanced.snippets.description",
          "Short triggers Sona expands into longer text. Changes here affect future transcripts only, never text already written.",
        )}
        descriptionMode={descriptionMode}
        grouped={grouped}
        layout="stacked"
      >
        <div className="space-y-3" data-testid="snippets-editor">
          {!expansionEnabled && (
            <Hint tone="warning">
              {t(
                "settings.advanced.snippets.offState",
                "Text expansion is off. Snippets stay saved and apply again as soon as you turn it back on.",
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
        title={t("settings.advanced.snippets.confirmDelete.title", {
          defaultValue: "Delete {{trigger}}?",
          trigger: pendingDelete?.trigger ?? "",
        })}
        description={t(
          "settings.advanced.snippets.confirmDelete.description",
          "The trigger stops expanding in future transcripts. Text already written is unchanged.",
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
                if (!target) return;
                void runWrite(
                  () => deleteSnippet(target.id),
                  () => {
                    revertRow(target);
                    setPendingDelete(null);
                  },
                );
              }}
              data-testid="snippet-delete-confirm"
            >
              {t("common.delete")}
            </Button>
          </>
        }
      >
        {pendingDelete && (
          <div className="space-y-3">
            <p className="text-[13px] leading-5 text-text-primary">
              {t("settings.advanced.snippets.confirmDelete.body", {
                defaultValue: "{{trigger}} currently expands to {{expansion}}.",
                trigger: pendingDelete.trigger,
                expansion: pendingDelete.expansion,
              })}
            </p>
            {writeError && <Alert variant="error">{writeError}</Alert>}
          </div>
        )}
      </Dialog>
    </>
  );
};
