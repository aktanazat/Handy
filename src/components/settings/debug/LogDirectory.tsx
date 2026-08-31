import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { Notice, SettingsField } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";

export const LogDirectory: React.FC = () => {
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
    <SettingsField label={t("settings.debug.logDirectory.title")}>
      {loading ? (
        <Notice>{t("common.loading")}</Notice>
      ) : error !== null ? (
        <Notice tone="danger">{t("errors.loadDirectory", { error })}</Notice>
      ) : (
        <div className="flex items-start gap-2">
          {/* The tail of a path is the part that identifies it, so it wraps
           * rather than truncating. */}
          <span className="min-w-0 flex-1 rounded-md border border-gray-alpha-400 bg-background-200 px-2 py-1.5 text-[12px] break-all text-gray-900 select-text">
            {logDir}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!logDir}
            onClick={() => void handleOpen()}
          >
            {t("common.open")}
          </Button>
        </div>
      )}
    </SettingsField>
  );
};
