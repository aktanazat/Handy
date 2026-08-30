import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type CloudPairingOffer,
  type CloudSyncOverview,
} from "@/bindings";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import { Textarea } from "@/components/vg/textarea";
import {
  Microlabel,
  Notice,
  SettingsField,
  SettingsSection,
} from "@/components/settings/rows";
import { CloudDisclosure } from "./CloudDisclosure";
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

/* The state a reader checks before deciding whether anything here needs them.
 * Colour follows the reason; the word is always present. */
const ACCOUNT_STATUS_CLASSES = {
  loading: "text-gray-700",
  attention: "text-red-900",
  unavailable: "text-red-900",
  paused: "text-amber-900",
  ready: "text-gray-1000",
  local: "text-gray-800",
} satisfies Record<AccountStatus, string>;

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

/** The action a task's fields lead up to, on its own hairline-separated row. */
const TaskAction: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex justify-end px-4 py-2.5">{children}</div>
);

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
    <CloudDisclosure label={t("cloudSync.setup.title")}>
      <SettingsField
        label={t("cloudSync.setup.endpoint")}
        controlId={id + "-endpoint"}
      >
        <Input
          id={id + "-endpoint"}
          type="url"
          value={endpoint}
          onChange={(event) => onEndpointChange(event.target.value)}
          autoComplete="url"
        />
      </SettingsField>
      <SettingsField
        label={t("cloudSync.setup.bootstrapSecret")}
        controlId={id + "-secret"}
      >
        <Input
          id={id + "-secret"}
          type="password"
          value={bootstrapSecret}
          onChange={(event) => onBootstrapSecretChange(event.target.value)}
          autoComplete="off"
        />
      </SettingsField>
      <TaskAction>
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
      </TaskAction>
    </CloudDisclosure>
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
      {/* Shown once and never again, so it cannot live behind a disclosure:
       * the row states the code, and the one sentence that earns its place
       * says why there is no second chance. */}
      {recoveryCode ? (
        <SettingsField label={t("cloudSync.recovery.generatedCode")}>
          <div aria-live="polite">
            <code className="block font-mono text-xs break-all text-gray-1000">
              {recoveryCode}
            </code>
            <Notice tone="warning" className="mt-2">
              {t("cloudSync.recovery.oneTime")}
            </Notice>
          </div>
        </SettingsField>
      ) : null}
      <CloudDisclosure label={t("cloudSync.recovery.title")}>
        <SettingsField
          label={t("cloudSync.recovery.code")}
          controlId={id + "-code"}
        >
          <Input
            id={id + "-code"}
            type="password"
            value={recoveryInput}
            onChange={(event) => onRecoveryInputChange(event.target.value)}
            autoComplete="off"
          />
        </SettingsField>
        <TaskAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              pending !== null || endpoint.trim() === "" || recoveryInput === ""
            }
            onClick={onRecover}
          >
            {t("cloudSync.recovery.submit")}
          </Button>
        </TaskAction>
      </CloudDisclosure>
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
    <CloudDisclosure label={t("cloudSync.pairing.title")}>
      <SettingsField
        label={t("cloudSync.pairing.vaultId")}
        controlId={id + "-vault"}
      >
        <Input
          id={id + "-vault"}
          value={vaultId}
          onChange={(event) => onVaultIdChange(event.target.value)}
          autoComplete="off"
        />
      </SettingsField>
      <TaskAction>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            pending !== null || endpoint.trim() === "" || vaultId.trim() === ""
          }
          onClick={onCreateOffer}
        >
          {t("cloudSync.pairing.createOffer")}
        </Button>
      </TaskAction>
      {offer ? (
        <>
          <SettingsField
            label={t("cloudSync.pairing.currentOffer")}
            controlId={id + "-offer"}
          >
            <Textarea
              id={id + "-offer"}
              value={JSON.stringify(offer)}
              readOnly
              aria-readonly="true"
              className="font-mono text-xs"
            />
          </SettingsField>
          <TaskAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending !== null}
              onClick={onApproveOffer}
            >
              {t("cloudSync.pairing.approve")}
            </Button>
          </TaskAction>
        </>
      ) : null}
      <SettingsField
        label={t("cloudSync.pairing.receivedOffer")}
        controlId={id + "-received"}
      >
        <Textarea
          id={id + "-received"}
          value={receivedOffer}
          onChange={(event) => onReceivedOfferChange(event.target.value)}
          className="font-mono text-xs"
        />
      </SettingsField>
      <TaskAction>
        <Button
          type="button"
          variant="outline"
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
      </TaskAction>
    </CloudDisclosure>
  );
};

/* Setup, recovery and pairing are one-time tasks, so each is a row until it is
 * needed. The section's own line carries the only thing a reader checks on the
 * way past: whether anything is syncing, and whether it is stuck. */
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
    <SettingsSection
      label={t("cloudSync.account.title")}
      action={
        <div className="flex items-center gap-3">
          <span role="status">
            <Microlabel className={ACCOUNT_STATUS_CLASSES[accountStatus]}>
              {t("cloudSync.account.status." + accountStatus)}
            </Microlabel>
          </span>
          {cloud.overview?.enabled && cloud.overview.queued_objects > 0 ? (
            <Microlabel className="tabular-nums">
              {t("cloudSync.account.pending", {
                count: cloud.overview.queued_objects,
              })}
            </Microlabel>
          ) : null}
          {cloud.overview?.enabled ? (
            <Button
              type="button"
              variant="outline"
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
      }
    >
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
        <div className="px-4 py-2.5">
          <Notice tone="danger" live={false}>
            <span role="alert">{t("cloudSync.errors." + cloud.error)}</span>
          </Notice>
        </div>
      ) : null}
    </SettingsSection>
  );
};
