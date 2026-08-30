import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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

interface RowDraft {
  trigger: string;
  expansion: string;
}

type LoadState = "loading" | "ready" | "failed";

/* One grid template for the column names and every row, so cells line up. The
 * trailing column is a fixed width because its controls come and go. */
/* The trailing column is a fixed 133px (9.5rem at this app's 14px root,
 * written as the px it renders): the toggle plus the row's two icon actions. */
const ROW_GRID =
  "grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_133px]";

/**
 * Global text expansion: triggers the transcript pipeline replaces right after
 * vocabulary correction. Every mutating command answers with the whole list,
 * so state comes from the command result and never from a second read.
 */
export const SnippetsPanel: React.FC = () => {
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
  const sectionLabel = t("settings.advanced.snippets.title", "Text expansion");
  const addLabel = t("settings.advanced.snippets.add", "Add snippet");

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
        createRowRef.current?.getElementsByTagName("input")[0]?.focus();
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

  const list = () => {
    if (loadState === "loading") {
      return (
        <LoadingRows
          label={t("settings.advanced.snippets.loading", "Loading snippets")}
        />
      );
    }

    if (loadState === "failed") {
      return (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Notice tone="danger">
            {loadError ??
              t(
                "settings.advanced.snippets.loadError",
                "Could not load snippets.",
              )}
          </Notice>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t("common.retry")}
          </Button>
        </div>
      );
    }

    if (snippets.length === 0) {
      return (
        <EmptyLine
          text={t(
            "settings.advanced.snippets.empty.description",
            "Add a trigger such as omw and Sona writes on my way every time you say it.",
          )}
        />
      );
    }

    return (
      <div>
        <ColumnHeader
          gridClassName={ROW_GRID}
          start={triggerLabel}
          end={expansionLabel}
        />
        <RuleList label={sectionLabel}>
          {snippets.map((snippet) => {
            const draft = draftFor(snippet);
            const dirty =
              draft.trigger.trim() !== snippet.trigger ||
              draft.expansion.trim() !== snippet.expansion;
            const problem = dirty ? rowProblem(snippet) : null;
            const hintId = `snippet-hint-${snippet.id}`;

            return (
              <RuleRow
                key={snippet.id}
                data-testid="snippet-row"
                data-snippet-id={snippet.id}
              >
                <div className={ROW_GRID}>
                  <Input
                    className={cn(literalText, "h-8")}
                    value={draft.trigger}
                    onChange={(event) =>
                      editRow(snippet, "trigger", event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveRow(snippet);
                      if (event.key === "Escape") revertRow(snippet);
                    }}
                    aria-label={triggerLabel}
                    aria-describedby={problem ? hintId : undefined}
                    aria-invalid={problem !== null}
                    disabled={busy}
                    data-testid="snippet-trigger"
                  />
                  <Input
                    className={cn(literalText, "h-8")}
                    value={draft.expansion}
                    onChange={(event) =>
                      editRow(snippet, "expansion", event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveRow(snippet);
                      if (event.key === "Escape") revertRow(snippet);
                    }}
                    aria-label={expansionLabel}
                    aria-describedby={problem ? hintId : undefined}
                    disabled={busy}
                    data-testid="snippet-expansion"
                  />
                  <span className="flex items-center justify-end gap-1.5">
                    {dirty && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => saveRow(snippet)}
                        disabled={busy || problem !== null}
                        aria-label={t("settings.advanced.snippets.saveRow", {
                          defaultValue: "Save {{trigger}}",
                          trigger: snippet.trigger,
                        })}
                        data-testid="snippet-save"
                      >
                        {t("common.save")}
                      </Button>
                    )}
                    {/* The switch is state, not an action: it stays visible
                     * while the destructive control waits to be asked for. */}
                    <Switch
                      size="sm"
                      checked={snippet.enabled}
                      disabled={busy}
                      onCheckedChange={(enabled) =>
                        void runWrite(() =>
                          setSnippetEnabled(snippet.id, enabled),
                        )
                      }
                      aria-label={t("settings.advanced.snippets.enableRow", {
                        defaultValue: "Enable {{trigger}}",
                        trigger: snippet.trigger,
                      })}
                    />
                    <RowActions>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-gray-700 hover:text-red-900"
                        disabled={busy}
                        onClick={() => setPendingDelete(snippet)}
                        aria-label={t("settings.advanced.snippets.remove", {
                          defaultValue: "Delete {{trigger}}",
                          trigger: snippet.trigger,
                        })}
                        data-testid="snippet-delete"
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </RowActions>
                  </span>
                </div>
                {problem && (
                  <Hint
                    id={hintId}
                    tone="danger"
                    live="polite"
                    className="mt-1"
                  >
                    {problem}
                  </Hint>
                )}
              </RuleRow>
            );
          })}
        </RuleList>
      </div>
    );
  };

  return (
    <>
      <SettingsSection
        label={sectionLabel}
        action={
          <Switch
            checked={expansionEnabled}
            disabled={togglePending || loadState === "loading"}
            onCheckedChange={(enabled) => void toggleExpansion(enabled)}
            aria-label={t(
              "settings.advanced.snippets.enabledLabel",
              "Enable text expansion",
            )}
          />
        }
      >
        <div
          className="divide-y divide-gray-alpha-400"
          data-testid="snippets-editor"
        >
          <SettingsField label={addLabel}>
            <div className={ROW_GRID} ref={createRowRef}>
              <Input
                className={literalText}
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
                aria-describedby={
                  createHint ? "snippet-create-hint" : undefined
                }
                aria-invalid={newTriggerTaken}
                disabled={busy}
                data-testid="snippet-new-trigger"
              />
              <Input
                className={literalText}
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
                aria-describedby={
                  createHint ? "snippet-create-hint" : undefined
                }
                disabled={busy}
                data-testid="snippet-new-expansion"
              />
              {/* The field above is labelled "Add snippet"; a button repeating
               * that label would be the same words twice, and a fixed grid
               * column is the wrong place for a string that translates long. */}
              <Button
                size="icon-sm"
                variant="outline"
                className="justify-self-start sm:justify-self-end"
                onClick={createSnippet}
                disabled={busy || newIncomplete || newTriggerTaken}
                aria-label={addLabel}
                data-testid="snippet-add"
              >
                <Plus aria-hidden="true" />
              </Button>
            </div>
            {createHint && (
              <Hint
                id="snippet-create-hint"
                tone={newTriggerTaken ? "danger" : "muted"}
                live={newTriggerTaken ? "polite" : "off"}
                className="mt-2"
              >
                {createHint}
              </Hint>
            )}
          </SettingsField>

          {list()}

          {/* While the confirm dialog is up it covers this region, so the
           * failure is repeated inside the dialog instead. */}
          {writeError && pendingDelete === null && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <Notice tone="danger">{writeError}</Notice>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t("common.retry")}
              </Button>
            </div>
          )}

          <Notice live={false} className="px-4 py-3">
            {t(
              "settings.advanced.snippets.matching",
              "Triggers match whole words and ignore case. When two triggers fit the same spot the longer one wins, and expansion runs right after vocabulary corrections.",
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
              {t("settings.advanced.snippets.confirmDelete.title", {
                defaultValue: "Delete {{trigger}}?",
                trigger: pendingDelete?.trigger ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t(
                "settings.advanced.snippets.confirmDelete.description",
                "The trigger stops expanding in future transcripts. Text already written is unchanged.",
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
