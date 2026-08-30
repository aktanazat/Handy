import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { Button } from "@/components/vg/button";
import { Notice, SettingsField } from "./rows";

export const AppDataDirectory: React.FC = () => {
  const { t } = useTranslation();
  const [appDirPath, setAppDirPath] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await commands.getAppDirPath();
        if (result.status === "ok") {
          setAppDirPath(result.data);
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load app directory",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const label = t("settings.about.appDataDirectory.title");

  if (loading || error !== null) {
    return (
      <SettingsField label={label}>
        <Notice tone={error === null ? "muted" : "danger"}>
          {error === null
            ? t("common.loading")
            : t("errors.loadDirectory", { error })}
        </Notice>
      </SettingsField>
    );
  }

  /* The path is the row's answer, printed once, in mono because it is a
   * machine string. The row's old description said "Where Sona stores its
   * data" above exactly that path.
   *
   * The action is outline rather than ghost: a ghost button has no border and
   * no fill at rest, so the bare word "Open" beside a path reads as more path.
   * The icon-only reset affordances elsewhere stay ghost — their glyph is the
   * affordance. */
  return (
    <SettingsField label={label}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-800 select-text">
          {appDirPath}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!appDirPath}
          onClick={() =>
            void commands
              .openAppDataDir()
              .catch((openError) =>
                console.error("Failed to open app data directory:", openError),
              )
          }
        >
          {t("common.open")}
        </Button>
      </div>
    </SettingsField>
  );
};
