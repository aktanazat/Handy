import React from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContextDiagnostics } from "@/bindings";
import { Button } from "@/components/vg/button";
import {
  Notice,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/rows";
import { FailureNotice } from "./FailureNotice";
import { MonoState } from "./MonoState";
import type { ContextDiagnosticsResource } from "./useContextDiagnostics";

/* The per-source rows in the diagnostics section, in capture order. Each row
 * is a name and a status word: the prose that used to restate the name from
 * the Rust doc comments is gone. */
const CONTEXT_SOURCES = [
  "target_identity",
  "focused_field",
  "selected_text",
  "browser_url",
  "clipboard",
] as const satisfies readonly (keyof ContextDiagnostics)[];

/* Four different reasons a source went unread are four different things the
 * user can act on, so the colour follows the reason rather than flattening
 * everything to "off". The word is always present; colour never carries the
 * meaning alone. */
const diagnosticToneClass = (status: string): string => {
  switch (status) {
    case "granted":
    case "captured":
      return "text-gray-1000";
    case "denied":
    case "permission_denied":
    case "failed":
      return "text-red-900";
    case "disabled_by_ceiling":
    case "secure_field":
    case "stale":
      return "text-amber-900";
    default:
      return "text-gray-700";
  }
};

export const PrivacyDiagnostics: React.FC<{
  resource: ContextDiagnosticsResource;
}> = ({ resource }) => {
  const { t } = useTranslation();
  const diagnostics = resource.value;

  return (
    <SettingsSection
      label={t("settings.privacy.diagnostics.title")}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void resource.refresh()}
          disabled={resource.loading}
        >
          <RefreshCw
            aria-hidden="true"
            className={resource.loading ? "animate-spin" : undefined}
          />
          {t("settings.privacy.diagnostics.refresh")}
        </Button>
      }
    >
      {resource.error ? (
        <FailureNotice className="px-4 py-2.5">
          {`${t("settings.privacy.diagnostics.error")}: ${resource.error}`}
        </FailureNotice>
      ) : null}
      {resource.loading && diagnostics === null ? (
        <div className="px-4 py-2.5">
          <Notice>{t("common.loading")}</Notice>
        </div>
      ) : diagnostics === null ? null : (
        <>
          <SettingsRow
            label={t("settings.privacy.diagnostics.accessibility.label")}
          >
            <MonoState
              className={diagnosticToneClass(diagnostics.accessibility)}
            >
              {t("settings.privacy.status." + diagnostics.accessibility)}
            </MonoState>
          </SettingsRow>
          {CONTEXT_SOURCES.map((source) => (
            <SettingsRow
              key={source}
              label={t("settings.privacy.diagnostics.sources." + source)}
            >
              <MonoState className={diagnosticToneClass(diagnostics[source])}>
                {t("settings.privacy.status." + diagnostics[source])}
              </MonoState>
            </SettingsRow>
          ))}
        </>
      )}
    </SettingsSection>
  );
};
