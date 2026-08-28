import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type CloudPairingOffer,
  type CloudSyncOverview,
} from "@/bindings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import {
  type CloudUiError,
  parseCloudPairingOffer,
  useCloudSyncOverview,
} from "./cloudSync";

type PendingAction =
  | "bootstrap"
  | "recover"
  | "offer"
  | "approve"
  | "accept"
  | "pause"
  | null;

type AccountStatus =
  | "loading"
  | "attention"
  | "paused"
  | "ready"
  | "unavailable"
  | "local";

const getAccountStatus = (
  overview: CloudSyncOverview | null,
  loading: boolean,
  error: CloudUiError | null,
): AccountStatus => {
  if (loading) return "loading";
  if (overview?.terminal_error) return "attention";
  if (overview?.enabled) return overview.paused ? "paused" : "ready";
  return error ? "unavailable" : "local";
};

const useCloudSyncPanel = () => {
  const {
    value: overview,
    error: overviewError,
    loading,
    refresh,
  } = useCloudSyncOverview();
  const [endpoint, setEndpoint] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [vaultId, setVaultId] = useState("");
  const [offer, setOffer] = useState<CloudPairingOffer | null>(null);
  const [receivedOffer, setReceivedOffer] = useState("");
  const [pending, setPending] = useState<PendingAction>(null);
  const [commandError, setCommandError] = useState<CloudUiError | null>(null);
  const error = commandError ?? overviewError;

  const bootstrap = async () => {
    if (pending || endpoint.trim() === "" || bootstrapSecret === "") return;
    setPending("bootstrap");
    setCommandError(null);
    try {
      const result = await commands.cloudSyncBootstrap({
        endpoint: endpoint.trim(),
        bootstrap_secret: bootstrapSecret,
      });
      if (result.status === "error") {
        setCommandError(result.error);
        return;
      }
      setBootstrapSecret("");
      setRecoveryCode(result.data.recovery_code);
      await refresh();
    } catch {
      setCommandError("unexpected");
    } finally {
      setPending(null);
    }
  };

  const recover = async () => {
    if (pending || endpoint.trim() === "" || recoveryInput === "") return;
    setPending("recover");
    setCommandError(null);
    try {
      const result = await commands.cloudSyncRecover({
        endpoint: endpoint.trim(),
        recovery_code: recoveryInput,
      });
      if (result.status === "error") {
        setCommandError(result.error);
        return;
      }
      setRecoveryInput("");
      await refresh();
    } catch {
      setCommandError("unexpected");
    } finally {
      setPending(null);
    }
  };

  const createOffer = async () => {
    if (pending || endpoint.trim() === "" || vaultId.trim() === "") return;
    setPending("offer");
    setCommandError(null);
    try {
      const result = await commands.cloudSyncPairingOffer({
        endpoint: endpoint.trim(),
        vault_id: vaultId.trim(),
      });
      if (result.status === "error") {
        setCommandError(result.error);
        return;
      }
      setOffer(result.data);
    } catch {
      setCommandError("unexpected");
    } finally {
      setPending(null);
    }
  };

  const approveOffer = async () => {
    if (pending || !offer) return;
    setPending("approve");
    setCommandError(null);
    try {
      const result = await commands.cloudSyncPairingApprove({ offer });
      if (result.status === "error") {
        setCommandError(result.error);
        return;
      }
      await refresh();
    } catch {
      setCommandError("unexpected");
    } finally {
      setPending(null);
    }
  };

  const acceptOffer = async () => {
    if (pending || endpoint.trim() === "") return;
    const parsedOffer = parseCloudPairingOffer(receivedOffer);
    if (!parsedOffer) {
      setCommandError("invalid_offer");
      return;
    }
    setPending("accept");
    setCommandError(null);
    try {
      const result = await commands.cloudSyncPairingAccept({
        endpoint: endpoint.trim(),
        offer: parsedOffer,
      });
      if (result.status === "error") {
        setCommandError(result.error);
        return;
      }
      setReceivedOffer("");
      await refresh();
    } catch {
      setCommandError("unexpected");
    } finally {
      setPending(null);
    }
  };

  const togglePaused = async () => {
    if (pending || !overview?.enabled) return;
    setPending("pause");
    setCommandError(null);
    try {
      const result = overview.paused
        ? await commands.cloudSyncResume()
        : await commands.cloudSyncPause();
      if (result.status === "error") {
        setCommandError(result.error);
        return;
      }
      await refresh();
    } catch {
      setCommandError("unexpected");
    } finally {
      setPending(null);
    }
  };

  return {
    overview,
    loading,
    error,
    endpoint,
    setEndpoint,
    bootstrapSecret,
    setBootstrapSecret,
    recoveryInput,
    setRecoveryInput,
    recoveryCode,
    vaultId,
    setVaultId,
    offer,
    receivedOffer,
    setReceivedOffer,
    pending,
    bootstrap,
    recover,
    createOffer,
    approveOffer,
    acceptOffer,
    togglePaused,
  };
};

interface CloudSyncSetupSectionProps {
  id: string;
  endpoint: string;
  onEndpointChange: (value: string) => void;
  bootstrapSecret: string;
  onBootstrapSecretChange: (value: string) => void;
  pending: PendingAction;
  onBootstrap: () => void;
}

const CloudSyncSetupSection: React.FC<CloudSyncSetupSectionProps> = ({
  id,
  endpoint,
  onEndpointChange,
  bootstrapSecret,
  onBootstrapSecretChange,
  pending,
  onBootstrap,
}) => {
  const { t } = useTranslation();

  return (
    <section className="space-y-2" aria-labelledby={id}>
      <h3 id={id} className="text-sm font-medium text-text-primary">
        {t("cloudSync.setup.title")}
      </h3>
      <label className="block space-y-1 text-xs font-medium text-text-secondary">
        <span>{t("cloudSync.setup.endpoint")}</span>
        <Input
          type="url"
          value={endpoint}
          onChange={(event) => onEndpointChange(event.target.value)}
          autoComplete="url"
        />
      </label>
      <label className="block space-y-1 text-xs font-medium text-text-secondary">
        <span>{t("cloudSync.setup.bootstrapSecret")}</span>
        <Input
          type="password"
          value={bootstrapSecret}
          onChange={(event) => onBootstrapSecretChange(event.target.value)}
          autoComplete="off"
        />
      </label>
      <Button
        type="button"
        size="sm"
        disabled={
          pending !== null || endpoint.trim() === "" || bootstrapSecret === ""
        }
        onClick={onBootstrap}
      >
        {t("cloudSync.setup.submit")}
      </Button>
    </section>
  );
};

interface CloudSyncRecoverySectionProps {
  id: string;
  recoveryCode: string | null;
  recoveryInput: string;
  onRecoveryInputChange: (value: string) => void;
  endpoint: string;
  pending: PendingAction;
  onRecover: () => void;
}

const CloudSyncRecoverySection: React.FC<CloudSyncRecoverySectionProps> = ({
  id,
  recoveryCode,
  recoveryInput,
  onRecoveryInputChange,
  endpoint,
  pending,
  onRecover,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {recoveryCode ? (
        <section
          className="rounded-[var(--radius-control)] border border-border p-3"
          aria-live="polite"
        >
          <h3 className="text-sm font-medium text-text-primary">
            {t("cloudSync.recovery.generatedCode")}
          </h3>
          <code className="mt-2 block break-all text-xs text-text-primary">
            {recoveryCode}
          </code>
          <p className="mt-2 text-xs leading-4 text-text-secondary">
            {t("cloudSync.recovery.oneTime")}
          </p>
        </section>
      ) : null}
      <section className="space-y-2" aria-labelledby={id}>
        <h3 id={id} className="text-sm font-medium text-text-primary">
          {t("cloudSync.recovery.title")}
        </h3>
        <label className="block space-y-1 text-xs font-medium text-text-secondary">
          <span>{t("cloudSync.recovery.code")}</span>
          <Input
            type="password"
            value={recoveryInput}
            onChange={(event) => onRecoveryInputChange(event.target.value)}
            autoComplete="off"
          />
        </label>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={
            pending !== null || endpoint.trim() === "" || recoveryInput === ""
          }
          onClick={onRecover}
        >
          {t("cloudSync.recovery.submit")}
        </Button>
      </section>
    </>
  );
};

interface CloudSyncPairingSectionProps {
  id: string;
  endpoint: string;
  vaultId: string;
  onVaultIdChange: (value: string) => void;
  offer: CloudPairingOffer | null;
  receivedOffer: string;
  onReceivedOfferChange: (value: string) => void;
  pending: PendingAction;
  onCreateOffer: () => void;
  onApproveOffer: () => void;
  onAcceptOffer: () => void;
}

const CloudSyncPairingSection: React.FC<CloudSyncPairingSectionProps> = ({
  id,
  endpoint,
  vaultId,
  onVaultIdChange,
  offer,
  receivedOffer,
  onReceivedOfferChange,
  pending,
  onCreateOffer,
  onApproveOffer,
  onAcceptOffer,
}) => {
  const { t } = useTranslation();

  return (
    <section className="space-y-2" aria-labelledby={id}>
      <h3 id={id} className="text-sm font-medium text-text-primary">
        {t("cloudSync.pairing.title")}
      </h3>
      <label className="block space-y-1 text-xs font-medium text-text-secondary">
        <span>{t("cloudSync.pairing.vaultId")}</span>
        <Input
          value={vaultId}
          onChange={(event) => onVaultIdChange(event.target.value)}
          autoComplete="off"
        />
      </label>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={
          pending !== null || endpoint.trim() === "" || vaultId.trim() === ""
        }
        onClick={onCreateOffer}
      >
        {t("cloudSync.pairing.createOffer")}
      </Button>
      {offer ? (
        <div className="space-y-2">
          <label className="block space-y-1 text-xs font-medium text-text-secondary">
            <span>{t("cloudSync.pairing.currentOffer")}</span>
            <Textarea
              value={JSON.stringify(offer)}
              readOnly
              variant="compact"
              aria-readonly="true"
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending !== null}
            onClick={onApproveOffer}
          >
            {t("cloudSync.pairing.approve")}
          </Button>
        </div>
      ) : null}
      <label className="block space-y-1 text-xs font-medium text-text-secondary">
        <span>{t("cloudSync.pairing.receivedOffer")}</span>
        <Textarea
          value={receivedOffer}
          onChange={(event) => onReceivedOfferChange(event.target.value)}
          variant="compact"
        />
      </label>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={
          pending !== null ||
          endpoint.trim() === "" ||
          receivedOffer.trim() === ""
        }
        onClick={onAcceptOffer}
      >
        {t("cloudSync.pairing.accept")}
      </Button>
    </section>
  );
};

export const CloudSyncPanel: React.FC = () => {
  const { t } = useTranslation();
  const id = useId();
  const cloud = useCloudSyncPanel();
  const accountStatus = getAccountStatus(
    cloud.overview,
    cloud.loading,
    cloud.error,
  );

  return (
    <details className="settings-disclosure cloud-sync-panel">
      <summary>
        <span>{t("cloudSync.account.title")}</span>
        <span className="flex items-center gap-2 text-xs text-text-secondary">
          <span role="status">
            {t("cloudSync.account.status." + accountStatus)}
          </span>
          {cloud.overview?.enabled && cloud.overview.queued_objects > 0 ? (
            <span className="tabular-nums text-text-tertiary">
              {t("cloudSync.account.pending", {
                count: cloud.overview.queued_objects,
              })}
            </span>
          ) : null}
        </span>
      </summary>
      <div className="settings-disclosure-body space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs leading-4 text-text-secondary">
            {t("cloudSync.disclosure.notice")}
          </p>
          {cloud.overview?.enabled ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={cloud.pending !== null}
              onClick={() => void cloud.togglePaused()}
            >
              {t(
                cloud.overview.paused
                  ? "cloudSync.account.resume"
                  : "cloudSync.account.pause",
              )}
            </Button>
          ) : null}
        </div>
        <CloudSyncSetupSection
          id={id + "-setup"}
          endpoint={cloud.endpoint}
          onEndpointChange={cloud.setEndpoint}
          bootstrapSecret={cloud.bootstrapSecret}
          onBootstrapSecretChange={cloud.setBootstrapSecret}
          pending={cloud.pending}
          onBootstrap={() => void cloud.bootstrap()}
        />
        <CloudSyncRecoverySection
          id={id + "-recover"}
          recoveryCode={cloud.recoveryCode}
          recoveryInput={cloud.recoveryInput}
          onRecoveryInputChange={cloud.setRecoveryInput}
          endpoint={cloud.endpoint}
          pending={cloud.pending}
          onRecover={() => void cloud.recover()}
        />
        <CloudSyncPairingSection
          id={id + "-pair"}
          endpoint={cloud.endpoint}
          vaultId={cloud.vaultId}
          onVaultIdChange={cloud.setVaultId}
          offer={cloud.offer}
          receivedOffer={cloud.receivedOffer}
          onReceivedOfferChange={cloud.setReceivedOffer}
          pending={cloud.pending}
          onCreateOffer={() => void cloud.createOffer()}
          onApproveOffer={() => void cloud.approveOffer()}
          onAcceptOffer={() => void cloud.acceptOffer()}
        />
        {cloud.error ? (
          <p className="text-xs text-danger" role="alert">
            {t("cloudSync.errors." + cloud.error)}
          </p>
        ) : null}
      </div>
    </details>
  );
};
