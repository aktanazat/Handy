import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/vg/button";
import {
  Microlabel,
  Notice,
  SettingsSection,
} from "@/components/settings/rows";
import type { AgentBridgeSettingsModel } from "./useAgentBridgeSettings";

interface AgentBridgeRequestsProps {
  requests: AgentBridgeSettingsModel["requests"];
  interactiveReady: AgentBridgeSettingsModel["interactiveReady"];
  expiryTimeFormatter: AgentBridgeSettingsModel["expiryTimeFormatter"];
  decidePermission: AgentBridgeSettingsModel["decidePermission"];
  dismissRequest: AgentBridgeSettingsModel["dismissRequest"];
}

export const AgentBridgeRequests: React.FC<AgentBridgeRequestsProps> = ({
  requests,
  interactiveReady,
  expiryTimeFormatter,
  decidePermission,
  dismissRequest,
}) => {
  const { t } = useTranslation();

  return (
    <SettingsSection label={t("settings.agents.observed.requests")}>
      {requests.length === 0 ? (
        <div className="px-4 py-2.5">
          <Notice>{t("settings.agents.observed.noRequests")}</Notice>
        </div>
      ) : (
        requests.map((request) => {
          const canRespondToPermission =
            interactiveReady &&
            request.agent === "claude" &&
            request.kind === "pre_tool_use" &&
            request.state === "observed" &&
            (request.tool_name === "AskUserQuestion" ||
              request.tool_name === "ExitPlanMode");
          const ompPermissionObserveOnly =
            request.agent === "omp" &&
            request.kind === "permission_request" &&
            request.state === "observed";

          return (
            <div
              key={request.id}
              className="flex min-w-0 flex-wrap items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-5 break-words text-gray-1000">
                  {t(
                    "settings.agents.controls.providers." +
                      request.agent +
                      ".label",
                  )}
                  {" · "}
                  {t("settings.agents.observed.requestKinds." + request.kind)}
                  {request.tool_name ? " · " + request.tool_name : ""}
                </p>
                <Microlabel className="mt-1 block">
                  {t("settings.agents.observed.expires", {
                    time: expiryTimeFormatter.format(
                      new Date(request.expires_at_ms),
                    ),
                  })}
                </Microlabel>
                {ompPermissionObserveOnly ? (
                  <Notice className="mt-1">
                    {t("settings.agents.observed.ompPermissionObserveOnly")}
                  </Notice>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {canRespondToPermission ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void decidePermission(request, "allow")}
                    >
                      {t("settings.agents.observed.allowExact")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-900"
                      onClick={() => void decidePermission(request, "deny")}
                    >
                      {t("settings.agents.observed.denyExact")}
                    </Button>
                  </>
                ) : null}
                {request.agent === "claude" && request.state === "observed" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void dismissRequest(request.id)}
                  >
                    {t("settings.agents.observed.dismiss")}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })
      )}
    </SettingsSection>
  );
};
