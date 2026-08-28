import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type KeyboardDiagnosticReport } from "@/bindings";
import {
  Alert,
  Button,
  SettingContainer,
  StatusText,
  type StatusTone,
} from "@/components/ui";
import { useOsType } from "../../../hooks/useOsType";

/**
 * Count-only keyboard capture test (macOS).
 *
 * Opens a short-lived listener and tallies how many key-down / key-up /
 * modifier / mouse events reach Sona — never *which* keys were pressed.
 * The signature of stuck Secure Input (issue #1578) is modifier events
 * flowing while key-down stays at zero.
 */
export const KeyboardDiagnostic: React.FC = () => {
  const { t } = useTranslation();
  const osType = useOsType();
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<KeyboardDiagnosticReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (osType !== "macos") {
    return null;
  }

  const runDiagnostic = async () => {
    setRunning(true);
    setReport(null);
    setError(null);
    try {
      const result = await commands.runKeyboardDiagnostic(10);
      if (result.status === "ok") {
        setReport(result.data);
      } else {
        setError(result.error);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  /* Blocked and suspicious both mean "your keys are not reaching Sona", which
   * is the whole reason someone opens this row, so they read as failures. */
  type Verdict = { text: string; tone: StatusTone };
  const verdict = (r: KeyboardDiagnosticReport): Verdict => {
    if (r.secure_input_enabled && r.key_down === 0) {
      return {
        text: t("settings.debug.keyboardDiagnostic.verdictBlocked"),
        tone: "danger",
      };
    }
    if (!r.secure_input_enabled && r.key_down === 0 && r.flags_changed > 0) {
      return {
        text: t("settings.debug.keyboardDiagnostic.verdictSuspicious"),
        tone: "danger",
      };
    }
    if (r.key_down === 0 && r.flags_changed === 0 && r.mouse === 0) {
      return {
        text: t("settings.debug.keyboardDiagnostic.verdictNoEvents"),
        tone: "warning",
      };
    }
    return {
      text: t("settings.debug.keyboardDiagnostic.verdictOk"),
      tone: "success",
    };
  };

  const secureInputLine = (r: KeyboardDiagnosticReport): string => {
    const state = r.secure_input_enabled
      ? t("settings.debug.keyboardDiagnostic.enabled")
      : t("settings.debug.keyboardDiagnostic.disabled");
    if (!r.secure_input_enabled) {
      return state;
    }
    const holder =
      r.culprit_name !== null
        ? t("settings.debug.keyboardDiagnostic.holder", {
            name: r.culprit_name,
            pid: r.culprit_pid,
          })
        : t("settings.debug.keyboardDiagnostic.holderUnknown");
    return `${state} — ${holder}`;
  };

  return (
    <>
      <SettingContainer
        grouped
        title={t("settings.debug.keyboardDiagnostic.title")}
        description={t("settings.debug.keyboardDiagnostic.description")}
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void runDiagnostic()}
          disabled={running}
        >
          {t("settings.debug.keyboardDiagnostic.run")}
        </Button>
      </SettingContainer>
      {running ? (
        <div className="px-4 py-3">
          <StatusText live="polite">
            {t("settings.debug.keyboardDiagnostic.running")}
          </StatusText>
        </div>
      ) : null}
      {error === null ? null : (
        <Alert
          contained
          variant="error"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void runDiagnostic()}
            >
              {t("common.retry")}
            </Button>
          }
        >
          {t("settings.debug.keyboardDiagnostic.failed", { error })}
        </Alert>
      )}
      {report === null ? null : (
        <div className="space-y-1.5 px-4 py-3">
          <StatusText tone={verdict(report).tone} live="polite">
            {verdict(report).text}
          </StatusText>
          <p className="font-mono text-[12px] leading-4 text-text-secondary tabular-nums">
            {t("settings.debug.keyboardDiagnostic.secureInputLabel")}:{" "}
            {secureInputLine(report)}
          </p>
          <p className="font-mono text-[12px] leading-4 text-text-secondary tabular-nums">
            {t("settings.debug.keyboardDiagnostic.keyDown")}: {report.key_down}{" "}
            · {t("settings.debug.keyboardDiagnostic.keyUp")}: {report.key_up} ·{" "}
            {t("settings.debug.keyboardDiagnostic.flagsChanged")}:{" "}
            {report.flags_changed} ·{" "}
            {t("settings.debug.keyboardDiagnostic.mouse")}: {report.mouse}
          </p>
        </div>
      )}
    </>
  );
};
