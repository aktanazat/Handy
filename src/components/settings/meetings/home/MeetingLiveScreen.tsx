import React from "react";
import { MeetingLive } from "../MeetingLive";
import type {
  MeetingLiveScreenActions,
  MeetingLiveScreenModel,
} from "../meetingTypes";

interface MeetingLiveScreenProps {
  model: MeetingLiveScreenModel;
  actions: MeetingLiveScreenActions;
}

/** Capture controls receive no list, review, or workflow internals. */
export const MeetingLiveScreen: React.FC<MeetingLiveScreenProps> = ({
  model,
  actions,
}) => (
  <MeetingLive
    snapshot={model.snapshot}
    pendingAction={model.pendingAction}
    onPause={actions.onPause}
    onResume={actions.onResume}
    onStop={actions.onStop}
    onDiscard={actions.onDiscard}
    onCreateNote={actions.onCreateNote}
  />
);
