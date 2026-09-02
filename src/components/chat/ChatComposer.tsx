import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Square } from "lucide-react";
import type { AgentPanelWorkspaceV1 } from "@/bindings";
import { Textarea } from "@/components/vg/textarea";
import { cn } from "@/lib/cn";
import { composerKeys } from "./chatModel";

/* The two scopes, in the order the chip row reads them. They are not two moods
 * of one brain: one answers questions from your own corpus, the other proposes
 * settings changes and can change nothing without a card and a click. Which
 * one a question goes to is the reader's to say, because a client-side guess
 * that misroutes sends a private question to the wrong sandbox, and there is
 * no honest heuristic for the difference between "what did I say about the
 * theme" and "change the theme". */
const SCOPES = ["sona_chat", "sona_config"] as const;

export interface ChatComposerProps {
  workspace: AgentPanelWorkspaceV1;
  draft: string;
  /** The column focuses this when it opens; nothing else reaches into it. */
  fieldRef: React.RefObject<HTMLTextAreaElement | null>;
  /** A turn is in flight: the field waits and the send glyph becomes a stop. */
  running: boolean;
  /** Nothing would answer, or a command is mid-flight. */
  disabled: boolean;
  /** This one question may reach the operator's own MCP servers. */
  toolsAllowed: boolean;
  onWorkspaceChange: (workspace: AgentPanelWorkspaceV1) => void;
  onDraftChange: (draft: string) => void;
  onToolsAllowedChange: (allowed: boolean) => void;
  onSend: () => void;
  onStop: () => void;
}

/**
 * The scope row and the field, which are one control read top to bottom: who
 * you are asking, then what you are asking.
 *
 * The field is a textarea and not a one-line input for exactly one reason:
 * Shift+Enter has to be able to put a newline in a question. Enter alone sends.
 */
export const ChatComposer: React.FC<ChatComposerProps> = ({
  workspace,
  draft,
  fieldRef,
  running,
  disabled,
  toolsAllowed,
  onWorkspaceChange,
  onDraftChange,
  onToolsAllowedChange,
  onSend,
  onStop,
}) => {
  const { t } = useTranslation();
  const inert = disabled || running;

  return (
    <form
      data-slot="chat-composer"
      className="flex flex-none flex-col gap-2 border-t border-gray-alpha-400 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-gray-800">
          {t("chat.scopeLabel")}
        </span>
        <div
          className="flex items-center gap-1"
          role="radiogroup"
          aria-label={t("chat.scopeLabel")}
        >
          {SCOPES.map((scope) => (
            <button
              key={scope}
              type="button"
              role="radio"
              aria-checked={workspace === scope}
              disabled={inert}
              onClick={() => onWorkspaceChange(scope)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px] leading-4 transition-colors disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none",
                workspace === scope
                  ? "border-gray-alpha-600 text-gray-1000"
                  : "border-gray-alpha-400 text-gray-900 hover:text-gray-1000",
              )}
            >
              {t(`chat.scope.${scope}`)}
            </button>
          ))}
        </div>
        {/* Only the Ask workspace has a worker that could run a tool; the
            settings proposer is a zero-tool sandbox by construction. The chip
            takes the same shape as a scope because it is the same kind of
            choice about this one question — and it resets after every send,
            so tools are never a mode the app is left in. */}
        {workspace === "sona_chat" && (
          <button
            type="button"
            role="switch"
            data-slot="chat-tools"
            aria-checked={toolsAllowed}
            disabled={inert}
            title={t("chat.tools.hint")}
            onClick={() => onToolsAllowedChange(!toolsAllowed)}
            className={cn(
              "ms-auto rounded-full border px-2.5 py-1 text-[12px] leading-4 transition-colors disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none",
              toolsAllowed
                ? "border-gray-alpha-600 text-gray-1000"
                : "border-gray-alpha-400 text-gray-900 hover:text-gray-1000",
            )}
          >
            {t("chat.tools.label")}
          </button>
        )}
      </div>
      {/* `items-end` so a question grown to three lines pushes the field up and
          leaves the send glyph on the baseline it started on. */}
      <div className="flex items-end gap-1.5 rounded-[20px] border border-gray-alpha-400 bg-background-100 p-1 ps-3 focus-within:border-gray-alpha-600">
        <Textarea
          ref={fieldRef}
          rows={1}
          className="max-h-28 min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-1.5 text-[13px] leading-5 focus-visible:ring-0 md:text-[13px]"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={composerKeys(onSend)}
          placeholder={t("chat.placeholder")}
          aria-label={t("chat.inputLabel")}
          disabled={inert}
        />
        {running ? (
          /* Quiet on purpose: stopping is a retreat, not the thing this row is
             for, so it takes the outline the send glyph fills. */
          <button
            type="button"
            data-slot="chat-stop"
            onClick={onStop}
            disabled={disabled}
            aria-label={t("chat.stop")}
            className="grid size-7 flex-none place-items-center rounded-full border border-gray-alpha-400 text-gray-900 transition-colors hover:text-gray-1000 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
          >
            <Square aria-hidden="true" className="size-3 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            data-slot="chat-send"
            disabled={disabled || draft.trim() === ""}
            aria-label={t("chat.send")}
            className="grid size-7 flex-none place-items-center rounded-full border border-transparent bg-gray-1000 text-background-100 transition-colors enabled:hover:bg-gray-900 disabled:border-gray-alpha-400 disabled:bg-transparent disabled:text-gray-700 disabled:opacity-100 disabled:pointer-events-none motion-reduce:transition-none"
          >
            <ArrowUp aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
    </form>
  );
};
