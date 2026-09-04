import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  commands,
  type MeetingCommandError,
  type MeetingReviewSnapshot,
  type PersonId,
  type SpeakerId,
  type VoiceIdentityStatus,
  type VoiceIdentityTarget,
  type VoiceSpeakerIdentityAction,
} from "@/bindings";
import { usePeopleQuery } from "@/components/people/usePeopleQuery";
import { meetingErrorKey } from "../meetingUtils";

type DialogState = {
  kind: "label" | "correct";
  speakerId: SpeakerId;
};

interface UseVoiceIdentityOptions {
  snapshot: MeetingReviewSnapshot;
  onRefresh: () => Promise<void>;
}

export const useVoiceIdentity = ({
  snapshot,
  onRefresh,
}: UseVoiceIdentityOptions) => {
  const { t } = useTranslation();
  const sessionId = snapshot.session.session_id;
  const revision = snapshot.session.revision;
  const [status, setStatus] = useState<VoiceIdentityStatus | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [unknownConfirming, setUnknownConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  /* Every route that changes which speaker the dialog is asking about also
   * drops a pending "mark unknown" question, so an answer meant for one
   * speaker can never land on the next one. */
  const showDialog = (next: DialogState | null) => {
    setUnknownConfirming(false);
    setDialog(next);
  };

  const loadPeople = useCallback(async () => {
    const result = await commands.peopleList();
    if (result.status === "error") throw new Error("people list unavailable");
    return result.data;
  }, []);
  const peopleQuery = usePeopleQuery(`voice-identity:${sessionId}`, loadPeople);

  const refreshStatus = useCallback(async () => {
    try {
      const result = await commands.voiceIdentityStatus(sessionId);
      if (result.status === "error") {
        setStatus(null);
        return null;
      }
      setStatus(result.data);
      return result.data;
    } catch {
      setStatus(null);
      return null;
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, revision]);

  const speakersById = useMemo(
    () =>
      new Map(
        snapshot.speakers.map((speaker) => [speaker.speaker_id, speaker]),
      ),
    [snapshot.speakers],
  );
  const unresolvedSpeakers = useMemo(() => {
    if (status === null) return null;
    return status.unresolved_active_speaker_ids.flatMap((speakerId) => {
      const speaker = speakersById.get(speakerId);
      return speaker === undefined ? [] : [speaker];
    });
  }, [speakersById, status]);
  const activeDialog =
    dialog === null || speakersById.has(dialog.speakerId) ? dialog : null;
  const dialogSpeaker =
    activeDialog === null
      ? null
      : (speakersById.get(activeDialog.speakerId) ?? null);

  /* One error table for this screen. `meetingErrorKey` is checked against
   * every `MeetingCommandError` the bindings carry, so a refusal that already
   * has a sentence — storage unavailable, meeting not found, consent required —
   * reaches this dialog as that sentence rather than the generic one. A thrown
   * IPC failure is the only case with no variant to name. */
  const reportIdentityError = (error: MeetingCommandError | null) => {
    toast.error(
      t(error === null ? "meetings.errors.operation" : meetingErrorKey(error)),
    );
  };

  const enrollVoice = async (personId: PersonId, speakerId: SpeakerId) => {
    const [freshMeeting, freshPeople] = await Promise.all([
      commands.meetingGet(sessionId),
      commands.peopleList(),
    ]);
    if (freshMeeting.status === "error") {
      reportIdentityError(freshMeeting.error);
      return;
    }
    if (freshPeople.status === "error") {
      reportIdentityError(freshPeople.error);
      return;
    }
    const currentSpeaker = freshMeeting.data.speakers.find(
      (speaker) => speaker.speaker_id === speakerId,
    );
    if (currentSpeaker === undefined) {
      toast.error(t("meetings.review.rememberVoiceFailed"));
      return;
    }
    const result = await commands.voiceEnrollProfile({
      person_id: personId,
      session_id: sessionId,
      speaker_id: speakerId,
      expected_meeting_revision: freshMeeting.data.session.revision,
      expected_speaker_revision: currentSpeaker.revision,
      expected_people_revision: freshPeople.data.revision,
      consent_version: 1,
    });
    if (result.status === "error") {
      reportIdentityError(result.error);
      return;
    }
    /* The label committed and the store kept no sample from this speaker: the
     * one outcome with no error variant behind it, so it keeps the sentence
     * that says exactly that. */
    if (!result.data.enrolled) {
      toast.error(t("meetings.review.rememberVoiceFailed"));
    }
  };

  const refreshAfterMutation = async () => {
    const nextStatus = await refreshStatus();
    await Promise.allSettled([peopleQuery.reload(), onRefresh()]);
    return nextStatus;
  };

  const completeDialog = async (current: DialogState) => {
    const nextStatus = await refreshAfterMutation();
    if (current.kind === "correct" || nextStatus === null) {
      showDialog(null);
      return;
    }
    const nextSpeakerId = nextStatus.unresolved_active_speaker_ids.find(
      (speakerId) => speakersById.has(speakerId),
    );
    showDialog(
      nextSpeakerId === undefined
        ? null
        : { kind: "label", speakerId: nextSpeakerId },
    );
  };

  const submitIdentity = async (
    action: VoiceSpeakerIdentityAction,
    remember: boolean,
  ) => {
    const current = activeDialog;
    const people = peopleQuery.data;
    if (current === null || people === null) return;

    setPending(true);
    try {
      const result = await commands.voiceIdentifySpeaker({
        operation_id: crypto.randomUUID(),
        requested_at_utc_ms: Date.now(),
        session_id: sessionId,
        expected_meeting_revision: snapshot.session.revision,
        expected_people_revision: people.revision,
        speaker_id: current.speakerId,
        action,
      });
      if (result.status === "error") {
        reportIdentityError(result.error);
        await refreshAfterMutation();
        return;
      }
      /* The identify half has committed and moved the meeting revision on by
       * here. A throw out of the enrollment half must not skip the refresh
       * below: the dialog would stay open on the speaker that was just labeled
       * and the next Save would send a revision the store has left behind. */
      if (remember && result.data.resolved_person_id !== null) {
        try {
          await enrollVoice(result.data.resolved_person_id, current.speakerId);
        } catch {
          toast.error(t("meetings.review.rememberVoiceFailed"));
        }
      }
      await completeDialog(current);
    } catch {
      reportIdentityError(null);
    } finally {
      setPending(false);
    }
  };

  const openNextUnresolved = () => {
    const speaker = unresolvedSpeakers?.[0];
    if (speaker !== undefined) {
      showDialog({ kind: "label", speakerId: speaker.speaker_id });
    }
  };

  const openCorrection = (speakerId: SpeakerId) => {
    if (speakersById.has(speakerId)) {
      showDialog({ kind: "correct", speakerId });
    }
  };

  return {
    /* The same filtered list `openNextUnresolved` opens. Between the status
     * refresh and the snapshot refresh the store's ids can name speakers this
     * snapshot has not seen yet, and a header count the button cannot act on
     * is worse than a count that arrives one refresh late. */
    unresolvedSpeakerCount: unresolvedSpeakers?.length ?? null,
    dialog: activeDialog,
    unknownConfirming,
    dialogSpeaker,
    people: peopleQuery.data?.entries ?? null,
    peopleLoading: peopleQuery.loading,
    peopleLoadFailed: peopleQuery.error,
    pending,
    openNextUnresolved,
    openCorrection,
    closeDialog: () => showDialog(null),
    requestUnknown: () => setUnknownConfirming(true),
    cancelUnknown: () => setUnknownConfirming(false),
    retryPeople: peopleQuery.reload,
    saveLabel: (target: VoiceIdentityTarget, remember: boolean) =>
      void submitIdentity(
        {
          kind: activeDialog?.kind === "correct" ? "correct_to" : "label",
          target,
        },
        remember,
      ),
    skipSpeaker: () => void submitIdentity({ kind: "mark_unknown" }, false),
  };
};
