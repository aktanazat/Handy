import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/vg/button";
import { Checkbox } from "@/components/vg/checkbox";
import {
  Notice,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/rows";
import { FailureNotice } from "./FailureNotice";
import { useUpstreamImport } from "./useUpstreamImport";

const NUMBER_FORMATTER = new Intl.NumberFormat();

export const PrivacyUpstreamImport: React.FC = () => {
  const { t } = useTranslation();
  const {
    upstreamStatus: status,
    loadingUpstreamStatus,
    upstreamSelection,
    setUpstreamSelection,
    upstreamProgress,
    upstreamResult,
    upstreamError,
    upstreamImporting: importing,
    upstreamSourceHasImportableData,
    upstreamSelectionValid,
    upstreamRecordingSize,
    upstreamImportAvailable,
    changeUpstreamHistorySelection,
    startUpstreamImport,
    refreshUpstreamStatus,
  } = useUpstreamImport();

  if (status?.available) {
    return (
      <SettingsSection
        label={t("settings.privacy.upstreamImport.title")}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshUpstreamStatus()}
              disabled={loadingUpstreamStatus || importing}
            >
              {t("settings.privacy.upstreamImport.refresh")}
            </Button>
            <Button
              size="sm"
              onClick={() => void startUpstreamImport()}
              disabled={
                !upstreamImportAvailable || !upstreamSelectionValid || importing
              }
            >
              {importing
                ? t("settings.privacy.upstreamImport.importing")
                : t("settings.privacy.upstreamImport.import")}
            </Button>
          </div>
        }
      >
        <div className="px-4 py-2.5">
          <Notice live={false}>
            {t("settings.privacy.upstreamImport.scope")}
          </Notice>
        </div>
        {/* The counts sit on the rows that import them: three sentences of
         * inventory above three checkboxes said each number twice. */}
        <fieldset disabled={importing}>
          <legend className="sr-only">
            {t("settings.privacy.upstreamImport.selection")}
          </legend>
          <div className="divide-y divide-gray-alpha-400">
            <SettingsRow
              label={t("settings.privacy.upstreamImport.selectionSettings")}
              controlId="privacy-import-settings"
              disabled={!status.settings_available}
            >
              <Checkbox
                id="privacy-import-settings"
                checked={upstreamSelection.settings}
                disabled={!status.settings_available || importing}
                onCheckedChange={(checked) =>
                  setUpstreamSelection((current) => ({
                    ...current,
                    settings: checked === true,
                  }))
                }
              />
            </SettingsRow>
            <SettingsRow
              label={t("settings.privacy.upstreamImport.selectionHistory")}
              fact={NUMBER_FORMATTER.format(status.history_entries)}
              controlId="privacy-import-history"
              disabled={status.history_entries === 0}
            >
              <Checkbox
                id="privacy-import-history"
                checked={upstreamSelection.history}
                disabled={status.history_entries === 0 || importing}
                onCheckedChange={(checked) =>
                  changeUpstreamHistorySelection(checked === true)
                }
              />
            </SettingsRow>
            <SettingsRow
              label={t("settings.privacy.upstreamImport.selectionRecordings")}
              hint={t(
                "settings.privacy.upstreamImport.recordingsRequireHistory",
              )}
              /* KiB/MiB carry meaning in their case, and the mono fact type
               * is uppercase, so the measurement opts out of it. */
              fact={
                <span className="normal-case">
                  {`${NUMBER_FORMATTER.format(status.recording_files)} · ${t(
                    "settings.privacy.upstreamImport.byteCount",
                    {
                      value: NUMBER_FORMATTER.format(
                        upstreamRecordingSize.value,
                      ),
                      unit: t(
                        "settings.privacy.upstreamImport.byteUnits." +
                          upstreamRecordingSize.unit,
                      ),
                    },
                  )}`}
                </span>
              }
              controlId="privacy-import-recordings"
              disabled={
                !upstreamSelection.history || status.recording_files === 0
              }
            >
              <Checkbox
                id="privacy-import-recordings"
                checked={upstreamSelection.recordings}
                disabled={
                  !upstreamSelection.history ||
                  status.recording_files === 0 ||
                  importing
                }
                onCheckedChange={(checked) =>
                  setUpstreamSelection((current) => ({
                    ...current,
                    recordings: checked === true,
                  }))
                }
              />
            </SettingsRow>
          </div>
        </fieldset>
        <div className="flex flex-col gap-1.5 px-4 py-2.5 empty:hidden">
          {status.app_state === "running" ? (
            <Notice tone="danger">
              {t("settings.privacy.upstreamImport.appRunning")}
            </Notice>
          ) : null}
          {status.app_state === "unverifiable" ? (
            <Notice tone="danger">
              {t("settings.privacy.upstreamImport.appUnverifiable")}
            </Notice>
          ) : null}
          {!upstreamSourceHasImportableData ? (
            <Notice>{t("settings.privacy.upstreamImport.source.empty")}</Notice>
          ) : !upstreamSelectionValid ? (
            <Notice>
              {t("settings.privacy.upstreamImport.selectionRequired")}
            </Notice>
          ) : null}
          {upstreamProgress ? (
            <Notice>
              {t("settings.privacy.upstreamImport.progress", {
                phase: t(
                  "settings.privacy.upstreamImport.phases." +
                    upstreamProgress.phase,
                ),
                completed: upstreamProgress.completed,
                total: upstreamProgress.total,
              })}
            </Notice>
          ) : null}
          {upstreamResult ? (
            <Notice>
              {t("settings.privacy.upstreamImport.result", {
                settings: upstreamResult.settings_imported
                  ? t("settings.privacy.upstreamImport.settingsImported")
                  : t(
                      "settings.privacy.upstreamImport.settingsAlreadyImported",
                    ),
                historyImported: upstreamResult.history_imported,
                historyExisting: upstreamResult.history_existing,
                recordingsCopied: upstreamResult.recordings_copied,
                recordingsExisting: upstreamResult.recordings_existing,
              })}
            </Notice>
          ) : null}
          {upstreamError ? (
            <Notice tone="danger">
              {t("settings.privacy.upstreamImport.errors." + upstreamError)}
            </Notice>
          ) : null}
        </div>
      </SettingsSection>
    );
  }

  if (upstreamError) {
    return (
      <SettingsSection label={t("settings.privacy.upstreamImport.title")}>
        <FailureNotice
          className="px-4 py-2.5"
          onRetry={() => void refreshUpstreamStatus()}
          retryDisabled={loadingUpstreamStatus}
        >
          {t("settings.privacy.upstreamImport.errors." + upstreamError)}
        </FailureNotice>
      </SettingsSection>
    );
  }

  return null;
};
