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
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import { Notice, SettingsField } from "@/components/settings/rows";

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
  const keyFieldId = `cloud-stt-key-${provider.secretAccountId}`;

  return (
    <SettingsField label={t(provider.labelKey)} controlId={keyFieldId}>
      <div className="flex flex-col gap-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveSecret();
          }}
        >
          <Input
            id={keyFieldId}
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={t("settings.models.cloud.apiKey.placeholder")}
            /* No `aria-label`: the field's own label names it. One that said
             * "API key" would override that label, and both providers' inputs
             * would then answer to the same name with nothing to tell them
             * apart. The placeholder still says what to paste. */
            disabled={actionPending}
            className="h-8 min-w-0 flex-1"
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
          {keySaved && !checking && consentCurrent && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void verifySecret()}
              disabled={actionPending}
            >
              {pendingAction === "verify"
                ? t("settings.models.cloud.actions.verifying")
                : t("settings.models.cloud.actions.verify")}
            </Button>
          )}
          {keySaved && !checking && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-red-900 hover:text-red-900"
              onClick={() => void removeSecret()}
              disabled={actionPending}
            >
              {pendingAction === "remove"
                ? t("settings.models.cloud.actions.removing")
                : t("settings.models.cloud.actions.remove")}
            </Button>
          )}
        </form>

        <Notice>
          {checking
            ? t("settings.models.cloud.status.checking")
            : !keySaved
              ? t("settings.models.cloud.status.notSaved")
              : verified
                ? t("settings.models.cloud.status.verified")
                : t("settings.models.cloud.status.saved")}
        </Notice>

        {keySaved && !checking && !consentCurrent && (
          <Notice tone="warning" live={false}>
            {t("settings.models.cloud.status.verifyRequiresConsent")}
          </Notice>
        )}

        {displayedError && (
          <Notice tone="danger" assertive>
            {t("settings.models.cloud.errors." + displayedError)}
          </Notice>
        )}
      </div>
    </SettingsField>
  );
};

/* Every cloud ASR route's key, as a bare row group.
 *
 * No section of its own: Advanced puts this behind a disclosure whose summary
 * already reads "Cloud transcription keys", and a heading inside it would say
 * the same thing a second time. */
export const CloudSttProviderSettings: React.FC = () => {
  const { t } = useTranslation();
  const { refreshSettings, settings } = useSettings();

  return (
    <>
      {/* Where the keys live is the one thing a reader cannot infer from a
       * password field, and it is true of every provider — so it is said once,
       * for the group, rather than once per provider. */}
      <div className="px-6 py-3">
        <Notice live={false}>
          {t("settings.models.cloud.providerDescription")}
        </Notice>
      </div>
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
    </>
  );
};
