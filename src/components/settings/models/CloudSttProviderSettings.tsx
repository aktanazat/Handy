import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type SecretCommandError,
  type SecretState,
  type SttSecretVerificationError,
} from "@/bindings";
import {
  CLOUD_STT_PROVIDERS,
  cloudSttProviderHasCurrentConsent,
  type CloudSttProviderMetadata,
} from "@/lib/cloudStt";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { SettingContainer } from "../../ui/SettingContainer";
import { SettingsGroup } from "../../ui/SettingsGroup";

type CloudProviderError =
  | SecretCommandError
  | SttSecretVerificationError
  | "unknown_provider";
type PendingAction = "save" | "remove" | "verify" | null;

interface CloudSttProviderCardProps {
  provider: CloudSttProviderMetadata;
  consentCurrent: boolean;
  onProviderChanged: () => Promise<void>;
}

const CloudSttProviderCard: React.FC<CloudSttProviderCardProps> = ({
  provider,
  consentCurrent,
  onProviderChanged,
}) => {
  const { t } = useTranslation();
  const [secret, setSecret] = useState("");
  const [secretState, setSecretState] = useState<SecretState | null>(null);
  const [checking, setChecking] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<CloudProviderError | null>(null);

  const refreshSecretState = useCallback(async () => {
    setChecking(true);
    try {
      const result = await commands.getProviderSecretState(
        "stt",
        provider.secretAccountId,
      );
      if (result.status === "ok") {
        setSecretState(result.data);
        setError(null);
      } else {
        setSecretState(null);
        setError(result.error);
      }
    } catch {
      setSecretState(null);
      setError("backend");
    } finally {
      setChecking(false);
    }
  }, [provider.secretAccountId]);

  useEffect(() => {
    void refreshSecretState();
  }, [refreshSecretState]);

  const saveSecret = async () => {
    const nextSecret = secret.trim();
    if (!nextSecret) return;

    setSecret("");
    setPendingAction("save");
    setError(null);
    try {
      const result = await commands.setProviderSecret(
        "stt",
        provider.secretAccountId,
        nextSecret,
      );
      if (result.status === "ok") {
        setSecretState(result.data);
        await onProviderChanged();
      } else {
        setError(result.error);
      }
    } catch {
      setError("backend");
    } finally {
      setPendingAction(null);
    }
  };

  const removeSecret = async () => {
    setPendingAction("remove");
    setError(null);
    try {
      const result = await commands.deleteProviderSecret(
        "stt",
        provider.secretAccountId,
      );
      if (result.status === "ok") {
        setSecretState(result.data);
        await onProviderChanged();
      } else {
        setError(result.error);
      }
    } catch {
      setError("backend");
    } finally {
      setPendingAction(null);
    }
  };

  const verifySecret = async () => {
    setPendingAction("verify");
    setError(null);
    try {
      const result = await commands.verifySttProviderSecret(provider.provider);
      if (result.status === "ok") {
        setSecretState(result.data);
        await onProviderChanged();
      } else {
        setError(result.error);
      }
    } catch {
      setError("backend");
    } finally {
      setPendingAction(null);
    }
  };

  const keySaved = secretState?.configured === true;
  const verified = keySaved && secretState?.lastVerifiedAt !== null;
  const actionPending = pendingAction !== null;
  const displayedError = error ?? secretState?.lastErrorKind ?? null;

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="px-4 pb-2 pt-4">
        <h3 className="text-sm font-medium text-text-primary">
          {t(provider.labelKey)}
        </h3>
        <p className="mt-1 text-[13px] leading-[18px] text-text-secondary">
          {t("settings.models.cloud.providerDescription")}
        </p>
      </div>

      <SettingContainer
        grouped
        layout="stacked"
        title={t("settings.models.cloud.apiKey.label")}
        description={t("settings.models.cloud.apiKey.description")}
      >
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveSecret();
          }}
        >
          <Input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={t("settings.models.cloud.apiKey.placeholder")}
            aria-label={t("settings.models.cloud.apiKey.label")}
            disabled={actionPending}
            className="min-w-0 flex-1"
          />
          <Button
            type="submit"
            size="sm"
            disabled={actionPending || secret.trim() === ""}
          >
            {pendingAction === "save"
              ? t("settings.models.cloud.actions.saving")
              : t("settings.models.cloud.actions.save")}
          </Button>
        </form>
      </SettingContainer>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 pt-1">
        <div aria-live="polite" className="text-xs text-text-secondary">
          {checking
            ? t("settings.models.cloud.status.checking")
            : !keySaved
              ? t("settings.models.cloud.status.notSaved")
              : verified
                ? t("settings.models.cloud.status.verified")
                : t("settings.models.cloud.status.saved")}
        </div>
        {keySaved && !checking && (
          <div className="flex flex-wrap items-center gap-2">
            {consentCurrent ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void verifySecret()}
                disabled={actionPending}
              >
                {pendingAction === "verify"
                  ? t("settings.models.cloud.actions.verifying")
                  : t("settings.models.cloud.actions.verify")}
              </Button>
            ) : (
              <span className="text-xs text-text-tertiary">
                {t("settings.models.cloud.status.verifyRequiresConsent")}
              </span>
            )}
            <Button
              type="button"
              variant="danger-ghost"
              size="sm"
              onClick={() => void removeSecret()}
              disabled={actionPending}
            >
              {pendingAction === "remove"
                ? t("settings.models.cloud.actions.removing")
                : t("settings.models.cloud.actions.remove")}
            </Button>
          </div>
        )}
      </div>

      {displayedError && (
        <p role="alert" className="px-4 pb-4 text-sm text-danger">
          {t("settings.models.cloud.errors." + displayedError)}
        </p>
      )}
    </div>
  );
};

export const CloudSttProviderSettings: React.FC = () => {
  const { t } = useTranslation();
  const { refreshSettings, settings } = useSettings();

  return (
    <SettingsGroup
      title={t("settings.models.cloud.title")}
      description={t("settings.models.cloud.description")}
    >
      {CLOUD_STT_PROVIDERS.map((provider) => (
        <CloudSttProviderCard
          key={provider.provider}
          provider={provider}
          consentCurrent={cloudSttProviderHasCurrentConsent(
            settings?.cloud_stt_providers,
            provider.provider,
          )}
          onProviderChanged={refreshSettings}
        />
      ))}
    </SettingsGroup>
  );
};
