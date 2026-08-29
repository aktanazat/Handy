import React, { useId, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { commands, type LLMPrompt, type Result } from "@/bindings";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  IconButton,
  Input,
  SettingContainer,
  Textarea,
} from "../../ui";
import { useSettings } from "../../../hooks/useSettings";
import { EmptyHint, Hint, LoadingRows, RuleList } from "./PanelParts";

interface PromptLibraryProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/** The prompt being written. An empty id means it does not exist yet. */
interface PromptDraft {
  id: string;
  name: string;
  prompt: string;
}

const EMPTY_PROMPTS: LLMPrompt[] = [];

/**
 * Management surface for the post-processing prompts: the rewrite instructions
 * Sona sends to the LLM after transcription. The selected prompt is the one a
 * mode without its own prompt starts from.
 */
export const PromptLibrary: React.FC<PromptLibraryProps> = ({
  descriptionMode = "tooltip",
  grouped = true,
}) => {
  const { t } = useTranslation();
  const { settings, isLoading, refreshSettings } = useSettings();
  const nameFieldId = useId();
  const bodyFieldId = useId();
  const [draft, setDraft] = useState<PromptDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LLMPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const prompts = settings?.post_process_prompts ?? EMPTY_PROMPTS;
  const selectedId = settings?.post_process_selected_prompt_id ?? null;
  const isLastPrompt = prompts.length <= 1;

  /* Command results carry a user-facing sentence on failure; a thrown error is
   * a transport fault. Both belong on screen, never only in the console. */
  const runCommand = async <T,>(
    command: () => Promise<Result<T, string>>,
    reportError: (message: string | null) => void,
    onSuccess?: () => void,
  ) => {
    setBusy(true);
    reportError(null);
    try {
      const result = await command();
      if (result.status !== "ok") {
        reportError(String(result.error));
        return;
      }
      await refreshSettings();
      onSuccess?.();
    } catch (thrown) {
      reportError(String(thrown));
    } finally {
      setBusy(false);
    }
  };

  const trimmedName = draft?.name.trim() ?? "";
  const trimmedBody = draft?.prompt.trim() ?? "";
  const draftIncomplete = trimmedName === "" || trimmedBody === "";

  const saveDraft = () => {
    if (!draft || draftIncomplete || busy) return;
    void runCommand(
      () =>
        draft.id === ""
          ? commands.addPostProcessPrompt(trimmedName, trimmedBody)
          : commands.updatePostProcessPrompt(
              draft.id,
              trimmedName,
              trimmedBody,
            ),
      setDraftError,
      () => setDraft(null),
    );
  };

  const library = () => {
    if (isLoading) {
      return (
        <LoadingRows
          label={t(
            "settings.postProcessing.prompts.loading",
            "Loading prompts",
          )}
          rows={2}
        />
      );
    }

    if (prompts.length === 0) {
      return (
        <EmptyHint
          title={t("settings.postProcessing.prompts.noPrompts")}
          description={t(
            "settings.postProcessing.prompts.empty.description",
            "A prompt tells the model what to do with the transcript, for example: rewrite the following as a short message, keeping every fact: ${output}",
          )}
          action={
            <Button
              size="sm"
              className="gap-1"
              onClick={() => {
                setDraftError(null);
                setDraft({ id: "", name: "", prompt: "" });
              }}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              {t("settings.postProcessing.prompts.createNew")}
            </Button>
          }
        />
      );
    }

    return (
      <RuleList
        label={t(
          "settings.postProcessing.prompts.libraryTitle",
          "Post-processing prompts",
        )}
      >
        {prompts.map((prompt) => {
          const selected = prompt.id === selectedId;

          return (
            <li
              key={prompt.id}
              className="flex items-start gap-3 py-2"
              data-testid="prompt-row"
              data-prompt-id={prompt.id}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span
                    className={`truncate text-[13px] leading-[19px] text-text-primary ${selected ? "font-semibold" : "font-medium"}`}
                  >
                    {prompt.name}
                  </span>
                  {selected && (
                    /* One prompt in the library is the one modes start from,
                     * which is exactly Geist's inverted "current" chip. */
                    <Badge className="flex-none">
                      {t("settings.postProcessing.prompts.inUse", "In use")}
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block line-clamp-2 text-[12.5px] leading-[18px] text-text-secondary">
                  {prompt.prompt}
                </span>
              </span>
              <span className="flex flex-none items-center gap-1.5">
                {!selected && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void runCommand(
                        () => commands.setPostProcessSelectedPrompt(prompt.id),
                        setError,
                      )
                    }
                    aria-label={t("settings.postProcessing.prompts.useNamed", {
                      defaultValue: "Use {{name}}",
                      name: prompt.name,
                    })}
                    data-testid="prompt-use"
                  >
                    {t("settings.postProcessing.prompts.use", "Use")}
                  </Button>
                )}
                <IconButton
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setDraftError(null);
                    setDraft({
                      id: prompt.id,
                      name: prompt.name,
                      prompt: prompt.prompt,
                    });
                  }}
                  label={t("settings.postProcessing.prompts.editNamed", {
                    defaultValue: "Edit {{name}}",
                    name: prompt.name,
                  })}
                  icon={<Pencil aria-hidden="true" className="h-4 w-4" />}
                  data-testid="prompt-edit"
                />
                <IconButton
                  size="sm"
                  variant="danger-ghost"
                  disabled={busy || isLastPrompt}
                  onClick={() => {
                    setError(null);
                    setPendingDelete(prompt);
                  }}
                  label={t("settings.postProcessing.prompts.deleteNamed", {
                    defaultValue: "Delete {{name}}",
                    name: prompt.name,
                  })}
                  icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                  data-testid="prompt-delete"
                />
              </span>
            </li>
          );
        })}
      </RuleList>
    );
  };

  return (
    <>
      <SettingContainer
        title={t(
          "settings.postProcessing.prompts.libraryTitle",
          "Post-processing prompts",
        )}
        description={t(
          "settings.postProcessing.prompts.selectedPrompt.description",
        )}
        descriptionMode={descriptionMode}
        grouped={grouped}
        layout="stacked"
      >
        <div className="space-y-3" data-testid="prompt-library">
          {prompts.length > 0 && (
            <div className="flex items-center gap-3">
              {selectedId === null && (
                <Hint>
                  {t(
                    "settings.postProcessing.prompts.noSelection",
                    "No prompt selected: every mode uses the prompt it defines.",
                  )}
                </Hint>
              )}
              <Button
                size="sm"
                className="ms-auto flex-none gap-1"
                disabled={busy}
                onClick={() => {
                  setDraftError(null);
                  setDraft({ id: "", name: "", prompt: "" });
                }}
                data-testid="prompt-create"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                {t("settings.postProcessing.prompts.createNew")}
              </Button>
            </div>
          )}

          {library()}

          {prompts.length === 1 && (
            <Hint>
              {t(
                "settings.postProcessing.prompts.lastPrompt",
                "Sona keeps at least one prompt, so this one cannot be deleted. Create another first.",
              )}
            </Hint>
          )}

          {/* The confirm dialog covers this region, so a failed delete is
           * repeated inside the dialog instead. */}
          {error && pendingDelete === null && (
            <Alert
              variant="error"
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    void refreshSettings();
                  }}
                >
                  {t("common.retry")}
                </Button>
              }
            >
              {error}
            </Alert>
          )}
        </div>
      </SettingContainer>

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDraft(null);
            setDraftError(null);
          }
        }}
        title={
          draft?.id === ""
            ? t("settings.postProcessing.prompts.createNew")
            : t("settings.postProcessing.prompts.updatePrompt")
        }
        closeLabel={t("common.close")}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setDraftError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={busy || draftIncomplete}
              onClick={saveDraft}
              data-testid="prompt-save"
            >
              {draft?.id === ""
                ? t("settings.postProcessing.prompts.createPrompt")
                : t("settings.postProcessing.prompts.updatePrompt")}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label
                htmlFor={nameFieldId}
                className="block text-[13px] leading-[19px] font-medium text-text-primary"
              >
                {t("settings.postProcessing.prompts.promptLabel")}
              </label>
              <Input
                id={nameFieldId}
                className="w-full"
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder={t(
                  "settings.postProcessing.prompts.promptLabelPlaceholder",
                )}
                disabled={busy}
                data-testid="prompt-name-field"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor={bodyFieldId}
                className="block text-[13px] leading-[19px] font-medium text-text-primary"
              >
                {t("settings.postProcessing.prompts.promptInstructions")}
              </label>
              <Textarea
                id={bodyFieldId}
                className="w-full"
                rows={8}
                value={draft.prompt}
                onChange={(event) =>
                  setDraft({ ...draft, prompt: event.target.value })
                }
                placeholder={t(
                  "settings.postProcessing.prompts.promptInstructionsPlaceholder",
                )}
                disabled={busy}
                data-testid="prompt-body-field"
              />
            </div>
            <Hint>
              {t(
                "settings.postProcessing.prompts.outputTip",
                "Write ${output} where the transcript should be inserted.",
              )}
            </Hint>
            {draftIncomplete && (
              <Hint tone="muted">
                {t(
                  "settings.postProcessing.prompts.errors.incomplete",
                  "Give the prompt a name and instructions before saving.",
                )}
              </Hint>
            )}
            {draftError && <Alert variant="error">{draftError}</Alert>}
          </div>
        )}
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t("settings.postProcessing.prompts.deletePrompt")}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setPendingDelete(null)}
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
                void runCommand(
                  () => commands.deletePostProcessPrompt(target.id),
                  setError,
                  () => setPendingDelete(null),
                );
              }}
              data-testid="prompt-delete-confirm"
            >
              {t("common.delete")}
            </Button>
          </>
        }
      >
        {pendingDelete && (
          <div className="space-y-3">
            <p className="text-[13px] leading-5 text-text-primary">
              {pendingDelete.id === selectedId
                ? t("settings.postProcessing.prompts.confirmDelete.selected", {
                    defaultValue:
                      "{{name}} is in use. Deleting it moves the selection to the first prompt in the list.",
                    name: pendingDelete.name,
                  })
                : t("settings.postProcessing.prompts.confirmDelete.body", {
                    defaultValue:
                      "{{name}} is removed from the library. Modes that already copied its text keep their own prompt.",
                    name: pendingDelete.name,
                  })}
            </p>
            {error && <Alert variant="error">{error}</Alert>}
          </div>
        )}
      </Dialog>
    </>
  );
};
