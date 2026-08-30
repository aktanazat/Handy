import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { SettingContainer } from "../../ui/SettingContainer";
import { PathDisplay } from "../../ui/PathDisplay";

interface LogDirectoryProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const LogDirectory: React.FC<LogDirectoryProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const [logDir, setLogDir] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadLogDirectory = async () => {
      try {
        const result = await commands.getLogDirPath();
        if (result.status === "ok") {
          setLogDir(result.data);
        } else {
          setError(result.error);
        }
      } catch (err) {
        /* `commands.getLogDirPath` rethrows only `Error` instances — every
         * other failure value is returned as the `status: "error"` branch
         * handled above — so this is the whole domain of what lands here. */
        setError(
          err instanceof Error ? err.message : "Failed to load log directory",
        );
      } finally {
        setLoading(false);
      }
    };

    loadLogDirectory();
  }, []);

  const handleOpen = async () => {
    if (!logDir) return;
    try {
      await commands.openLogDir();
    } catch (openError) {
      console.error("Failed to open log directory:", openError);
    }
  };

  return (
    <SettingContainer
      title={t("settings.debug.logDirectory.title")}
      description={t("settings.debug.logDirectory.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="stacked"
    >
      {loading ? (
        <div role="status" className="surface-state">
          <span aria-hidden="true" className="surface-state-spinner" />
          <span>{t("common.loading")}</span>
        </div>
      ) : error ? (
        <div role="alert" className="surface-state">
          {t("errors.loadDirectory", { error })}
        </div>
      ) : (
        <PathDisplay path={logDir} onOpen={handleOpen} disabled={!logDir} />
      )}
    </SettingContainer>
  );
};
