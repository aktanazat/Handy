import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/vg/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { Textarea } from "@/components/vg/textarea";
import {
  Notice,
  SettingsCard,
  SettingsField,
} from "@/components/settings/rows";
import type { AgentBridgeSettingsModel } from "./useAgentBridgeSettings";

interface AgentBridgeReplyComposerProps {
  replySessionId: AgentBridgeSettingsModel["replySessionId"];
  replyText: AgentBridgeSettingsModel["replyText"];
  replySessions: AgentBridgeSettingsModel["replySessions"];
  interactiveReady: AgentBridgeSettingsModel["interactiveReady"];
  updateView: AgentBridgeSettingsModel["updateView"];
  createReplyPreview: AgentBridgeSettingsModel["createReplyPreview"];
}

export const AgentBridgeReplyComposer: React.FC<
  AgentBridgeReplyComposerProps
> = ({
  replySessionId,
  replyText,
  replySessions,
  interactiveReady,
  updateView,
  createReplyPreview,
}) => {
  const { t } = useTranslation();

  return (
    /* The tab names this composer, so the card does not name it again, and
     * the two-step flow shows what the paragraph used to promise. */
    <SettingsCard className="divide-y divide-gray-alpha-400">
      {interactiveReady ? null : (
        <div className="px-4 py-2.5">
          <Notice>
            {t(
              "settings.agents.replyQueue.notReady",
              "Replies need the bridge on and at least one agent enabled.",
            )}
          </Notice>
        </div>
      )}
      <SettingsField
        label={t("settings.agents.replyQueue.session")}
        controlId="agent-reply-session"
        disabled={!interactiveReady || replySessions.length === 0}
      >
        <Select
          value={replySessionId}
          onValueChange={(id) => updateView({ replySessionId: id })}
          disabled={!interactiveReady || replySessions.length === 0}
        >
          <SelectTrigger id="agent-reply-session" size="sm" className="w-full">
            <SelectValue
              placeholder={t("settings.agents.replyQueue.noSession")}
            />
          </SelectTrigger>
          <SelectContent>
            {replySessions.map((session) => (
              <SelectItem key={session.id} value={session.id}>
                {t(
                  "settings.agents.controls.providers." +
                    session.agent +
                    ".label",
                )}
                {" · "}
                {session.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsField>
      <SettingsField
        label={t("settings.agents.replyQueue.message")}
        controlId="agent-reply-text"
        disabled={!interactiveReady || !replySessionId}
      >
        <Textarea
          id="agent-reply-text"
          value={replyText}
          onChange={(event) => updateView({ replyText: event.target.value })}
          disabled={!interactiveReady || !replySessionId}
        />
      </SettingsField>
      <div className="flex justify-end px-4 py-2.5">
        <Button
          size="sm"
          onClick={() => void createReplyPreview()}
          disabled={
            !interactiveReady || !replySessionId || replyText.trim() === ""
          }
        >
          {t("settings.agents.replyQueue.createPreview")}
        </Button>
      </div>
    </SettingsCard>
  );
};
