import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { commands } from "@/bindings";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Notice, SettingsRow } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Switch } from "@/components/vg/switch";
import { checkForUpdates, type UpdateCheckResult } from "@/lib/updateCheck";

/** Three real states, so a failed read cannot masquerade as a slow one. */
export type VersionState =
  | { kind: "loading" }
  | { kind: "ready"; version: string }
  | { kind: "unavailable" };

interface UpdateRowsProps {
  version: VersionState;
}

const AUTO_CHECK_ID = "about-auto-update-check";

/** Whatever the surface currently has to say, as one line and at most one act. */
interface Status {
  text: string;
  /* A waiting release is `info`, not a fault and not chrome: something arrived
   * the reader did not ask for. */
  tone: "muted" | "info" | "danger";
  action?: React.ReactNode;
}

/* Version, the automatic-check preference, and a manual check whose verdict is
 * one line. The backend enforces the preference: with it off, check_for_updates
 * reports "disabled" and makes no network call, so this surface never has to
 * claim a check happened when it did not.
 *
 * The running version is printed once, as a value, and nowhere else — not in a
 * sentence under itself, not again in the verdict of a successful check. */
export const UpdateRows: React.FC<UpdateRowsProps> = ({ version }) => {
  const { t } = useTranslation();
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

  /* Bordered, not ghost: this button sits beside a sentence, and a ghost whose
   * label carries the whole affordance reads as part of that sentence. Only the
   * icon-only affordances stay borderless. */
  const retry = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void runCheck()}
      disabled={checking}
    >
      {t("common.retry")}
    </Button>
  );

  /* One status line for the whole surface: a failed save and a failed check
   * cannot both be the most recent thing that happened. */
  const currentStatus = (): Status | null => {
    if (preferenceError !== null) {
      return {
        text: `${t("settings.about.updates.preferenceError")} ${preferenceError}`,
        tone: "danger",
      };
    }
    if (checkError !== null) {
      return {
        text: `${t("settings.about.updates.failed")} ${checkError}`,
        tone: "danger",
        action: retry,
      };
    }
    if (result === null) return null;
    if (result.status === "disabled") {
      /* The switch above is the affordance that turns checks back on, so this
       * line only has to report that nothing was asked of GitHub. */
      return { text: t("settings.about.updates.disabled"), tone: "muted" };
    }
    if (result.status === "check_failed") {
      return {
        text:
          result.error === null
            ? t("settings.about.updates.failed")
            : `${t("settings.about.updates.failed")} ${result.error}`,
        tone: "danger",
        action: retry,
      };
    }
    if (
      result.status === "update_available" &&
      result.latest_version !== null
    ) {
      const url = result.url;
      return {
        text: t("settings.about.updates.available", {
          version: result.latest_version,
        }),
        tone: "info",
        action:
          url === null ? undefined : (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await openUrl(url);
                } catch (error) {
                  console.error("Failed to open the release page:", error);
                }
              }}
            >
              <ExternalLink aria-hidden="true" />
              {t("settings.about.updates.viewRelease")}
            </Button>
          ),
      };
    }
    return { text: t("settings.about.updates.upToDate"), tone: "muted" };
  };

  const status = currentStatus();

  return (
    <>
      {/* Version and the act of checking it are one question, so they are one
       * row: the running build on the left of the button that asks GitHub
       * whether there is a newer one. */}
      <SettingsRow label={t("settings.about.version.title")}>
        {displayVersion !== null ? (
          <span className="text-[14px] tabular-nums text-gray-1000">
            {`v${displayVersion}`}
          </span>
        ) : (
          /* No value exists yet, so the slot dims. Red is reserved for faults
           * and destructive acts; a missing read is named in words. */
          <Notice>
            {version.kind === "loading"
              ? t("common.loading")
              : t("settings.about.version.unavailable")}
          </Notice>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void runCheck()}
          disabled={checking}
        >
          {checking
            ? t("settings.about.updates.checking")
            : t("settings.about.updates.check")}
        </Button>
      </SettingsRow>

      <SettingsRow
        label={t("settings.about.updates.autoLabel")}
        hint={t("settings.about.updates.autoDescription")}
        controlId={AUTO_CHECK_ID}
        disabled={enabled === null}
      >
        <Switch
          id={AUTO_CHECK_ID}
          checked={enabled ?? true}
          disabled={enabled === null || savingPreference}
          onCheckedChange={(next) => void changeEnabled(next)}
        />
      </SettingsRow>

      {status === null ? null : (
        <div className="flex min-h-[52px] items-center justify-between gap-6 px-6 py-2.5">
          <Notice tone={status.tone} className="min-w-0">
            {status.text}
          </Notice>
          {status.action}
        </div>
      )}
    </>
  );
};
