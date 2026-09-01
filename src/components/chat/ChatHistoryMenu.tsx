import React from "react";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import type { AgentChatConversationSummaryV1 } from "@/bindings";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/vg/popover";
import { cn } from "@/lib/cn";

export interface ChatHistoryListProps {
  conversations: readonly AgentChatConversationSummaryV1[];
  /** The one currently in the sheet, so the list is a place rather than a pile. */
  currentId: string | null;
  onSelect: (conversationId: string) => void;
}

/**
 * The rows themselves, outside the popover that carries them.
 *
 * Radix portals its content to the document body, which server rendering has
 * none of — so the list is its own component, and what a reader sees when they
 * press the clock is checkable without a browser.
 */
export const ChatHistoryList: React.FC<ChatHistoryListProps> = ({
  conversations,
  currentId,
  onSelect,
}) => {
  const { t } = useTranslation();

  if (conversations.length === 0) {
    return (
      <p className="px-2 py-3 text-center text-[12px] leading-4 text-gray-900">
        {t("chat.historyEmpty")}
      </p>
    );
  }

  return (
    <ul className="flex max-h-64 list-none flex-col overflow-y-auto p-0">
      {conversations.map((conversation) => (
        <li key={conversation.conversation_id}>
          <button
            type="button"
            aria-current={
              conversation.conversation_id === currentId ? "true" : undefined
            }
            onClick={() => onSelect(conversation.conversation_id)}
            className={cn(
              "w-full truncate rounded-md px-2 py-1.5 text-start text-[13px] leading-5 transition-colors hover:bg-gray-alpha-200 motion-reduce:transition-none",
              conversation.conversation_id === currentId
                ? "bg-gray-alpha-100 text-gray-1000"
                : "text-gray-900 hover:text-gray-1000",
            )}
          >
            {conversation.title}
          </button>
        </li>
      ))}
    </ul>
  );
};

export interface ChatHistoryMenuProps extends ChatHistoryListProps {
  open: boolean;
  /** Opening is when the list is read, so it is when the list is fetched. */
  onOpenChange: (open: boolean) => void;
}

/**
 * The last twenty questions, by the first thing you said in each.
 *
 * Titles only. A preview of the answer would make every row two lines and a
 * scan of twenty rows a page of reading, and the reason you are here is that
 * you remember asking something, not what came back.
 */
export const ChatHistoryMenu: React.FC<ChatHistoryMenuProps> = ({
  conversations,
  currentId,
  open,
  onOpenChange,
  onSelect,
}) => {
  const { t } = useTranslation();

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        data-slot="chat-history"
        aria-label={t("chat.history")}
        title={t("chat.history")}
        className="grid size-7 place-items-center rounded-full border border-gray-alpha-400 text-gray-900 transition-colors hover:bg-gray-alpha-100 hover:text-gray-1000 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
      >
        <Clock aria-hidden="true" className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <ChatHistoryList
          conversations={conversations}
          currentId={currentId}
          onSelect={onSelect}
        />
      </PopoverContent>
    </Popover>
  );
};
