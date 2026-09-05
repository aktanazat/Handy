import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  checkCameraPermission,
  checkMicrophonePermission,
  checkScreenRecordingPermission,
  requestCameraPermission,
  requestMicrophonePermission,
  requestScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api";
import {
  commands,
  events,
  type RecorderCommandError,
  type RecorderPreflight,
  type RecorderSnapshot,
  type RecorderStartRequest,
  type Result,
} from "@/bindings";
import { Button } from "@/components/vg/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/vg/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { Switch } from "@/components/vg/switch";
import { FactChip, Notice, SettingsRow } from "@/components/settings/rows";
import { formatDurationShort } from "@/lib/utils/format";
import {
  canCloseRecorder,
  initialRecorderState,
  permissionForFailure,
  recorderCommandErrorFallback,
  recorderFailureKey,
  recorderFailureRecovery,
  recorderHasCapture,
  recorderReducer,
  type RecorderPermission,
} from "./recorderMachine";

const MACOS_SETTINGS_PANE = {
  screen:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  camera:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
  microphone:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
} as const satisfies Record<RecorderPermission, string>;

const permissionOperations = {
  screen: {
    check: checkScreenRecordingPermission,
    request: async () => {
      await requestScreenRecordingPermission();
    },
  },
  camera: {
    check: checkCameraPermission,
    request: async () => {
      await requestCameraPermission();
    },
  },
  microphone: {
    check: checkMicrophonePermission,
    request: async () => {
      await requestMicrophonePermission();
    },
  },
} satisfies Record<
  RecorderPermission,
  { check: () => Promise<boolean>; request: () => Promise<void> }
>;

interface RecorderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const RecorderDialog: React.FC<RecorderDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(
    recorderReducer,
    undefined,
    initialRecorderState,
  );
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(null);
  const [microphoneDeviceId, setMicrophoneDeviceId] = useState<string | null>(
    null,
  );
  const [selectionPending, setSelectionPending] = useState(false);
  const [permissionPending, setPermissionPending] = useState(false);
  const sessionRef = useRef(0);
  const latestNativeSnapshotRef = useRef<RecorderSnapshot | null>(null);
  const applyPreflight = useCallback((preflight: RecorderPreflight) => {
    setCameraDeviceId((current) =>
      preflight.cameraDevices.some((device) => device.id === current)
        ? current
        : (preflight.cameraDevices[0]?.id ?? null),
    );
    setMicrophoneDeviceId((current) =>
      preflight.microphoneDevices.some((device) => device.id === current)
        ? current
        : (preflight.microphoneDevices[0]?.id ?? null),
    );
    if (preflight.cameraDevices.length === 0) setCameraEnabled(false);
    if (preflight.microphoneDevices.length === 0) setMicrophoneEnabled(false);
  }, []);

  const applyNativeSnapshot = useCallback((snapshot: RecorderSnapshot) => {
    latestNativeSnapshotRef.current = snapshot;
    dispatch({ type: "snapshot", snapshot });
  }, []);

  const reportCommandFailure = useCallback(() => {
    const fallback = recorderCommandErrorFallback(
      latestNativeSnapshotRef.current,
    );
    if (fallback !== null) {
      dispatch({ type: "failure", failure: fallback });
    }
  }, []);

  const loadPreflight = useCallback(async () => {
    const session = sessionRef.current;
    latestNativeSnapshotRef.current = null;
    dispatch({ type: "checking" });
    try {
      const preflight = await commands.recorderPreflight();
      if (session !== sessionRef.current) return;
      applyPreflight(preflight);
      dispatch({ type: "preflight", preflight });
    } catch {
      if (session === sessionRef.current) {
        dispatch({ type: "failure", failure: "streamFailed" });
      }
    }
  }, [applyPreflight]);

  useEffect(() => {
    sessionRef.current += 1;
    if (!open) return;
    latestNativeSnapshotRef.current = null;
    dispatch({ type: "reset" });
    setSelectionPending(false);
    setPermissionPending(false);
    void loadPreflight();
    return () => {
      sessionRef.current += 1;
    };
  }, [loadPreflight, open]);

  useEffect(() => {
    if (!open) return;
    const session = sessionRef.current;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void events.recorderStateChangedEvent
      .listen((event) => {
        if (!disposed && session === sessionRef.current) {
          applyNativeSnapshot(event.payload.snapshot);
        }
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch(() => {
        if (!disposed && session === sessionRef.current) {
          dispatch({ type: "failure", failure: "streamFailed" });
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [applyNativeSnapshot, open]);

  const cameraDevices = state.preflight?.cameraDevices ?? [];
  const microphoneDevices = state.preflight?.microphoneDevices ?? [];
  const phase = state.snapshot.phase;
  const canClose = canCloseRecorder(phase);

  useEffect(() => {
    if (!open) return;
    const focusId =
      phase === "previewing"
        ? "recorder-start"
        : phase === "permission" || phase === "failed"
          ? "recorder-recovery"
          : null;
    if (focusId === null) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(focusId)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, phase]);

  const requiredPermissions = useCallback((): RecorderPermission[] => {
    const permissions: RecorderPermission[] = ["screen"];
    if (cameraEnabled && cameraDevices.length > 0) permissions.push("camera");
    if (microphoneEnabled && microphoneDevices.length > 0) {
      permissions.push("microphone");
    }
    return permissions;
  }, [
    cameraDevices.length,
    cameraEnabled,
    microphoneDevices.length,
    microphoneEnabled,
  ]);

  const firstMissingPermission = useCallback(async () => {
    for (const permission of requiredPermissions()) {
      try {
        if (!(await permissionOperations[permission].check()))
          return permission;
      } catch {
        return permission;
      }
    }
    return null;
  }, [requiredPermissions]);

  const startPreview = useCallback(async () => {
    const session = sessionRef.current;
    const request = {
      cameraEnabled,
      cameraDeviceId: cameraEnabled ? cameraDeviceId : null,
      microphoneEnabled,
      microphoneDeviceId: microphoneEnabled ? microphoneDeviceId : null,
    } satisfies RecorderStartRequest;
    latestNativeSnapshotRef.current = null;
    dispatch({ type: "phase", phase: "selectingSource" });
    try {
      const result = await commands.recorderPreviewStart(request);
      if (session !== sessionRef.current) return;
      if (result.status === "ok") {
        applyNativeSnapshot(result.data);
      } else {
        reportCommandFailure();
      }
    } catch {
      if (session === sessionRef.current) reportCommandFailure();
    }
  }, [
    applyNativeSnapshot,
    cameraDeviceId,
    cameraEnabled,
    microphoneDeviceId,
    microphoneEnabled,
    reportCommandFailure,
  ]);

  const chooseScreen = useCallback(async () => {
    if (selectionPending) return;
    const session = sessionRef.current;
    setSelectionPending(true);
    try {
      const missing = await firstMissingPermission();
      if (session !== sessionRef.current) return;
      if (missing !== null) {
        dispatch({ type: "permission", permission: missing, requested: false });
        return;
      }
      await startPreview();
    } catch {
      if (session === sessionRef.current) {
        dispatch({ type: "failure", failure: "streamFailed" });
      }
    } finally {
      if (session === sessionRef.current) setSelectionPending(false);
    }
  }, [firstMissingPermission, selectionPending, startPreview]);

  /* One permission flow for both buttons. Granting asks the OS first;
   * re-checking only re-reads the answer the user gave in System Settings.
   * Nothing else about the two paths differs, so nothing else is written
   * twice. */
  const resolvePermission = useCallback(
    async (request: boolean) => {
      const permission = state.permission ?? "screen";
      if (permissionPending) return;
      const session = sessionRef.current;
      setPermissionPending(true);
      let granted = false;
      try {
        if (request) await permissionOperations[permission].request();
        granted = await permissionOperations[permission].check();
      } catch {
        granted = false;
      } finally {
        if (session === sessionRef.current) setPermissionPending(false);
      }
      if (session !== sessionRef.current) return;
      if (!granted) {
        dispatch({ type: "permission", permission, requested: true });
        return;
      }
      void chooseScreen();
    },
    [chooseScreen, permissionPending, state.permission],
  );

  const runRecorderCommand = useCallback(
    async (
      nextPhase: typeof phase,
      command: () => Promise<Result<RecorderSnapshot, RecorderCommandError>>,
    ) => {
      const session = sessionRef.current;
      latestNativeSnapshotRef.current = null;
      dispatch({ type: "phase", phase: nextPhase });
      try {
        const result = await command();
        if (session !== sessionRef.current) return;
        if (result.status === "ok") {
          applyNativeSnapshot(result.data);
        } else {
          reportCommandFailure();
        }
      } catch {
        if (session === sessionRef.current) reportCommandFailure();
      }
    },
    [applyNativeSnapshot, reportCommandFailure],
  );

  const stopPreview = useCallback(async () => {
    await runRecorderCommand("idle", () => commands.recorderPreviewStop());
  }, [runRecorderCommand]);

  const cancelPreview = useCallback(async () => {
    await runRecorderCommand("idle", () => commands.recorderCancel());
  }, [runRecorderCommand]);

  const requestClose = useCallback(() => {
    if (!canClose) return;
    if (phase === "previewing") void cancelPreview();
    onOpenChange(false);
  }, [canClose, cancelPreview, onOpenChange, phase]);

  const openPermissionSettings = useCallback(() => {
    const permission = state.permission ?? "screen";
    void openUrl(MACOS_SETTINGS_PANE[permission]);
  }, [state.permission]);

  const reveal = useCallback(async () => {
    const session = sessionRef.current;
    try {
      const result = await commands.openRecordingsFolder();
      if (result.status !== "ok" && session === sessionRef.current) {
        dispatch({ type: "reveal-failed" });
      }
    } catch {
      if (session === sessionRef.current) dispatch({ type: "reveal-failed" });
    }
  }, []);

  const recovery = state.snapshot.failure
    ? recorderFailureRecovery[state.snapshot.failure]
    : "done";
  const recoveryPermission = permissionForFailure(state.snapshot.failure);

  const renderSetup = () => (
    <div className="divide-y divide-gray-alpha-400 border-y border-gray-alpha-400">
      <SettingsRow label={t("recorder.screen")}>
        <span className="text-[14px] text-gray-900">
          {t("recorder.required")}
        </span>
      </SettingsRow>
      <SettingsRow
        label={t("recorder.camera")}
        controlId="recorder-camera"
        disabled={cameraDevices.length === 0}
        fact={
          cameraDevices.length === 1
            ? cameraDevices[0]?.name
            : cameraDevices.length === 0
              ? t("recorder.unavailable")
              : undefined
        }
      >
        <Switch
          id="recorder-camera"
          checked={cameraEnabled}
          disabled={cameraDevices.length === 0}
          onCheckedChange={setCameraEnabled}
        />
        {cameraEnabled &&
        cameraDevices.length > 1 &&
        cameraDeviceId !== null ? (
          <Select value={cameraDeviceId} onValueChange={setCameraDeviceId}>
            <SelectTrigger size="sm" className="max-w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cameraDevices.map((device) => (
                <SelectItem key={device.id} value={device.id}>
                  {device.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </SettingsRow>
      <SettingsRow
        label={t("recorder.microphone")}
        controlId="recorder-microphone"
        disabled={microphoneDevices.length === 0}
        fact={
          microphoneDevices.length === 1
            ? microphoneDevices[0]?.name
            : microphoneDevices.length === 0
              ? t("recorder.unavailable")
              : undefined
        }
      >
        <Switch
          id="recorder-microphone"
          checked={microphoneEnabled}
          disabled={microphoneDevices.length === 0}
          onCheckedChange={setMicrophoneEnabled}
        />
        {microphoneEnabled &&
        microphoneDevices.length > 1 &&
        microphoneDeviceId !== null ? (
          <Select
            value={microphoneDeviceId}
            onValueChange={setMicrophoneDeviceId}
          >
            <SelectTrigger size="sm" className="max-w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {microphoneDevices.map((device) => (
                <SelectItem key={device.id} value={device.id}>
                  {device.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </SettingsRow>
    </div>
  );

  const renderSourceSummary = () => {
    const camera = cameraEnabled
      ? (cameraDevices.find((device) => device.id === cameraDeviceId)?.name ??
        null)
      : null;
    const microphone = microphoneEnabled
      ? (microphoneDevices.find((device) => device.id === microphoneDeviceId)
          ?.name ?? null)
      : null;
    return (
      <div className="space-y-2 border-y border-gray-alpha-400 px-4 py-3 text-[14px] text-gray-900">
        <p>{t("recorder.screenSelected")}</p>
        {camera ? (
          <p>
            {t("recorder.camera")}: {camera}
          </p>
        ) : null}
        {microphone ? (
          <p>
            {t("recorder.microphone")}: {microphone}
          </p>
        ) : null}
      </div>
    );
  };

  const renderPermission = () => {
    const permission = state.permission ?? "screen";
    return (
      <Notice
        className="border-y border-gray-alpha-400 px-4 py-3"
        tone="warning"
        assertive={state.permissionRequested}
      >
        {t(`recorder.permission.${permission}`)}
      </Notice>
    );
  };

  const renderFailure = () => {
    const failure = state.snapshot.failure;
    if (!failure) return null;
    return (
      <Notice
        className="border-y border-gray-alpha-400 px-4 py-3"
        tone="danger"
        assertive
      >
        {t(recorderFailureKey[failure])}
      </Notice>
    );
  };

  const renderSaved = () => {
    const savedFilename = state.snapshot.outputPath?.split("/").pop() ?? null;
    const dimensions =
      state.snapshot.width !== null && state.snapshot.height !== null
        ? t("recorder.dimensions", {
            width: state.snapshot.width,
            height: state.snapshot.height,
          })
        : null;
    return (
      <div className="space-y-2 border-y border-gray-alpha-400 px-4 py-3 text-[14px] text-gray-900">
        {savedFilename ? <p>{savedFilename}</p> : null}
        <p className="tabular-nums">
          {formatDurationShort(state.snapshot.elapsedMs / 1000)}
          {dimensions ? ` · ${dimensions}` : ""}
        </p>
        {state.revealFailed ? (
          <Notice tone="danger" assertive>
            {t("recorder.error.revealFailed")}
          </Notice>
        ) : null}
      </div>
    );
  };

  const renderBody = () => {
    switch (phase) {
      case "idle":
        return renderSetup();
      case "permission":
        return renderPermission();
      case "previewing":
      case "starting":
      case "recording":
      case "paused":
      case "finalizing":
        return renderSourceSummary();
      case "saved":
        return renderSaved();
      case "failed":
        return renderFailure();
      default:
        return null;
    }
  };

  const renderFailureFooter = () => {
    if (recovery === "permission" && recoveryPermission !== null) {
      return (
        <DialogFooter showCloseButton>
          <Button
            id="recorder-recovery"
            type="button"
            onClick={() =>
              dispatch({
                type: "permission",
                permission: recoveryPermission,
                requested: true,
              })
            }
          >
            {t("recorder.permission.recheck")}
          </Button>
        </DialogFooter>
      );
    }

    if (recovery === "choose") {
      return (
        <DialogFooter showCloseButton>
          <Button
            id="recorder-recovery"
            type="button"
            onClick={() => dispatch({ type: "clear-failure" })}
          >
            {t("recorder.change")}
          </Button>
        </DialogFooter>
      );
    }

    if (recovery === "retry") {
      return (
        <DialogFooter showCloseButton>
          <Button
            id="recorder-recovery"
            type="button"
            onClick={() => void loadPreflight()}
          >
            {t("common.retry")}
          </Button>
        </DialogFooter>
      );
    }

    return (
      <DialogFooter>
        <Button id="recorder-recovery" type="button" onClick={requestClose}>
          {t("recorder.done")}
        </Button>
      </DialogFooter>
    );
  };

  const renderFooter = () => {
    if (phase === "idle") {
      return (
        <DialogFooter showCloseButton>
          <Button
            type="button"
            disabled={selectionPending}
            onClick={() => void chooseScreen()}
          >
            {t("recorder.chooseScreen")}
          </Button>
        </DialogFooter>
      );
    }

    if (phase === "permission") {
      return (
        <DialogFooter showCloseButton>
          {state.permissionRequested ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={openPermissionSettings}
              >
                {t("accessibility.openSettings")}
              </Button>
              <Button
                id="recorder-recovery"
                type="button"
                variant="outline"
                disabled={permissionPending}
                onClick={() => void resolvePermission(false)}
              >
                {t("recorder.permission.recheck")}
              </Button>
            </>
          ) : (
            <Button
              id="recorder-recovery"
              type="button"
              disabled={permissionPending}
              onClick={() => void resolvePermission(true)}
            >
              {t("recorder.permission.grant")}
            </Button>
          )}
        </DialogFooter>
      );
    }

    if (phase === "previewing") {
      return (
        <DialogFooter showCloseButton>
          <Button
            type="button"
            variant="outline"
            onClick={() => void stopPreview()}
          >
            {t("recorder.change")}
          </Button>
          <Button
            id="recorder-start"
            type="button"
            onClick={() =>
              void runRecorderCommand("starting", () =>
                commands.recorderStart(),
              )
            }
          >
            {t("recorder.start")}
          </Button>
        </DialogFooter>
      );
    }

    if (phase === "recording") {
      return (
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void runRecorderCommand("paused", () => commands.recorderPause())
            }
          >
            {t("common.pause")}
          </Button>
          <Button
            type="button"
            onClick={() =>
              void runRecorderCommand("finalizing", () =>
                commands.recorderStop(),
              )
            }
          >
            {t("recorder.stopAndSave")}
          </Button>
        </DialogFooter>
      );
    }

    if (phase === "paused") {
      return (
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void runRecorderCommand("recording", () =>
                commands.recorderResume(),
              )
            }
          >
            {t("recorder.resume")}
          </Button>
          <Button
            type="button"
            onClick={() =>
              void runRecorderCommand("finalizing", () =>
                commands.recorderStop(),
              )
            }
          >
            {t("recorder.stopAndSave")}
          </Button>
        </DialogFooter>
      );
    }

    if (phase === "saved") {
      return (
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void reveal()}>
            {t("recorder.reveal")}
          </Button>
          <Button type="button" onClick={requestClose}>
            {t("recorder.done")}
          </Button>
        </DialogFooter>
      );
    }

    if (phase === "failed") return renderFailureFooter();

    return canClose ? <DialogFooter showCloseButton /> : null;
  };

  const hasCapture = recorderHasCapture(state.snapshot);
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onOpenChange(true);
        else requestClose();
      }}
    >
      <DialogContent
        className="max-w-xl gap-0 overflow-hidden p-0"
        material="solid"
        showCloseButton={canClose}
        onEscapeKeyDown={(event) => {
          if (!canClose) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!canClose) event.preventDefault();
        }}
      >
        {/* `mx-0` cancels the kit header's full-bleed pull: this modal
            replaces the dialog's 24px padding with `p-0` and pads its own
            header, so the -mx-6 would push the band past the sheet's edge and
            `overflow-hidden` would clip the title. The hairline the kit puts
            under the header still runs the full width here, because with p-0
            the header's own box already is the full width. */}
        <DialogHeader className="mx-0 px-6 py-5">
          <div className="flex items-center justify-between gap-4 pe-8">
            <DialogTitle>{t("recorder.title")}</DialogTitle>
            <div className="flex items-center gap-3">
              {hasCapture ? (
                <FactChip
                  label={t("recorder.elapsed")}
                  value={formatDurationShort(state.snapshot.elapsedMs / 1000)}
                />
              ) : null}
              <span className="inline-flex items-center gap-2 text-[14px] text-gray-900">
                {phase === "recording" ? (
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-red-900"
                  />
                ) : null}
                {t(`recorder.phase.${phase}`)}
              </span>
            </div>
          </div>
          <DialogDescription
            className="sr-only"
            aria-live="polite"
            role="status"
          >
            {t(`recorder.phase.${phase}`)}
          </DialogDescription>
        </DialogHeader>
        {renderBody()}
        {renderFooter()}
      </DialogContent>
    </Dialog>
  );
};
