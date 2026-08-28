/* Read-only backend status the Privacy tab reports honestly: how dictation
 * history is stored at rest, and whether cloud sync is actually reachable.
 * Shapes come from the generated bindings; these hooks own only the fetch
 * lifecycle. */

import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "../../../bindings";
import type {
  CloudSyncServiceStatus,
  HistoryStorageStatus,
} from "../../../bindings";

export type { CloudSyncServiceStatus, HistoryStorageStatus };

export type StatusPhase = "loading" | "ready" | "failed";

interface StatusResource<T> {
  phase: StatusPhase;
  value: T | null;
  error: string | null;
  reload: () => void;
}

/** Startup acquires the history key off the critical path, so this status
 * begins as "unlocking" and settles once the unlock task publishes the event
 * the backend raises for exactly this purpose. */
export const useHistoryStorageStatus =
  (): StatusResource<HistoryStorageStatus> => {
    const [value, setValue] = useState<HistoryStorageStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [phase, setPhase] = useState<StatusPhase>("loading");
    const [attempt, setAttempt] = useState(0);

    const reload = useCallback(() => setAttempt((current) => current + 1), []);

    useEffect(() => {
      let cancelled = false;

      const read = async () => {
        try {
          const status = await commands.historyStorageStatus();
          if (cancelled) return;
          setValue(status);
          setError(null);
          setPhase("ready");
        } catch (readError) {
          if (cancelled) return;
          setError(String(readError));
          setPhase("failed");
        }
      };

      void read();

      let unlisten: (() => void) | undefined;
      void listen("history-storage-changed", () => {
        if (!cancelled) void read();
      }).then(
        (dispose) => {
          if (cancelled) dispose();
          else unlisten = dispose;
        },
        () => undefined,
      );

      return () => {
        cancelled = true;
        unlisten?.();
      };
    }, [attempt]);

    return { phase, value, error, reload };
  };

/** Availability only. Never a toggle: the answer is derived from stored
 * settings plus portable mode, and the user cannot flip it from here. */
export const useCloudSyncServiceStatus =
  (): StatusResource<CloudSyncServiceStatus> => {
    const [value, setValue] = useState<CloudSyncServiceStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [phase, setPhase] = useState<StatusPhase>("loading");
    const [attempt, setAttempt] = useState(0);

    const reload = useCallback(() => setAttempt((current) => current + 1), []);

    useEffect(() => {
      let cancelled = false;

      const read = async () => {
        setPhase("loading");
        try {
          const status = await commands.cloudSyncServiceStatus();
          if (cancelled) return;
          setValue(status);
          setError(null);
          setPhase("ready");
        } catch (readError) {
          if (cancelled) return;
          setError(String(readError));
          setPhase("failed");
        }
      };

      void read();
      return () => {
        cancelled = true;
      };
    }, [attempt]);

    return { phase, value, error, reload };
  };
