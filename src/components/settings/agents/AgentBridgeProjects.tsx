import React from "react";
import { FolderPlus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { Button } from "@/components/vg/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/vg/tooltip";
import { Notice, SettingsSection } from "@/components/settings/rows";
import type { AgentBridgeSettingsModel } from "./useAgentBridgeSettings";

interface AgentBridgeProjectsProps {
  bridge: AgentBridgeSettingsModel["bridge"];
  authorizing: AgentBridgeSettingsModel["authorizing"];
  authorizeProject: AgentBridgeSettingsModel["authorizeProject"];
  mutateBridge: AgentBridgeSettingsModel["mutateBridge"];
}

export const AgentBridgeProjects: React.FC<AgentBridgeProjectsProps> = ({
  bridge,
  authorizing,
  authorizeProject,
  mutateBridge,
}) => {
  const { t } = useTranslation();

  return (
    <SettingsSection
      label={t("settings.agents.projects.title")}
      action={
        /* The permission boundary is the hash, and the rows below are hashes:
         * the two paragraphs that said so now sit behind the button that
         * creates one. */
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void authorizeProject()}
              disabled={authorizing}
            >
              <FolderPlus aria-hidden="true" />
              {t("settings.agents.projects.add")}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            {t("settings.agents.projects.hashOnly")}
          </TooltipContent>
        </Tooltip>
      }
    >
      {bridge.allowed_projects.length === 0 ? (
        <div className="px-4 py-2.5">
          <Notice>{t("settings.agents.projects.empty")}</Notice>
        </div>
      ) : (
        bridge.allowed_projects.map((project) => (
          <div
            key={project.canonical_project_hash}
            className="flex min-h-[52px] min-w-0 items-center justify-between gap-4 px-4 py-2.5"
          >
            <code className="min-w-0 font-mono text-xs break-all text-gray-1000">
              {project.canonical_project_hash}
            </code>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-red-900"
              title={t("settings.agents.projects.remove")}
              aria-label={t("settings.agents.projects.remove")}
              onClick={() =>
                void mutateBridge(() =>
                  commands.removeAgentBridgeProject(
                    project.canonical_project_hash,
                  ),
                )
              }
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))
      )}
    </SettingsSection>
  );
};
