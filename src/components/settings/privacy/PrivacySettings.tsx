import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsPage } from "@/components/settings/rows";
import { CloudSyncPanel } from "../../cloud-sync/CloudSyncPanel";
import { PrivacyContextSettings } from "./PrivacyContextSettings";
import { PrivacyDataSettings } from "./PrivacyDataSettings";
import { PrivacyDiagnostics } from "./PrivacyDiagnostics";
import { PrivacyEgress } from "./PrivacyEgress";
import { PrivacyUpstreamImport } from "./PrivacyUpstreamImport";
import { useContextDiagnostics } from "./useContextDiagnostics";

export const PrivacySettings: React.FC = () => {
  const { t } = useTranslation();
  /* The one reading two sections share: the capture controls write a ceiling,
   * and what this build can actually read changes with it. Every other
   * section owns its own state. */
  const diagnostics = useContextDiagnostics();

  return (
    <SettingsPage title={t("settings.privacy.title")}>
      {/* Ordered by how far the data travels: the egress card answers the one
       * question this page exists for, then what Sona reads from other apps,
       * then what this build can actually read, then what stays on disk. */}
      <PrivacyEgress />
      <PrivacyContextSettings refreshDiagnostics={diagnostics.refresh} />
      <PrivacyDiagnostics resource={diagnostics} />
      <PrivacyDataSettings />
      {/* Setup, recovery and pairing stay collapsed: they are a one-time
       * task, and they must not read as a switch that is simply off. */}
      <CloudSyncPanel />
      <PrivacyUpstreamImport />
    </SettingsPage>
  );
};
