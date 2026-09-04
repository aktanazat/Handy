import React from "react";
import { MeetingReview } from "../MeetingReview";
import type {
  MeetingReviewScreenActions,
  MeetingReviewScreenModel,
} from "../meetingTypes";

interface MeetingReviewScreenProps {
  model: MeetingReviewScreenModel;
  actions: MeetingReviewScreenActions;
  onOpenSettings: () => void;
}

/** Review renders the current record. All writes have already been bound by
 * the mutation owner before they cross this screen boundary. */
export const MeetingReviewScreen: React.FC<MeetingReviewScreenProps> = ({
  model,
  actions,
  onOpenSettings,
}) => (
  <MeetingReview
    snapshot={model.snapshot}
    lastReceipt={model.lastReceipt}
    pendingAction={model.pendingAction}
    onBack={actions.onBack}
    onTitleSet={actions.onTitleSet}
    onSpeakerRename={actions.onSpeakerRename}
    onSpeakerMerge={actions.onSpeakerMerge}
    onSegmentEdit={actions.onSegmentEdit}
    onNoteCreate={actions.onNoteCreate}
    onNoteUpdate={actions.onNoteUpdate}
    onNoteDelete={actions.onNoteDelete}
    onRegenerate={actions.onRegenerate}
    onExport={actions.onExport}
    onRemoteCancel={actions.onRemoteCancel}
    onDelete={actions.onDelete}
    onRefresh={actions.onRefresh}
    onOpenSettings={onOpenSettings}
  />
);
