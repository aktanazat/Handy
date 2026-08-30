import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Notice, SettingsField, SettingsRow } from "@/components/settings/rows";
import { FailureNotice } from "./FailureNotice";
import { MonoState } from "./MonoState";
import { useHistoryStorageStatus } from "./privacyStatus";

/* History is encrypted at rest with a key from the OS credential store. The
 * key is fetched off the startup path, so this row begins life "unlocking"
 * and settles when the backend raises history-storage-changed. Every failure
 * mode stays visible rather than silently reading a plaintext database. */
export const PrivacyHistoryStorage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const storage = useHistoryStorageStatus();
  const migratedFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language],
  );

  /* Only the reasons a reader can act on. "Unlocking" said the same thing as
   * the status word beside it, so it no longer says it twice. */
  const reasonText = (reason: string): string => {
    switch (reason) {
      case "key_unavailable":
        return t(
          "settings.privacy.data.historyStorage.reasons.key_unavailable",
          "The system credential store returned no usable key, so history is stored unencrypted.",
        );
      case "encryption_unavailable":
        return t(
          "settings.privacy.data.historyStorage.reasons.encryption_unavailable",
          "This build cannot open an encrypted database, so history is stored unencrypted.",
        );
      case "migration_failed":
        return t(
          "settings.privacy.data.historyStorage.reasons.migration_failed",
          "Encrypting the existing database failed. The unencrypted database is intact and still in use.",
        );
      case "key_rejected":
        return t(
          "settings.privacy.data.historyStorage.reasons.key_rejected",
          "The stored key does not open the encrypted database, so history cannot be read.",
        );
      default:
        return reason;
    }
  };

  const label = t(
    "settings.privacy.data.historyStorage.label",
    "History storage",
  );
  const status = storage.value;

  if (storage.phase === "failed") {
    return (
      <SettingsField label={label}>
        <FailureNotice onRetry={storage.reload}>
          {storage.error ??
            t(
              "settings.privacy.data.historyStorage.unknown",
              "Sona could not read how history is stored.",
            )}
        </FailureNotice>
      </SettingsField>
    );
  }

  if (status === null) {
    return (
      <SettingsRow label={label}>
        <Notice>{t("common.loading")}</Notice>
      </SettingsRow>
    );
  }

  const encryptedAndReadable = status.encrypted && status.reason === null;
  const unlocking = status.reason === "unlocking";
  const reason =
    encryptedAndReadable || status.reason === null || unlocking
      ? null
      : reasonText(status.reason);

  return (
    <>
      <SettingsRow
        label={label}
        fact={
          encryptedAndReadable && status.migrated_at !== null
            ? migratedFormatter.format(new Date(status.migrated_at))
            : undefined
        }
      >
        <MonoState
          live
          className={
            encryptedAndReadable
              ? "text-gray-1000"
              : unlocking
                ? "text-gray-700"
                : "text-red-900"
          }
        >
          {encryptedAndReadable
            ? t(
                "settings.privacy.data.historyStorage.encrypted",
                "Encrypted at rest",
              )
            : unlocking
              ? t("settings.privacy.data.historyStorage.unlocking", "Unlocking")
              : status.encrypted
                ? t("settings.privacy.data.historyStorage.locked", "Locked")
                : t(
                    "settings.privacy.data.historyStorage.plaintext",
                    "Not encrypted",
                  )}
        </MonoState>
      </SettingsRow>
      {reason === null ? null : (
        <div className="px-4 py-2.5">
          <Notice tone="danger">{reason}</Notice>
        </div>
      )}
    </>
  );
};
