import { useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type ContextPolicy } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";

/* The two writes that decide what Sona reads from other apps. Both change
 * what the diagnostics table below can report, so both refresh it after the
 * backend has taken the new value. */
export const useContextCapture = (refreshDiagnostics: () => Promise<void>) => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings } = useSettings();
  const [ceilingError, setCeilingError] = useState<string | null>(null);
  const [ceilingUpdating, setCeilingUpdating] = useState(false);
  const [urlCaptureError, setUrlCaptureError] = useState<string | null>(null);
  const [urlCaptureUpdating, setUrlCaptureUpdating] = useState(false);
  const contextCeiling = getSetting("context_policy_ceiling") ?? "none";
  const contextUrlCaptureEnabled =
    getSetting("context_url_capture_enabled") ?? false;

  const changeContextCeiling = async (ceiling: ContextPolicy) => {
    setCeilingUpdating(true);
    setCeilingError(null);
    try {
      await commands.changeContextPolicyCeilingSetting(ceiling);
      await refreshSettings();
      await refreshDiagnostics();
    } catch (error) {
      setCeilingError(String(error));
    } finally {
      setCeilingUpdating(false);
    }
  };

  const changeContextUrlCaptureEnabled = async (enabled: boolean) => {
    setUrlCaptureUpdating(true);
    setUrlCaptureError(null);
    try {
      await commands.changeContextUrlCaptureEnabledSetting(enabled);
      await refreshSettings();
      await refreshDiagnostics();
    } catch {
      setUrlCaptureError(t("settings.privacy.context.urlCapture.error"));
    } finally {
      setUrlCaptureUpdating(false);
    }
  };

  return {
    contextCeiling,
    contextUrlCaptureEnabled,
    ceilingError,
    ceilingUpdating,
    urlCaptureError,
    urlCaptureUpdating,
    changeContextCeiling,
    changeContextUrlCaptureEnabled,
  };
};
