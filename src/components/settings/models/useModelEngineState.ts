import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/bindings";

/* Engine-level model state for the catalog page.
 *
 * `is_model_loading` now reports a real flag (an in-flight load or unload on
 * the transcription manager), so the catalog shows which row the engine is
 * busy with instead of the old optimistic "switching" spinner that only lasted
 * as long as the `set_active_model` round trip. */

/** Payload of the untyped `model-state-changed` event (managers/transcription.rs). */
interface ModelStateChangedEvent {
  event_type: string;
  model_id: string | null;
  model_name: string | null;
  error: string | null;
}

export interface ModelEngineState {
  /** The model the engine is loading right now, if any. */
  loadingModelId: string | null;
  /** The model currently resident in the engine. */
  loadedModelId: string | null;
}

const IDLE_ENGINE: ModelEngineState = {
  loadingModelId: null,
  loadedModelId: null,
};

/**
 * Track which model the engine is loading and which one is resident.
 *
 * `selectedModelId` is only consulted for the first paint: `is_model_loading`
 * says that *a* load is running but not for which model, and
 * `get_model_load_status` reports `current_model` as null until the load
 * finishes. The engine only ever loads the selected model, so on mount that id
 * is the honest answer. Every later transition comes from the events, which do
 * carry the id.
 */
export const useModelEngineState = (
  selectedModelId: string,
): ModelEngineState => {
  const [state, setState] = useState<ModelEngineState>(IDLE_ENGINE);
  const sawEvent = useRef(false);

  useEffect(() => {
    const subscription = listen<ModelStateChangedEvent>(
      "model-state-changed",
      (event) => {
        const { event_type: kind, model_id: modelId } = event.payload;
        sawEvent.current = true;
        setState((current) => {
          switch (kind) {
            case "loading_started":
              return { ...current, loadingModelId: modelId };
            case "loading_completed":
              return { loadingModelId: null, loadedModelId: modelId };
            case "loading_failed":
            case "unloaded":
              return IDLE_ENGINE;
            // `selection_changed` says nothing about the engine.
            default:
              return current;
          }
        });
      },
    );
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loadingResult, statusResult] = await Promise.all([
        commands.isModelLoading(),
        commands.getModelLoadStatus(),
      ]);
      // An event already told the truth; do not overwrite it with a snapshot
      // taken before it arrived.
      if (cancelled || sawEvent.current) return;
      const isLoading = loadingResult.status === "ok" && loadingResult.data;
      setState({
        loadingModelId: isLoading ? selectedModelId || null : null,
        loadedModelId:
          statusResult.status === "ok" ? statusResult.data.current_model : null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedModelId]);

  return state;
};

export interface ModelRowErrors {
  /** Message per model id. A row with an entry shows it with a retry. */
  messages: Readonly<Record<string, string>>;
  /** Set a message only when the row has none, so the specific reason from
   * `model-download-failed` always beats a generic caller-side fallback. */
  recordFallback: (modelId: string, message: string) => void;
  clear: (modelId: string) => void;
}

/* Events that put a message on a row, and the ones that take it back off.
 * A cancelled download is a deliberate act, not a failure to report. */
const FAILURE_EVENTS = [
  "model-download-failed",
  "model-extraction-failed",
] as const;

const RESOLVED_EVENTS = [
  "model-download-complete",
  "model-download-cancelled",
] as const;

/**
 * Per-row download failures, kept on the page rather than in the shared model
 * store: a hash mismatch on one model must not blank the whole catalog, and
 * the row is where the retry belongs.
 */
export const useModelRowErrors = (): ModelRowErrors => {
  const [messages, setMessages] = useState<Record<string, string>>({});

  const record = useCallback((modelId: string, message: string) => {
    setMessages((current) => ({ ...current, [modelId]: message }));
  }, []);

  const recordFallback = useCallback((modelId: string, message: string) => {
    setMessages((current) =>
      modelId in current ? current : { ...current, [modelId]: message },
    );
  }, []);

  const clear = useCallback((modelId: string) => {
    setMessages((current) => {
      if (!(modelId in current)) return current;
      const next = { ...current };
      delete next[modelId];
      return next;
    });
  }, []);

  useEffect(() => {
    const subscriptions = [
      ...FAILURE_EVENTS.map((name) =>
        listen<{ model_id: string; error: string }>(name, (event) =>
          record(event.payload.model_id, event.payload.error),
        ),
      ),
      ...RESOLVED_EVENTS.map((name) =>
        listen<string>(name, (event) => clear(event.payload)),
      ),
    ];
    return () => {
      for (const subscription of subscriptions) {
        void subscription.then((unlisten) => unlisten());
      }
    };
  }, [record, clear]);

  return { messages, recordFallback, clear };
};
