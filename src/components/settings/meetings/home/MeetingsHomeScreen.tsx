import React from "react";
import type {
  MeetingsHomeScreenActions,
  MeetingsHomeScreenModel,
} from "../meetingTypes";
import { MeetingsHome } from "../MeetingsHome";

interface MeetingsHomeScreenProps {
  model: MeetingsHomeScreenModel;
  actions: MeetingsHomeScreenActions;
}

/** The list screen can read only its own model and invoke its own actions. */
export const MeetingsHomeScreen: React.FC<MeetingsHomeScreenProps> = ({
  model,
  actions,
}) => <MeetingsHome {...model} {...actions} />;
