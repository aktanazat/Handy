import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { commands } from "@/bindings";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Alert,
  Button,
  SettingContainer,
  StatusText,
  ToggleSwitch,
} from "@/components/ui";
import { checkForUpdates, type UpdateCheckResult } from "@/lib/updateCheck";

/** Three real states, so a failed read cannot masquerade as a slow one. */
export type VersionState =
  | { kind: "loading" }
  | { kind: "ready"; version: string }
  | { kind: "unavailable" };

interface UpdateRowsProps {
  version: VersionState;
}

/* Version, the automatic-check preference, and a manual check whose verdict
 * is rendered inline. The backend enforces the preference: with it off,
 * check_for_updates reports "disabled" and makes no network call, so this
 * surface never has to claim a check happened when it did not. */
export const UpdateRows: React.FC<UpdateRowsProps> = ({ version }) => {
  const { t, i18n } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [savingPreference, setSavingPreference] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const readPreference = async () => {
      try {
        const settings = await commands.getAppSettings();
        if (settings.status === "error") throw new Error(settings.error);
        if (!cancelled) setEnabled(settings.data.update_check_enabled ?? true);
      } catch (error) {
        if (!cancelled) setPreferenceError(String(error));
      }
    };

    void readPreference();
    return () => {
      cancelled = true;
    };
  }, []);

  const changeEnabled = useCallback(async (next: boolean) => {
    setSavingPreference(true);
    setPreferenceError(null);
    try {
      const saved = await commands.changeUpdateCheckEnabledSetting(next);
      if (saved.status === "error") throw new Error(saved.error);
      setEnabled(next);
      // A stale verdict would contradict the switch sitting next to it.
      setResult(null);
      setCheckError(null);
    } catch (error) {
      setPreferenceError(String(error));
    } finally {
      setSavingPreference(false);
    }
  }, []);

  const runCheck = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const next = await checkForUpdates();
      setResult(next);
      if (next.status === "disabled") setEnabled(false);
    } catch (error) {
      setResult(null);
      setCheckError(String(error));
    } finally {
      setChecking(false);
    }
  }, []);

  /* A completed check reports the running version too, so it can rescue the
   * row when the app handle would not answer. */
  const displayVersion =
    version.kind === "ready"
      ? version.version
      : (result?.current_version ?? null);

  return (
    <>
      <SettingContainer
        grouped
        title={t("settings.about.version.title")}
        description={t("settings.about.version.description")}
      >
        {displayVersion !== null ? (
          <span className="font-mono text-[13px] text-text-primary tabular-nums">
            {`v${displayVersion}`}
          </span>
        ) : version.kind === "loading" ? (
          <StatusText live="polite">{t("common.loading")}</StatusText>
        ) : (
          /* No value exists yet, so the slot dims — the greyscale text law.
           * Red is reserved for status indicators and destructive actions; a
           * missing read is named in words, not dressed as a fault. */
          <StatusText>
            {t("settings.about.version.unavailable", "Unavailable")}
          </StatusText>
        )}
      </SettingContainer>

      <ToggleSwitch
        grouped
        checked={enabled ?? true}
        disabled={enabled === null}
        isUpdating={savingPreference}
        onChange={(next) => void changeEnabled(next)}
        label={t(
          "settings.about.updates.autoLabel",
          "Check for updates automatically",
        )}
        description={t(
          "settings.about.updates.autoDescription",
          "Asks GitHub for the latest release. Sona never installs anything on its own.",
        )}
      />

      <SettingContainer
        grouped
        title={t("settings.about.updates.manualTitle", "Manual check")}
        description={t(
          "settings.about.updates.manualDescription",
          "Compare this build against the latest published release.",
        )}
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void runCheck()}
          disabled={checking}
        >
          {checking
            ? t("settings.about.updates.checking", "Checking…")
            : t("settings.about.updates.check", "Check now")}
        </Button>
      </SettingContainer>

      {preferenceError === null ? null : (
        <Alert contained variant="error">
          {`${t("settings.about.updates.preferenceError", "The update preference could not be saved.")} ${preferenceError}`}
        </Alert>
      )}

      {checkError === null ? null : (
        <Alert
          contained
          variant="error"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void runCheck()}
              disabled={checking}
            >
              {t("common.retry")}
            </Button>
          }
        >
          {`${t("settings.about.updates.failed", "The update check could not run.")} ${checkError}`}
        </Alert>
      )}

      {result === null || checkError !== null ? null : (
        <UpdateVerdict
          result={result}
          checking={checking}
          onEnable={() => void changeEnabled(true)}
          savingPreference={savingPreference}
          language={i18n.language}
        />
      )}
    </>
  );
};

interface UpdateVerdictProps {
  result: UpdateCheckResult;
  checking: boolean;
  onEnable: () => void;
  savingPreference: boolean;
  language: string;
}

const UpdateVerdict: React.FC<UpdateVerdictProps> = ({
  result,
  checking,
  onEnable,
  savingPreference,
  language,
}) => {
  const { t } = useTranslation();

  if (result.status === "disabled") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 py-3">
        <StatusText live="polite">
          {t(
            "settings.about.updates.disabled",
            "Automatic checks are off, so Sona did not contact GitHub.",
          )}
        </StatusText>
        <Button
          variant="secondary"
          size="sm"
          onClick={onEnable}
          disabled={savingPreference}
        >
          {t("settings.about.updates.enable", "Turn checks on")}
        </Button>
      </div>
    );
  }

  if (result.status === "check_failed") {
    return (
      <Alert contained variant="error">
        {result.error === null
          ? t(
              "settings.about.updates.failed",
              "The update check could not run.",
            )
          : `${t("settings.about.updates.failed", "The update check could not run.")} ${result.error}`}
      </Alert>
    );
  }

  if (result.status === "update_available" && result.latest_version !== null) {
    const url = result.url;
    const published =
      result.published_at_utc_ms === null
        ? null
        : new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(
            new Date(result.published_at_utc_ms),
          );

    return (
      <div className="flex flex-wrap items-start justify-between gap-3 py-3">
        <div className="min-w-0 space-y-1">
          <StatusText tone="info" live="polite">
            {t("settings.about.updates.available", {
              defaultValue: "Sona {{version}} is available.",
              version: result.latest_version,
            })}
          </StatusText>
          {published === null ? null : (
            <p className="text-[12px] leading-4 text-text-tertiary">
              {t("settings.about.updates.published", {
                defaultValue: "Published {{date}}",
                date: published,
              })}
            </p>
          )}
          {result.notes_excerpt === null ? null : (
            <p className="line-clamp-3 text-[12.5px] leading-[18px] text-text-secondary">
              {result.notes_excerpt}
            </p>
          )}
        </div>
        {url === null ? null : (
          <Button
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={async () => {
              try {
                await openUrl(url);
              } catch (error) {
                console.error("Failed to open the release page:", error);
              }
            }}
          >
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            {t("settings.about.updates.viewRelease", "View release")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="py-3">
      <StatusText tone={checking ? "muted" : "success"} live="polite">
        {t("settings.about.updates.upToDate", {
          defaultValue: "Sona {{version}} is the latest release.",
          version: result.current_version,
        })}
      </StatusText>
    </div>
  );
};
