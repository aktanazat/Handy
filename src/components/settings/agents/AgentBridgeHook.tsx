import React from "react";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/vg/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/vg/tooltip";
import { Notice, SettingsSection } from "@/components/settings/rows";
import type { AgentBridgeSettingsModel } from "./useAgentBridgeSettings";

interface AgentBridgeHookProps {
  hookSnippet: AgentBridgeSettingsModel["hookSnippet"];
  hookError: AgentBridgeSettingsModel["hookError"];
  copyHookSnippet: AgentBridgeSettingsModel["copyHookSnippet"];
}

export const AgentBridgeHook: React.FC<AgentBridgeHookProps> = ({
  hookSnippet,
  hookError,
  copyHookSnippet,
}) => {
  const { t } = useTranslation();

  /* Nothing to copy and nothing to report: the section stays off the page
   * rather than drawing an empty surface. */
  if (hookSnippet === null && hookError === null) return null;

  return (
    <SettingsSection
      label={t("settings.agents.hook.title")}
      action={
        hookSnippet === null ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyHookSnippet()}
              >
                <Copy aria-hidden="true" />
                {t("settings.agents.hook.copy")}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {t("settings.agents.hook.description")}
            </TooltipContent>
          </Tooltip>
        )
      }
    >
      {hookError === null ? null : (
        <div className="px-6 py-2.5">
          <Notice tone="danger">
            {`${t("settings.agents.hook.error")}: ${hookError}`}
          </Notice>
        </div>
      )}
      {hookSnippet === null ? null : (
        <pre className="max-w-full overflow-hidden px-6 py-3 text-xs break-all whitespace-pre-wrap text-gray-900">
          <code>{hookSnippet}</code>
        </pre>
      )}
    </SettingsSection>
  );
};
