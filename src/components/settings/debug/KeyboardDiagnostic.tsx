import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type KeyboardDiagnosticReport } from "@/bindings";
import { FactChip, Notice, SettingsRow } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
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
  /* The backend's reason, not a sentence. Sona ships 23 catalogs, and a
   * message translated when it is stored would stay in the old language after
   * a language switch until the operator re-runs the diagnostic. */
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
    } catch (thrown) {
      /* Same shape as the command's own reason, so both paths reach the same
       * branch at render: a rejected Error would otherwise arrive as
       * "Error: permission_denied" and fall through to the generic message. */
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setRunning(false);
    }
  };
  /* Blocked and suspicious both mean "your keys are not reaching Sona", which
   * is the whole reason someone opens this row, so they read as failures. A
   * healthy result is the unremarkable one and stays in the grey ladder — this
   * palette has no success hue and a working keyboard needs no celebrating. */
  interface KeyboardVerdict {
    text: string;
    tone: "muted" | "warning" | "danger";
  }
  const verdict = (r: KeyboardDiagnosticReport): KeyboardVerdict => {
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
      tone: "muted",
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

  const currentVerdict = report === null ? null : verdict(report);

  return (
    <>
      <SettingsRow
        label={t("settings.debug.keyboardDiagnostic.title")}
        hint={t("settings.debug.keyboardDiagnostic.description")}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => void runDiagnostic()}
          disabled={running}
        >
          {t("settings.debug.keyboardDiagnostic.run")}
        </Button>
      </SettingsRow>

      {running ? (
        <div className="px-4 py-3">
          <Notice>{t("settings.debug.keyboardDiagnostic.running")}</Notice>
        </div>
      ) : null}

      {error === null ? null : (
        <div className="flex items-center justify-between gap-6 px-4 py-3">
          <Notice tone="danger" className="min-w-0">
            {error === "permission_denied"
              ? t("settings.debug.keyboardDiagnostic.inputMonitoringDenied")
              : t("settings.debug.keyboardDiagnostic.failed", { error })}
          </Notice>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runDiagnostic()}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}

      {report === null || currentVerdict === null ? null : (
        <div className="flex flex-col gap-2 px-4 py-3">
          <Notice tone={currentVerdict.tone}>{currentVerdict.text}</Notice>
          {/* The raw counts are the reading; the sentence above is only the
           * interpretation of them. */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <FactChip
              label={t("settings.debug.keyboardDiagnostic.secureInputLabel")}
              value={secureInputLine(report)}
            />
            <FactChip
              label={t("settings.debug.keyboardDiagnostic.keyDown")}
              value={report.key_down}
            />
            <FactChip
              label={t("settings.debug.keyboardDiagnostic.keyUp")}
              value={report.key_up}
            />
            <FactChip
              label={t("settings.debug.keyboardDiagnostic.flagsChanged")}
              value={report.flags_changed}
            />
            <FactChip
              label={t("settings.debug.keyboardDiagnostic.mouse")}
              value={report.mouse}
            />
          </div>
        </div>
      )}
    </>
  );
};
