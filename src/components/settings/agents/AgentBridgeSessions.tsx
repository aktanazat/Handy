import React from "react";
import { useTranslation } from "react-i18next";
import { Notice, SettingsSection } from "@/components/settings/rows";
import type { AgentBridgeSettingsModel } from "./useAgentBridgeSettings";

interface AgentBridgeSessionsProps {
  sessions: AgentBridgeSettingsModel["sessions"];
}

export const AgentBridgeSessions: React.FC<AgentBridgeSessionsProps> = ({
  sessions,
}) => {
  const { t } = useTranslation();

  return (
    <SettingsSection label={t("settings.agents.observed.sessions")}>
      {sessions.length === 0 ? (
        <div className="px-6 py-2.5">
          <Notice>{t("settings.agents.observed.noSessions")}</Notice>
        </div>
      ) : (
        sessions.map((session) => (
          <div
            key={session.id}
            className="flex min-h-[52px] min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-6 py-2.5"
          >
            <span className="text-[14px] text-gray-1000">
              {t(
                "settings.agents.controls.providers." +
                  session.agent +
                  ".label",
              )}
            </span>
            <code className="min-w-0 text-xs break-all text-gray-800 tabular-nums">
              {session.id}
            </code>
            <code className="min-w-0 text-xs break-all text-gray-800 tabular-nums">
              {session.canonical_project_hash}
            </code>
          </div>
        ))
      )}
    </SettingsSection>
  );
};
