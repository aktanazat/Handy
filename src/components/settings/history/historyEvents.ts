import type React from "react";
import {
  events,
  type AudioImportJob,
  type HistoryUpdatePayload,
} from "@/bindings";
import type { ListAction } from "./historyListReducer";

export const subscribeToHistoryUpdates = (
  activeQueryRef: React.MutableRefObject<string>,
  dispatch: React.Dispatch<ListAction>,
  onMutation: () => void,
) =>
  events.historyUpdatePayload.listen((event) => {
    const payload: HistoryUpdatePayload = event.payload;
    switch (payload.action) {
      case "added":
        // A new entry has not been evaluated against an active FTS query, so it
        // joins only the unfiltered list. The next search asks SQLite itself.
        if (activeQueryRef.current.trim() === "") {
          dispatch({ type: "added", entry: payload.entry });
        }
        break;
      case "updated":
        dispatch({ type: "replaced", entry: payload.entry });
        break;
      case "deleted":
        dispatch({ type: "removed", id: payload.id });
        break;
      case "toggled":
        dispatch({ type: "saved-toggled", id: payload.id });
        break;
    }
    onMutation();
  });

export const subscribeToAudioImportUpdates = (
  onUpdate: (job: AudioImportJob) => void,
) =>
  events.audioImportUpdateEvent.listen((event) => onUpdate(event.payload.job));
