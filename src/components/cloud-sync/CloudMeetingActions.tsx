import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  commands,
  type CloudBrowserShareResult,
  type CloudConflictChoice,
  type CloudMeetingStatus,
  type CloudObjectState,
  type CloudShareResult,
  type MeetingSessionId,
} from "@/bindings";
import { Button } from "@/components/vg/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/vg/dialog";
import { Input } from "@/components/vg/input";
import {
  Microlabel,
  Notice,
  SettingsCard,
  SettingsDisclosure,
  SettingsField,
} from "@/components/settings/rows";
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

/* The state word lives on the disclosure summary, so this row carries only
 * what the summary cannot: how many shares exist, whether a retry is already
 * scheduled, and the actions for the state. */
const CloudMeetingStatusSection: React.FC<CloudMeetingStatusSectionProps> = ({
  status,
  pending,
  onRetry,
  onResolveConflict,
}) => {
  const { t } = useTranslation();

  if (!status) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Microlabel className="tabular-nums">
          {t("cloudSync.meeting.shareCount", { count: status.share_count })}
        </Microlabel>
        {status.retry_at_utc_ms ? (
          <time dateTime={new Date(status.retry_at_utc_ms).toISOString()}>
            <Microlabel>{t("cloudSync.meeting.retryScheduled")}</Microlabel>
          </time>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {isRetryableCloudState(status.state) ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending !== null}
            onClick={onRetry}
          >
            {t("cloudSync.meeting.retry")}
          </Button>
        ) : null}
        {status.state === "conflict" ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending !== null}
              onClick={() => onResolveConflict("keep_local")}
            >
              {t("cloudSync.meeting.keepLocal")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending !== null}
              onClick={() => onResolveConflict("use_remote")}
            >
              {t("cloudSync.meeting.useRemote")}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
};

/* Revoking kills a link other people already hold, and nothing in the button
 * says so — the one action here that has to be confirmed. The dialog states
 * the consequence, so the row does not. */
const RevokeShareDialog: React.FC<{
  pending: PendingAction;
  onRevoke: () => void;
}> = ({ pending, onRevoke }) => {
  const { t } = useTranslation();
  /* `confirming`, not `open`: this file imports the native dialog's `open`. */
  const [confirming, setConfirming] = useState(false);

  return (
    <Dialog open={confirming} onOpenChange={setConfirming}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-red-900"
          disabled={pending !== null}
        >
          {t("cloudSync.meeting.browser.revoke")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t("cloudSync.meeting.browser.revoke")}</DialogTitle>
          <DialogDescription>
            {t("cloudSync.meeting.browser.revokeConfirm")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirming(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending !== null}
            onClick={() => {
              setConfirming(false);
              onRevoke();
            }}
          >
            {t("cloudSync.meeting.browser.revoke")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface CloudMeetingShareSectionProps {
  id: string;
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
  id,
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
      <SettingsField
        label={t("cloudSync.meeting.expiresAt")}
        controlId={id + "-expiry"}
      >
        <Input
          id={id + "-expiry"}
          type="datetime-local"
          value={expiry}
          onChange={(event) => onExpiryChange(event.target.value)}
        />
      </SettingsField>
      <div className="flex flex-wrap justify-end gap-2 px-4 py-2.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending !== null}
          onClick={onExportBundle}
        >
          {t("cloudSync.meeting.bundle.export")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending !== null}
          onClick={onImportBundle}
        >
          {t("cloudSync.meeting.bundle.import")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending !== null}
          onClick={onCreateBrowserShare}
        >
          {t("cloudSync.meeting.browser.create")}
        </Button>
      </div>
      {bundle || importedSessionId ? (
        <div className="flex flex-col gap-1.5 px-4 py-2.5">
          {bundle ? (
            <Notice tone="info">
              {t("cloudSync.meeting.bundle.exported", {
                path: bundle.file_path,
              })}
            </Notice>
          ) : null}
          {importedSessionId ? (
            <Notice tone="info">
              {t("cloudSync.meeting.bundle.imported", {
                sessionId: importedSessionId,
              })}
            </Notice>
          ) : null}
        </div>
      ) : null}
      {browserShare ? (
        <div className="flex flex-col gap-2 px-4 py-3" aria-live="polite">
          <a
            className="text-xs break-all text-blue-900 underline underline-offset-2 transition-colors hover:text-gray-1000"
            href={browserShare.share_url}
            target="_blank"
            rel="noreferrer"
          >
            {browserShare.share_url}
          </a>
          <Notice live={false}>{browserShare.trust_disclosure}</Notice>
          <div className="flex justify-end">
            <RevokeShareDialog
              pending={pending}
              onRevoke={onRevokeBrowserShare}
            />
          </div>
        </div>
      ) : null}
    </>
  );
};

/* Closed, the summary is the whole signal, so a state that needs the reader
 * says so in the type. The word is always present; colour never carries the
 * meaning alone. Keyed by every state the row can print — the object states
 * the backend can report plus the row's own loading/unavailable — so a new
 * backend state fails compilation here instead of rendering unclassed. */
const MEETING_STATE_CLASSES = {
  loading: "text-gray-700",
  local: "text-gray-800",
  queued: "text-gray-800",
  uploading: "text-gray-800",
  deleted: "text-gray-800",
  committed: "text-gray-1000",
  paused: "text-amber-900",
  pending_deletion: "text-amber-900",
  conflict: "text-red-900",
  auth_required: "text-red-900",
  quota: "text-red-900",
  integrity_failure: "text-red-900",
  unavailable: "text-red-900",
} satisfies Record<CloudObjectState | "loading" | "unavailable", string>;

/* Sharing a meeting is a task, not a setting, so it stays a single row on the
 * review page until it is asked for — with the sync state on that row, because
 * that is the reason a reader would open it. */
export const CloudMeetingActions: React.FC<CloudMeetingActionsProps> = ({
  sessionId,
}) => {
  const { t } = useTranslation();
  const id = useId();
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
    <SettingsCard className="overflow-hidden">
      <SettingsDisclosure
        label={t("cloudSync.meeting.title")}
        fact={
          <span className={MEETING_STATE_CLASSES[statusLabel]}>
            {t("cloudSync.meeting.status." + statusLabel)}
          </span>
        }
      >
        <CloudMeetingStatusSection
          status={actions.status}
          pending={actions.pending}
          onRetry={() => void actions.retry()}
          onResolveConflict={(choice) => void actions.resolveConflict(choice)}
        />
        <CloudMeetingShareSection
          id={id}
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
          <div className="px-4 py-2.5">
            <Notice tone="danger" live={false}>
              <span role="alert">{t("cloudSync.errors." + actions.error)}</span>
            </Notice>
          </div>
        ) : null}
      </SettingsDisclosure>
    </SettingsCard>
  );
};
