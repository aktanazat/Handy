import React from "react";
import type {
  MeetingsHomeScreenActions,
  MeetingsHomeScreenModel,
} from "../meetingTypes";
import { MeetingsHome } from "../MeetingsHome";

interface MeetingsHomeScreenProps {
  model: MeetingsHomeScreenModel;
  actions: MeetingsHomeScreenActions;
  /* Not part of the controller's actions: the route is the shell's to change,
   * and the controller owns meeting state only. */
  onOpenSettings?: () => void;
}

/** The list screen can read only its own model and invoke its own actions. */
export const MeetingsHomeScreen: React.FC<MeetingsHomeScreenProps> = ({
  model,
  actions,
  onOpenSettings,
}) => <MeetingsHome {...model} {...actions} onOpenSettings={onOpenSettings} />;
