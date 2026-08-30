import React from "react";
import { SettingsPage } from "@/components/settings/rows";
import { Skeleton } from "@/components/vg/skeleton";
import { MeetingStartGate } from "../MeetingStartGate";
import type {
  MeetingGateScreenActions,
  MeetingGateScreenModel,
  MeetingLoadingScreenModel,
} from "../meetingTypes";

/* The detail view loads a whole snapshot. The skeleton keeps the header and
 * first rows in place so the swap does not jump. */
const MeetingDetailSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <SettingsPage
    role="status"
    aria-label={label}
    header={
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-56" />
      </div>
    }
  >
    <div className="flex flex-col gap-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-[120px] w-full rounded-card" />
    </div>
    <div className="flex flex-col gap-3">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-[88px] w-full rounded-card" />
    </div>
  </SettingsPage>
);

type MeetingSessionScreenProps =
  | { model: MeetingLoadingScreenModel; actions: null }
  | { model: MeetingGateScreenModel; actions: MeetingGateScreenActions };

/** Loading and preflight are the two session states without a live or review
 * page. Both receive a model and the actions valid for that state. */
export const MeetingSessionScreen: React.FC<MeetingSessionScreenProps> = (
  props,
) => {
  if (props.actions === null) {
    return <MeetingDetailSkeleton label={props.model.label} />;
  }

  const { model, actions } = props;
  return (
    <MeetingStartGate
      snapshot={model.snapshot}
      options={model.options}
      refreshing={model.refreshing}
      starting={model.starting}
      onRefresh={actions.onRefresh}
      onCancel={actions.onCancel}
      onStart={actions.onStart}
    />
  );
};
