import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commands } from "@/bindings";
import { Button, SettingContainer, SettingsGroup } from "@/components/ui";
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
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("settings.about.title")}</h1>
        <p className="settings-page-description">
          {t(
            "settings.about.description",
            "Which build you are running, where it came from, and where it keeps your files.",
          )}
        </p>
      </header>

      <SettingsGroup
        title={t("settings.about.updates.title", "Version and updates")}
      >
        <UpdateRows version={version} />
        <ShowWhatsNewOnUpdate grouped />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.about.source.title", "Source")}
        description={t(
          "settings.about.source.description",
          "Sona is MIT licensed, copyright 2025 CJ Pais, and built on top of Handy.",
        )}
      >
        <SettingContainer
          grouped
          title={t("settings.about.source.repository", "Repository")}
          description={REPOSITORY_URL}
        >
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => void openExternal(REPOSITORY_URL)}
          >
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            {t("settings.about.source.open", "Open on GitHub")}
          </Button>
        </SettingContainer>
        <SettingContainer
          grouped
          title={t("settings.about.source.upstream", "Built on Handy")}
          description={t(
            "settings.about.source.upstreamDescription",
            "Sona is a fork of cjpais/Handy and still tracks its upstream fixes.",
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => void openExternal(UPSTREAM_URL)}
          >
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            {t("settings.about.source.upstreamOpen", "cjpais/Handy")}
          </Button>
        </SettingContainer>
        <SettingContainer
          grouped
          title={t("settings.about.sourceCode.title")}
          description={t("settings.about.sourceCode.description")}
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void openLicenseNotices()}
          >
            {t("settings.about.sourceCode.button")}
          </Button>
        </SettingContainer>
      </SettingsGroup>

      <SettingsGroup title={t("settings.about.files.title", "Files")}>
        <AppDataDirectory grouped />
        <LogDirectory grouped />
      </SettingsGroup>

      <SettingsGroup title={t("settings.about.acknowledgments.title")}>
        <SettingContainer
          grouped
          layout="stacked"
          title={t("settings.about.acknowledgments.ggml.title")}
          description={t("settings.about.acknowledgments.ggml.description")}
        >
          <p className="text-[13px] leading-5 text-text-secondary">
            {t("settings.about.acknowledgments.ggml.details")}
          </p>
        </SettingContainer>
      </SettingsGroup>
    </div>
  );
};
