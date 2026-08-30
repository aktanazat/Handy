import { useCallback, useEffect, useRef, useState } from "react";
import {
  commands,
  events,
  type UpstreamImportError,
  type UpstreamImportProgressEvent,
  type UpstreamImportResult,
  type UpstreamImportSelection,
  type UpstreamImportStatus,
} from "@/bindings";
import { useSettings } from "@/hooks/useSettings";

const BYTE_UNITS = ["bytes", "kilobytes", "megabytes", "gigabytes"] as const;

const byteSize = (bytes: number) => {
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return { value, unit: BYTE_UNITS[unitIndex] };
};

const subscribeToUpstreamImportProgress = (
  onUpdate: (progress: UpstreamImportProgressEvent) => void,
) => {
  let active = true;
  let unlisten: (() => void) | undefined;

  void events.upstreamImportProgressEvent
    .listen((event) => {
      if (active) onUpdate(event.payload);
    })
    .then(
      (nextUnlisten) => {
        if (active) {
          unlisten = nextUnlisten;
        } else {
          nextUnlisten();
        }
      },
      () => undefined,
    );

  return () => {
    active = false;
    unlisten?.();
  };
};

/* Reading the previous app's data directory: what is there, what of it the
 * user picked, and how the copy went. The selection is seeded once from the
 * first status read, then only ever narrowed by later ones, so a refresh
 * cannot silently tick a box the user cleared. */
export const useUpstreamImport = () => {
  const { refreshSettings } = useSettings();
  const [upstreamStatus, setUpstreamStatus] =
    useState<UpstreamImportStatus | null>(null);
  const [loadingUpstreamStatus, setLoadingUpstreamStatus] = useState(true);
  const [upstreamSelection, setUpstreamSelection] =
    useState<UpstreamImportSelection>({
      settings: false,
      history: false,
      recordings: false,
    });
  const [upstreamProgress, setUpstreamProgress] =
    useState<UpstreamImportProgressEvent | null>(null);
  const [upstreamResult, setUpstreamResult] =
    useState<UpstreamImportResult | null>(null);
  const [upstreamError, setUpstreamError] = useState<
    UpstreamImportError | "status" | null
  >(null);
  const [upstreamImporting, setUpstreamImporting] = useState(false);
  const upstreamSelectionInitialized = useRef(false);

  const refreshUpstreamStatus = useCallback(async () => {
    setLoadingUpstreamStatus(true);
    try {
      const result = await commands.getUpstreamImportStatus();
      if (result.status === "error") {
        setUpstreamStatus(null);
        setUpstreamError(
          result.error === "source_unavailable" ? null : result.error,
        );
        return;
      }
      setUpstreamStatus(result.data);
      setUpstreamError(null);
      if (!upstreamSelectionInitialized.current) {
        upstreamSelectionInitialized.current = true;
        setUpstreamSelection({
          settings:
            result.data.settings_available && !result.data.settings_imported,
          history: result.data.history_entries > 0,
          recordings: false,
        });
      } else {
        setUpstreamSelection((current) => ({
          settings: current.settings && result.data.settings_available,
          history: current.history && result.data.history_entries > 0,
          recordings:
            current.recordings &&
            result.data.history_entries > 0 &&
            result.data.recording_files > 0,
        }));
      }
    } catch {
      setUpstreamStatus(null);
      setUpstreamError("status");
    } finally {
      setLoadingUpstreamStatus(false);
    }
  }, []);

  useEffect(() => {
    void refreshUpstreamStatus();
  }, [refreshUpstreamStatus]);

  useEffect(() => {
    const unsubscribe = subscribeToUpstreamImportProgress(setUpstreamProgress);
    return () => {
      unsubscribe();
    };
  }, []);

  const changeUpstreamHistorySelection = (history: boolean) => {
    setUpstreamSelection((current) => ({
      ...current,
      history,
      recordings: history ? current.recordings : false,
    }));
  };

  const upstreamSourceHasImportableData =
    upstreamStatus?.settings_available === true ||
    (upstreamStatus?.history_entries ?? 0) > 0;
  const upstreamSelectionValid =
    (upstreamSelection.settings &&
      upstreamStatus?.settings_available === true) ||
    (upstreamSelection.history && (upstreamStatus?.history_entries ?? 0) > 0);

  const startUpstreamImport = async () => {
    if (
      upstreamImporting ||
      !upstreamStatus ||
      upstreamStatus.app_state !== "closed"
    ) {
      return;
    }
    if (!upstreamSelectionValid) {
      setUpstreamError("invalid_selection");
      return;
    }

    setUpstreamImporting(true);
    setUpstreamError(null);
    setUpstreamProgress(null);
    setUpstreamResult(null);
    try {
      const result = await commands.importLegacyApp(upstreamSelection);
      if (result.status === "error") {
        setUpstreamError(result.error);
        return;
      }
      setUpstreamResult(result.data);
      await Promise.all([refreshSettings(), refreshUpstreamStatus()]);
    } catch {
      setUpstreamError("internal");
    } finally {
      setUpstreamImporting(false);
    }
  };

  const upstreamRecordingSize = byteSize(upstreamStatus?.recording_bytes ?? 0);
  const upstreamImportAvailable =
    upstreamStatus?.available === true && upstreamStatus.app_state === "closed";

  return {
    upstreamStatus,
    loadingUpstreamStatus,
    upstreamSelection,
    setUpstreamSelection,
    upstreamProgress,
    upstreamResult,
    upstreamError,
    upstreamImporting,
    upstreamSourceHasImportableData,
    upstreamSelectionValid,
    upstreamRecordingSize,
    upstreamImportAvailable,
    changeUpstreamHistorySelection,
    startUpstreamImport,
    refreshUpstreamStatus,
  };
};
