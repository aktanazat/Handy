import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  commands,
  type CloudBrowserShareResult,
  type CloudConflictChoice,
  type CloudMeetingStatus,
  type CloudShareResult,
  type MeetingSessionId,
} from "@/bindings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  defaultCloudShareExpiry,
  isRetryableCloudState,
  toCloudShareExpiryUtcMs,
  type CloudUiError,
  useCloudMeetingStatus,
} from "./cloudSync";

type PendingAction =
  | "retry"
  | "keep_local"
  | "use_remote"
  | "bundle"
  | "import"
  | "browser"
  | "revoke"
  | null;

interface CloudMeetingActionsProps {
  sessionId: MeetingSessionId;
}

const useCloudMeetingActions = (
  sessionId: MeetingSessionId,
  fileFilter: string,
) => {
  const {
    value: status,
    error: statusError,
    loading,
    refresh,
  } = useCloudMeetingStatus(sessionId);
  const [expiry, setExpiry] = useState(defaultCloudShareExpiry);
  const [pending, setPending] = useState<PendingAction>(null);
  const [commandError, setCommandError] = useState<CloudUiError | null>(null);
  const [bundle, setBundle] = useState<CloudShareResult | null>(null);
  const [browserShare, setBrowserShare] =
    useState<CloudBrowserShareResult | null>(null);
  const [importedSessionId, setImportedSessionId] =
    useState<MeetingSessionId | null>(null);
  const error = commandError ?? statusError;

  const resolveExpiry = (): number | null => {
    const expiresAtUtcMs = toCloudShareExpiryUtcMs(expiry);
    if (!expiresAtUtcMs) setCommandError("invalid_expiry");
    return expiresAtUtcMs;
  };

  const retry = async () => {
    if (pending) return;
    setPending("retry");
    setCommandError(null);
    try {
      const result = await commands.cloudSyncRetry(sessionId);
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

  const resolveConflict = async (choice: CloudConflictChoice) => {
    if (pending) return;
    setPending(choice);
    setCommandError(null);
    try {
      const result = await commands.cloudSyncConflictResolve({
        session_id: sessionId,
        choice,
      });
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

  const exportBundle = async () => {
    if (pending) return;
    const expiresAtUtcMs = resolveExpiry();
    if (!expiresAtUtcMs) return;

    try {
      const destinationPath = await save({
        defaultPath: "meeting.sona",
        filters: [{ name: fileFilter, extensions: ["sona"] }],
      });
      if (!destinationPath) return;
      setPending("bundle");
      setCommandError(null);
      const result = await commands.cloudShareCreate({
        session_id: sessionId,
        expires_at_utc_ms: expiresAtUtcMs,
        destination_path: destinationPath,
      });
      if (result.status === "error") {
        setCommandError(result.error);
        return;
      }
      setBundle(result.data);
      await refresh();
    } catch {
      setCommandError("unexpected");
    } finally {
      setPending(null);
    }
  };

  const importBundle = async () => {
    if (pending) return;
    try {
      const selectedPath = await open({
        directory: false,
        multiple: false,
        filters: [{ name: fileFilter, extensions: ["sona"] }],
      });
      if (selectedPath === null || Array.isArray(selectedPath)) return;
      setPending("import");
      setCommandError(null);
      const result = await commands.cloudShareImportFile({
        path: selectedPath,
      });
      if (result.status === "error") {
        setCommandError(result.error);
        return;
      }
      setImportedSessionId(result.data.session_id);
      await refresh();
    } catch {
      setCommandError("unexpected");
    } finally {
      setPending(null);
    }
  };

  const createBrowserShare = async () => {
    if (pending) return;
    const expiresAtUtcMs = resolveExpiry();
    if (!expiresAtUtcMs) return;
    setPending("browser");
    setCommandError(null);
    try {
      const result = await commands.cloudBrowserShareCreate({
        session_id: sessionId,
        expires_at_utc_ms: expiresAtUtcMs,
      });
      if (result.status === "error") {
        setCommandError(result.error);
        return;
      }
      setBrowserShare(result.data);
      await refresh();
    } catch {
      setCommandError("unexpected");
    } finally {
      setPending(null);
    }
  };

  const revokeBrowserShare = async () => {
    if (pending || !browserShare) return;
    setPending("revoke");
    setCommandError(null);
    try {
      const result = await commands.cloudShareRevoke({
        share_id: browserShare.share_id,
      });
      if (result.status === "error") {
        setCommandError(result.error);
        return;
      }
      setBrowserShare(null);
      await refresh();
    } catch {
      setCommandError("unexpected");
    } finally {
      setPending(null);
    }
  };

  return {
    status,
    loading,
    error,
    expiry,
    setExpiry,
    pending,
    bundle,
    browserShare,
    importedSessionId,
    retry,
    resolveConflict,
    exportBundle,
    importBundle,
    createBrowserShare,
    revokeBrowserShare,
  };
};

interface CloudMeetingStatusSectionProps {
  status: CloudMeetingStatus | null;
  pending: PendingAction;
  onRetry: () => void;
  onResolveConflict: (choice: CloudConflictChoice) => void;
}

const CloudMeetingStatusSection: React.FC<CloudMeetingStatusSectionProps> = ({
  status,
  pending,
  onRetry,
  onResolveConflict,
}) => {
  const { t } = useTranslation();

  if (!status) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
        <span>{t("cloudSync.meeting.status." + status.state)}</span>
        <span>
          {t("cloudSync.meeting.shareCount", { count: status.share_count })}
        </span>
        {status.retry_at_utc_ms ? (
          <time dateTime={new Date(status.retry_at_utc_ms).toISOString()}>
            {t("cloudSync.meeting.retryScheduled")}
          </time>
        ) : null}
      </div>
      {isRetryableCloudState(status.state) ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending !== null}
          onClick={onRetry}
        >
          {t("cloudSync.meeting.retry")}
        </Button>
      ) : null}
      {status.state === "conflict" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending !== null}
            onClick={() => onResolveConflict("keep_local")}
          >
            {t("cloudSync.meeting.keepLocal")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending !== null}
            onClick={() => onResolveConflict("use_remote")}
          >
            {t("cloudSync.meeting.useRemote")}
          </Button>
        </div>
      ) : null}
    </>
  );
};

interface CloudMeetingShareSectionProps {
  expiry: string;
  onExpiryChange: (value: string) => void;
  pending: PendingAction;
  bundle: CloudShareResult | null;
  browserShare: CloudBrowserShareResult | null;
  importedSessionId: MeetingSessionId | null;
  onExportBundle: () => void;
  onImportBundle: () => void;
  onCreateBrowserShare: () => void;
  onRevokeBrowserShare: () => void;
}

const CloudMeetingShareSection: React.FC<CloudMeetingShareSectionProps> = ({
  expiry,
  onExpiryChange,
  pending,
  bundle,
  browserShare,
  importedSessionId,
  onExportBundle,
  onImportBundle,
  onCreateBrowserShare,
  onRevokeBrowserShare,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <label className="block space-y-1 text-xs font-medium text-text-secondary">
        <span>{t("cloudSync.meeting.expiresAt")}</span>
        <Input
          type="datetime-local"
          value={expiry}
          onChange={(event) => onExpiryChange(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending !== null}
          onClick={onExportBundle}
        >
          {t("cloudSync.meeting.bundle.export")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending !== null}
          onClick={onImportBundle}
        >
          {t("cloudSync.meeting.bundle.import")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending !== null}
          onClick={onCreateBrowserShare}
        >
          {t("cloudSync.meeting.browser.create")}
        </Button>
      </div>
      {bundle ? (
        <p className="text-xs text-text-secondary" role="status">
          {t("cloudSync.meeting.bundle.exported", { path: bundle.file_path })}
        </p>
      ) : null}
      {importedSessionId ? (
        <p className="text-xs text-text-secondary" role="status">
          {t("cloudSync.meeting.bundle.imported", {
            sessionId: importedSessionId,
          })}
        </p>
      ) : null}
      {browserShare ? (
        <section
          className="space-y-2 rounded-[var(--radius-control)] border border-border p-3"
          aria-live="polite"
        >
          <a
            className="block break-all text-xs text-text-primary underline underline-offset-2"
            href={browserShare.share_url}
            target="_blank"
            rel="noreferrer"
          >
            {browserShare.share_url}
          </a>
          <p className="text-xs leading-4 text-text-secondary">
            {browserShare.trust_disclosure}
          </p>
          <Button
            type="button"
            variant="danger-ghost"
            size="sm"
            disabled={pending !== null}
            onClick={onRevokeBrowserShare}
          >
            {t("cloudSync.meeting.browser.revoke")}
          </Button>
        </section>
      ) : null}
    </>
  );
};

export const CloudMeetingActions: React.FC<CloudMeetingActionsProps> = ({
  sessionId,
}) => {
  const { t } = useTranslation();
  const actions = useCloudMeetingActions(
    sessionId,
    t("cloudSync.meeting.bundle.fileFilter"),
  );
  const statusLabel = actions.loading
    ? "loading"
    : actions.status
      ? actions.status.state
      : actions.error
        ? "unavailable"
        : "local";

  return (
    <details className="settings-disclosure meeting-cloud-sync">
      <summary>
        <span>{t("cloudSync.meeting.title")}</span>
        <span>{t("cloudSync.meeting.status." + statusLabel)}</span>
      </summary>
      <div className="settings-disclosure-body space-y-3">
        <CloudMeetingStatusSection
          status={actions.status}
          pending={actions.pending}
          onRetry={() => void actions.retry()}
          onResolveConflict={(choice) => void actions.resolveConflict(choice)}
        />
        <CloudMeetingShareSection
          expiry={actions.expiry}
          onExpiryChange={actions.setExpiry}
          pending={actions.pending}
          bundle={actions.bundle}
          browserShare={actions.browserShare}
          importedSessionId={actions.importedSessionId}
          onExportBundle={() => void actions.exportBundle()}
          onImportBundle={() => void actions.importBundle()}
          onCreateBrowserShare={() => void actions.createBrowserShare()}
          onRevokeBrowserShare={() => void actions.revokeBrowserShare()}
        />
        {actions.error ? (
          <p className="text-xs text-danger" role="alert">
            {t("cloudSync.errors." + actions.error)}
          </p>
        ) : null}
      </div>
    </details>
  );
};
