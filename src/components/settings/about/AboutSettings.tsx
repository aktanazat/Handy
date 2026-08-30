import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commands } from "@/bindings";
import {
  SettingsField,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { AppDataDirectory } from "../AppDataDirectory";
import { LogDirectory } from "../debug/LogDirectory";
import { ShowWhatsNewOnUpdate } from "../ShowWhatsNewOnUpdate";
import { UpdateRows, type VersionState } from "./UpdateRows";

const REPOSITORY_URL = "https://github.com/aktanazat/Handy";
const UPSTREAM_URL = "https://github.com/cjpais/Handy";

const openLicenseNotices = async () => {
  const result = await commands.openLicenseNotices();
  if (result.status === "error") {
    console.error("Failed to open bundled notices:", result.error);
  }
};

const openExternal = async (url: string) => {
  try {
    await openUrl(url);
  } catch (error) {
    console.error("Failed to open link:", error);
  }
};

/* The only page in the app allowed to print a version or a build fact. */
export const AboutSettings: React.FC = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState<VersionState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        if (!cancelled) setVersion({ kind: "ready", version: appVersion });
      } catch (error) {
        console.error("Failed to get app version:", error);
        if (!cancelled) setVersion({ kind: "unavailable" });
      }
    };

    void fetchVersion();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SettingsPage title={t("settings.about.title")}>
      <SettingsSection label={t("settings.about.updates.title")}>
        <UpdateRows version={version} />
        <ShowWhatsNewOnUpdate />
      </SettingsSection>

      <SettingsSection label={t("settings.about.source.title")}>
        {/* Each row prints its URL once and opens it once. The button used to
         * repeat the host the URL already names. */}
        <SettingsRow
          label={t("settings.about.source.repository")}
          hint={t("settings.about.source.license")}
        >
          {/* The scheme is the one part of these two URLs that is identical on
           * both rows and tells the reader nothing, so only the identifying
           * part is shown. The button still opens the whole URL, and the
           * accessible name still carries it.
           *
           * A URL is a value, not a label: one step under the 13px mono value
           * tier, one step over the 11px `Microlabel`. A rem-based `text-xs`
           * would land it at 10.5px against this app's 14px root, below the
           * mono labels it sits beside. */}
          <span className="max-w-[260px] truncate font-mono text-[12px] text-gray-900">
            {REPOSITORY_URL.replace("https://", "")}
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label={`${t("common.open")} ${REPOSITORY_URL}`}
            onClick={() => void openExternal(REPOSITORY_URL)}
          >
            <ExternalLink aria-hidden="true" />
            {t("common.open")}
          </Button>
        </SettingsRow>
        <SettingsRow label={t("settings.about.source.upstream")}>
          <span className="max-w-[260px] truncate font-mono text-[12px] text-gray-900">
            {UPSTREAM_URL.replace("https://", "")}
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label={`${t("common.open")} ${UPSTREAM_URL}`}
            onClick={() => void openExternal(UPSTREAM_URL)}
          >
            <ExternalLink aria-hidden="true" />
            {t("common.open")}
          </Button>
        </SettingsRow>
        <SettingsRow label={t("settings.about.sourceCode.title")}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openLicenseNotices()}
          >
            {t("settings.about.sourceCode.button")}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection label={t("settings.about.files.title")}>
        <AppDataDirectory />
        <LogDirectory />
      </SettingsSection>

      <SettingsSection label={t("settings.about.acknowledgments.title")}>
        <SettingsField label={t("settings.about.acknowledgments.ggml.title")}>
          <p className="text-sm text-gray-900">
            {t("settings.about.acknowledgments.ggml.details")}
          </p>
        </SettingsField>
      </SettingsSection>
    </SettingsPage>
  );
};
