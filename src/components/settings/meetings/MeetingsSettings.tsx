import React from "react";
import { MeetingLiveScreen } from "./home/MeetingLiveScreen";
import { MeetingSessionScreen } from "./home/MeetingSessionScreen";
import { MeetingsHomeScreen } from "./home/MeetingsHomeScreen";
import { useMeetingsController } from "./home/useMeetingsController";
import { MeetingReviewScreen } from "./review/MeetingReviewScreen";
import type { MeetingsSettingsProps } from "./meetingTypes";

export type { MeetingsSettingsProps };

export const MeetingsSettings: React.FC<MeetingsSettingsProps> = (props) => (
  <MeetingsSettingsPage key={props.startRequest ?? 0} {...props} />
);

const MeetingsSettingsPage: React.FC<MeetingsSettingsProps> = (props) => {
  const controller = useMeetingsController(props);

  if (controller.screen === "home") {
    return (
      <MeetingsHomeScreen
        model={controller.model}
        actions={controller.actions}
      />
    );
  }
  if (controller.screen === "live") {
    return (
      <MeetingLiveScreen
        model={controller.model}
        actions={controller.actions}
      />
    );
  }
  if (controller.screen === "review") {
    return (
      <MeetingReviewScreen
        model={controller.model}
        actions={controller.actions}
      />
    );
  }
  if (controller.screen === "loading") {
    return (
      <MeetingSessionScreen
        model={controller.model}
        actions={controller.actions}
      />
    );
  }
  return (
    <MeetingSessionScreen
      model={controller.model}
      actions={controller.actions}
    />
  );
};
