import React, { useMemo, useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type PostProcessProvider,
  type PostProcessProviderConsent,
} from "@/bindings";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { SettingContainer } from "../../ui/SettingContainer";

interface RemoteProviderConsentProps {
  provider: PostProcessProvider | undefined;
  consent: PostProcessProviderConsent | undefined;
  endpointChanged: boolean;
  onAccepted: () => Promise<void>;
}

type EndpointState =
  | { kind: "local" }
  | { kind: "invalid" }
  | { kind: "remote"; endpoint: string };

const endpointStateForProvider = (
  provider: PostProcessProvider,
): EndpointState => {
  try {
    const endpoint = new URL(provider.base_url.trim());
    const isLoopback =
      endpoint.hostname === "localhost" ||
      endpoint.hostname === "127.0.0.1" ||
      endpoint.hostname === "::1";

    if (provider.id === "apple_intelligence" || isLoopback) {
      return { kind: "local" };
    }

    if (endpoint.protocol !== "https:") {
      return { kind: "invalid" };
    }

    endpoint.username = "";
    endpoint.password = "";
    endpoint.search = "";
    endpoint.hash = "";
    endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");

    return {
      kind: "remote",
      endpoint: endpoint.toString().replace(/\/$/, ""),
    };
  } catch {
    return { kind: "invalid" };
  }
};

interface RemoteProviderConsentContentProps {
  provider: PostProcessProvider;
  consent: PostProcessProviderConsent | undefined;
  endpoint: string;
  endpointChanged: boolean;
  onAccepted: () => Promise<void>;
}

const RemoteProviderConsentContent: React.FC<
  RemoteProviderConsentContentProps
> = ({ provider, consent, endpoint, endpointChanged, onAccepted }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const currentConsent =
    consent?.endpoint === endpoint && consent.text_transfer_consent;

  const accept = async () => {
    if (!acknowledged || saving) {
      return;
    }

    setSaving(true);
    setErrorKey(null);
    try {
      const result = await commands.acceptPostProcessProviderConsent(
        provider.id,
      );
      if (result.status === "error") {
        if (result.error === "invalid_destination") {
          setErrorKey(
            "settings.postProcessing.remoteConsent.invalidDestination",
          );
        } else {
          setErrorKey("settings.postProcessing.remoteConsent.saveFailed");
        }
        return;
      }

      await onAccepted();
      setOpen(false);
    } catch {
      setErrorKey("settings.postProcessing.remoteConsent.saveFailed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingContainer
        title={t("settings.postProcessing.remoteConsent.title")}
        description={
          currentConsent
            ? t("settings.postProcessing.remoteConsent.current", { endpoint })
            : t("settings.postProcessing.remoteConsent.description", {
                provider: provider.label,
                endpoint,
              })
        }
        descriptionMode="inline"
        layout="horizontal"
        grouped
      >
        <Button
          type="button"
          variant={currentConsent ? "secondary" : "primary"}
          size="sm"
          className="gap-1.5 whitespace-nowrap"
          onClick={() => setOpen(true)}
        >
          <ShieldCheck size={14} aria-hidden="true" />
          {currentConsent
            ? t("settings.postProcessing.remoteConsent.review")
            : t("settings.postProcessing.remoteConsent.acknowledge")}
        </Button>
      </SettingContainer>
      {endpointChanged && !currentConsent ? (
        <Alert variant="warning" contained>
          {t("settings.postProcessing.remoteConsent.endpointChanged")}
        </Alert>
      ) : null}
      <Dialog
        open={open}
        title={t("settings.postProcessing.remoteConsent.title")}
        description={t("settings.postProcessing.remoteConsent.description", {
          provider: provider.label,
          endpoint,
        })}
        closeLabel={t("settings.postProcessing.remoteConsent.cancel")}
        onOpenChange={setOpen}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              {t("settings.postProcessing.remoteConsent.cancel")}
            </Button>
            <Button
              type="button"
              onClick={accept}
              disabled={!acknowledged || saving || currentConsent}
            >
              {saving
                ? t("common.saving")
                : t("settings.postProcessing.remoteConsent.accept")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            {t("settings.postProcessing.remoteConsent.endpointLabel")}
          </p>
          <code className="block break-all rounded-md border border-border bg-subtle px-3 py-2 text-xs text-text-primary">
            {endpoint}
          </code>
          <label className="meeting-choice-row">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              disabled={saving || currentConsent}
            />
            <span>
              {t("settings.postProcessing.remoteConsent.acknowledge")}
            </span>
          </label>
          {errorKey ? (
            <Alert variant="error" contained>
              {t(errorKey)}
            </Alert>
          ) : null}
          <p className="flex items-center gap-1 text-xs text-text-secondary">
            <ExternalLink size={12} aria-hidden="true" />
            {t("settings.postProcessing.remoteConsent.destinationPinned")}
          </p>
        </div>
      </Dialog>
    </>
  );
};

export const RemoteProviderConsent: React.FC<RemoteProviderConsentProps> = ({
  provider,
  consent,
  endpointChanged,
  onAccepted,
}) => {
  const { t } = useTranslation();
  const endpointState = useMemo(
    () => (provider ? endpointStateForProvider(provider) : null),
    [provider],
  );

  if (!provider || endpointState === null || endpointState.kind === "local") {
    return null;
  }

  if (endpointState.kind === "invalid") {
    return (
      <Alert variant="error" contained>
        {t("settings.postProcessing.remoteConsent.invalidDestination")}
      </Alert>
    );
  }

  return (
    <RemoteProviderConsentContent
      key={provider.id + ":" + endpointState.endpoint}
      provider={provider}
      consent={consent}
      endpoint={endpointState.endpoint}
      endpointChanged={endpointChanged}
      onAccepted={onAccepted}
    />
  );
};
