import React, { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  FileJson,
  FileText,
  RefreshCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type CitedArtifactText,
  type ManualNote,
  type MeetingExportFormat,
  type MeetingReviewSnapshot,
  type MeetingSearchHit,
  type OperationReceipt,
  type SpeakerId,
} from "@/bindings";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { CloudMeetingActions } from "../../cloud-sync/CloudMeetingActions";
import { Dialog } from "../../ui/Dialog";
import {
  CaptureCompletenessBadge,
  MeetingPhaseBadge,
  ProcessingStatusLine,
  SourceHealthCard,
} from "./MeetingStatus";
import {
  formatMeetingDate,
  formatMeetingOffset,
  meetingErrorKey,
  meetingReasonKey,
} from "./meetingUtils";

interface MeetingReviewProps {
  snapshot: MeetingReviewSnapshot;
  lastReceipt: OperationReceipt | null;
  pendingAction: string | null;
  onBack: () => void;
  onTitleSet: (title: string) => void;
  onSpeakerRename: (speakerId: SpeakerId, displayName: string) => void;
  onSpeakerMerge: (sourceSpeakerId: SpeakerId, targetSpeakerId: SpeakerId) => void;
  onSegmentEdit: (
    segmentId: string,
    replacementText: string,
    removed: boolean,
  ) => void;
  onNoteCreate: (body: string) => void;
  onNoteUpdate: (note: ManualNote, body: string) => void;
  onNoteDelete: (note: ManualNote) => void;
  onRegenerate: () => void;
  onExport: (format: MeetingExportFormat) => void;
  onRemoteCancel: () => void;
  onDelete: () => void;
  onRefresh: () => Promise<void>;
}

interface SpeakerRowProps {
  speakerId: SpeakerId;
  name: string;
  disabled: boolean;
  onRename: (speakerId: SpeakerId, name: string) => void;
}

const SpeakerRow: React.FC<SpeakerRowProps> = ({
  speakerId,
  name,
  disabled,
  onRename,
}) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [canSave, setCanSave] = useState(false);

  const save = () => {
    const nextName = inputRef.current?.value.trim() ?? "";
    if (nextName.length === 0 || nextName === name) return;
    onRename(speakerId, nextName);
  };

  return (
    <li className="meeting-speaker-row">
      <input
        ref={inputRef}
        defaultValue={name}
        onChange={(event) => {
          const nextName = event.target.value.trim();
          setCanSave(nextName.length > 0 && nextName !== name);
        }}
        aria-label={t("meetings.review.speakerName")}
        disabled={disabled}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={save}
        disabled={disabled || !canSave}
      >
        {t("common.save")}
      </Button>
    </li>
  );
};

interface CitedTextProps {
  value: CitedArtifactText;
}

const CitedText: React.FC<CitedTextProps> = ({ value }) => {
  const { t } = useTranslation();

  return (
    <div className="meeting-cited-text">
      <p>{value.text}</p>
      {value.citations.length > 0 ? (
        <div className="meeting-citation-list">
          {value.citations.map((citation) => (
            <span key={citation.segment_id}>
              {t("meetings.review.citation", {
                time: formatMeetingOffset(citation.start_offset_ns),
              })}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};

interface ManualNoteEditorProps {
  note: ManualNote;
  disabled: boolean;
  onUpdate: (note: ManualNote, body: string) => void;
  onDelete: (note: ManualNote) => void;
}

const ManualNoteEditor: React.FC<ManualNoteEditorProps> = ({
  note,
  disabled,
  onUpdate,
  onDelete,
}) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [canSave, setCanSave] = useState(false);

  const save = () => {
    const nextBody = inputRef.current?.value.trim() ?? "";
    if (nextBody.length === 0 || nextBody === note.body) return;
    onUpdate(note, nextBody);
  };

  return (
    <li className="meeting-manual-note-entry">
      <div className="meeting-note-entry-meta">
        {note.start_offset_ns === null
          ? t("meetings.review.noTimestamp")
          : t("meetings.review.timestamp", {
              time: formatMeetingOffset(note.start_offset_ns),
            })}
      </div>
      <textarea
        ref={inputRef}
        defaultValue={note.body}
        onChange={(event) => {
          const nextBody = event.target.value.trim();
          setCanSave(nextBody.length > 0 && nextBody !== note.body);
        }}
        aria-label={t("meetings.review.manualNote")}
        disabled={disabled}
      />
      <div className="meeting-note-entry-actions">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={save}
          disabled={disabled || !canSave}
        >
          {t("common.save")}
        </Button>
        <Button
          type="button"
          variant="danger-ghost"
          size="sm"
          onClick={() => onDelete(note)}
          disabled={disabled}
        >
          {t("common.delete")}
        </Button>
      </div>
    </li>
  );
};

export const MeetingReview: React.FC<MeetingReviewProps> = ({
  snapshot,
  lastReceipt,
  pendingAction,
  onBack,
  onTitleSet,
  onSpeakerRename,
  onSpeakerMerge,
  onSegmentEdit,
  onNoteCreate,
  onNoteUpdate,
  onNoteDelete,
  onRegenerate,
  onExport,
  onRemoteCancel,
  onDelete,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const [newNote, setNewNote] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<MeetingSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [question, setQuestion] = useState("");
  const [askingQuestion, setAskingQuestion] = useState(false);
  const editable = snapshot.session.allowed_actions.includes("edit");
  const canRegenerate = snapshot.session.allowed_actions.includes("regenerate");
  const canAskQuestion =
    snapshot.session.allowed_actions.includes("ask_question");
  const canExport =
    snapshot.can_export && snapshot.session.allowed_actions.includes("export");
  const canDelete = snapshot.session.allowed_actions.includes("delete");
  const canCancelRemote =
    snapshot.remote_cancellation_pending &&
    snapshot.session.allowed_actions.includes("cancel_remote");
  const busy = pendingAction !== null;
  const speakerNames = useMemo(
    () =>
      snapshot.speakers.reduce<Record<string, string>>((names, speaker) => {
        names[speaker.speaker_id] = speaker.display_name;
        return names;
      }, {}),
    [snapshot.speakers],
  );

  const createNote = () => {
    const body = newNote.trim();
    if (body.length === 0) return;
    onNoteCreate(body);
    setNewNote("");
  };

  const searchTranscript = async () => {
    const query = searchQuery.trim();
    if (query.length === 0) {
      setSearchHits([]);
      return;
    }

    setSearching(true);
    try {
      const result = await commands.meetingSearch({
        query,
        session_ids: [snapshot.session.session_id],
        limit: 50,
      });
      if (result.status === "error") {
        toast.error(t(meetingErrorKey(result.error)));
        return;
      }
      setSearchHits(result.data.entries);
    } catch {
      toast.error(t("meetings.errors.operation"));
    } finally {
      setSearching(false);
    }
  };

  const askQuestion = async () => {
    const text = question.trim();
    if (text.length === 0) return;

    setAskingQuestion(true);
    try {
      const result = await commands.meetingQuestionAsk({
        operation_id: crypto.randomUUID(),
        session_id: snapshot.session.session_id,
        expected_revision: snapshot.session.revision,
        question_id: crypto.randomUUID(),
        question: text,
        scope: { kind: "this_meeting" },
        save_history: true,
      });
      if (result.status === "error") {
        toast.error(t(meetingErrorKey(result.error)));
        if (result.error === "stale_revision") await onRefresh();
        return;
      }
      if (result.data.receipt.reason_codes.includes("duplicate_operation")) {
        toast.info(t("meetings.receipts.duplicate"));
      }
      setQuestion("");
      await onRefresh();
    } catch {
      toast.error(t("meetings.errors.operation"));
    } finally {
      setAskingQuestion(false);
    }
  };

  const forgetQuestion = async (questionId: string) => {
    setAskingQuestion(true);
    try {
      const result = await commands.meetingQuestionForget(
        {
          operation_id: crypto.randomUUID(),
          session_id: snapshot.session.session_id,
          expected_revision: snapshot.session.revision,
        },
        questionId,
      );
      if (result.status === "error") {
        toast.error(t(meetingErrorKey(result.error)));
        if (result.error === "stale_revision") await onRefresh();
        return;
      }
      if (result.data.receipt.reason_codes.includes("duplicate_operation")) {
        toast.info(t("meetings.receipts.duplicate"));
      }
      await onRefresh();
    } catch {
      toast.error(t("meetings.errors.operation"));
    } finally {
      setAskingQuestion(false);
    }
  };

  return (
    <MeetingReviewBody
      snapshot={snapshot}
      lastReceipt={lastReceipt}
      controls={{
        busy,
        editable,
        canRegenerate,
        canAskQuestion,
        canExport,
        canDelete,
        canCancelRemote,
      }}
      speakerNames={speakerNames}
      newNote={newNote}
      onNewNoteChange={setNewNote}
      onCreateNote={createNote}
      searchQuery={searchQuery}
      searchHits={searchHits}
      searching={searching}
      onSearchQueryChange={setSearchQuery}
      onSearch={searchTranscript}
      question={question}
      askingQuestion={askingQuestion}
      onQuestionChange={setQuestion}
      onAskQuestion={askQuestion}
      onForgetQuestion={forgetQuestion}
      onBack={onBack}
      onTitleSet={onTitleSet}
      onSpeakerRename={onSpeakerRename}
      onSpeakerMerge={onSpeakerMerge}
      onSegmentEdit={onSegmentEdit}
      onNoteUpdate={onNoteUpdate}
      onNoteDelete={onNoteDelete}
      onRegenerate={onRegenerate}
      onExport={onExport}
      onRemoteCancel={onRemoteCancel}
      onDelete={onDelete}
    />
  );
};


interface MeetingReviewControls {
  busy: boolean;
  editable: boolean;
  canRegenerate: boolean;
  canAskQuestion: boolean;
  canExport: boolean;
  canDelete: boolean;
  canCancelRemote: boolean;
}

interface MeetingReviewBodyProps {
  snapshot: MeetingReviewSnapshot;
  lastReceipt: OperationReceipt | null;
  controls: MeetingReviewControls;
  speakerNames: Record<string, string>;
  newNote: string;
  onNewNoteChange: (value: string) => void;
  onCreateNote: () => void;
  searchQuery: string;
  searchHits: MeetingSearchHit[];
  searching: boolean;
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void;
  question: string;
  askingQuestion: boolean;
  onQuestionChange: (value: string) => void;
  onAskQuestion: () => void;
  onForgetQuestion: (questionId: string) => void;
  onBack: () => void;
  onTitleSet: (title: string) => void;
  onSpeakerRename: (speakerId: SpeakerId, displayName: string) => void;
  onSpeakerMerge: (sourceSpeakerId: SpeakerId, targetSpeakerId: SpeakerId) => void;
  onSegmentEdit: (
    segmentId: string,
    replacementText: string,
    removed: boolean,
  ) => void;
  onNoteUpdate: (note: ManualNote, body: string) => void;
  onNoteDelete: (note: ManualNote) => void;
  onRegenerate: () => void;
  onExport: (format: MeetingExportFormat) => void;
  onRemoteCancel: () => void;
  onDelete: () => void;
}

const MeetingReviewBody: React.FC<MeetingReviewBodyProps> = (props) => (
  <div className="meetings-page meetings-review">
    <MeetingReviewHeader
      snapshot={props.snapshot}
      lastReceipt={props.lastReceipt}
      busy={props.controls.busy}
      editable={props.controls.editable}
      onBack={props.onBack}
      onTitleSet={props.onTitleSet}
    />
    <MeetingReviewStatusAndTimeline snapshot={props.snapshot} />
    <MeetingTranscriptSection
      snapshot={props.snapshot}
      speakerNames={props.speakerNames}
      busy={props.controls.busy}
      editable={props.controls.editable}
      onSegmentEdit={props.onSegmentEdit}
    />
    <MeetingSpeakersSection
      snapshot={props.snapshot}
      busy={props.controls.busy}
      editable={props.controls.editable}
      onSpeakerRename={props.onSpeakerRename}
      onSpeakerMerge={props.onSpeakerMerge}
    />
    <MeetingNotesAndArtifacts
      snapshot={props.snapshot}
      busy={props.controls.busy}
      editable={props.controls.editable}
      canRegenerate={props.controls.canRegenerate}
      newNote={props.newNote}
      onNewNoteChange={props.onNewNoteChange}
      onCreateNote={props.onCreateNote}
      onNoteUpdate={props.onNoteUpdate}
      onNoteDelete={props.onNoteDelete}
      onRegenerate={props.onRegenerate}
    />
    <MeetingQuestionsAndSearch
      snapshot={props.snapshot}
      canAskQuestion={props.controls.canAskQuestion}
      question={props.question}
      askingQuestion={props.askingQuestion}
      onQuestionChange={props.onQuestionChange}
      onAskQuestion={props.onAskQuestion}
      onForgetQuestion={props.onForgetQuestion}
      searchQuery={props.searchQuery}
      searchHits={props.searchHits}
      searching={props.searching}
      onSearchQueryChange={props.onSearchQueryChange}
      onSearch={props.onSearch}
    />
    <MeetingReviewActions
      snapshot={props.snapshot}
      busy={props.controls.busy}
      canExport={props.controls.canExport}
      canDelete={props.controls.canDelete}
      canCancelRemote={props.controls.canCancelRemote}
      onExport={props.onExport}
      onRemoteCancel={props.onRemoteCancel}
      onDelete={props.onDelete}
    />
  </div>
);

interface MeetingReviewHeaderProps {
  snapshot: MeetingReviewSnapshot;
  lastReceipt: OperationReceipt | null;
  busy: boolean;
  editable: boolean;
  onBack: () => void;
  onTitleSet: (title: string) => void;
}

const MeetingReviewHeader: React.FC<MeetingReviewHeaderProps> = ({
  snapshot,
  lastReceipt,
  busy,
  editable,
  onBack,
  onTitleSet,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <header className="settings-page-header meetings-page-header">
        <button type="button" className="meeting-back-button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          {t("meetings.actions.back")}
        </button>
        <div className="meeting-review-title-row">
          <MeetingTitleEditor
            key={
              snapshot.session.session_id +
              ":" +
              snapshot.session.revision +
              ":" +
              snapshot.session.title
            }
            title={snapshot.session.title}
            disabled={busy || !editable}
            onTitleSet={onTitleSet}
          />
          <div className="meeting-live-statuses">
            <MeetingPhaseBadge phase={snapshot.session.phase} />
            <CaptureCompletenessBadge
              completeness={snapshot.session.capture_completeness}
            />
          </div>
        </div>
        <p className="settings-page-description">
          {snapshot.session.started_at_utc_ms === null
            ? t("meetings.review.noStartTime")
            : t("meetings.review.started", {
                date: formatMeetingDate(snapshot.session.started_at_utc_ms),
              })}
        </p>
      </header>
      {lastReceipt?.session_id === snapshot.session.session_id ? (
        <MeetingReceipt receipt={lastReceipt} />
      ) : null}
    </>
  );
};

interface MeetingTitleEditorProps {
  title: string;
  disabled: boolean;
  onTitleSet: (title: string) => void;
}

const MeetingTitleEditor: React.FC<MeetingTitleEditorProps> = ({
  title,
  disabled,
  onTitleSet,
}) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [canSave, setCanSave] = useState(false);

  const save = () => {
    const nextTitle = inputRef.current?.value.trim() ?? "";
    if (nextTitle.length === 0 || nextTitle === title) return;
    onTitleSet(nextTitle);
  };

  return (
    <div className="meeting-title-editor">
      <label htmlFor="meeting-review-title">
        {t("meetings.review.meetingTitle")}
      </label>
      <div>
        <input
          ref={inputRef}
          id="meeting-review-title"
          defaultValue={title}
          onChange={(event) => {
            const nextTitle = event.target.value.trim();
            setCanSave(nextTitle.length > 0 && nextTitle !== title);
          }}
          disabled={disabled}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={save}
          disabled={disabled || !canSave}
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
};
interface MeetingReceiptProps {
  receipt: OperationReceipt;
}

const MeetingReceipt: React.FC<MeetingReceiptProps> = ({ receipt }) => {
  const { t } = useTranslation();

  return (
    <section className="meeting-receipt" aria-live="polite">
      <strong>{t("meetings.receipts.title")}</strong>
      <span>
        {receipt.new_revision === null
          ? t("meetings.receipts.saved")
          : t("meetings.receipts.savedRevision", {
              revision: receipt.new_revision,
            })}
      </span>
      {receipt.reason_codes.length > 0 ? (
        <span>
          {receipt.reason_codes
            .map((reason) => t(meetingReasonKey(reason)))
            .join(" · ")}
        </span>
      ) : null}
    </section>
  );
};


const MeetingReviewStatusAndTimeline: React.FC<{
  snapshot: MeetingReviewSnapshot;
}> = ({ snapshot }) => {
  const { t } = useTranslation();

  return (
    <>
      <section
        className="meeting-review-section"
        aria-labelledby="meeting-review-status"
      >
        <div className="meeting-section-heading">
          <div>
            <h2 id="meeting-review-status">{t("meetings.review.status")}</h2>
            <p>{t("meetings.review.statusDescription")}</p>
          </div>
        </div>
        <div className="meeting-source-grid">
          {snapshot.session.sources.map((source) => (
            <SourceHealthCard key={source.source_kind} source={source} />
          ))}
        </div>
        <ProcessingStatusLine status={snapshot.session.processing_status} />
      </section>

      <section
        className="meeting-review-section"
        aria-labelledby="meeting-timeline"
      >
        <div className="meeting-section-heading">
          <div>
            <h2 id="meeting-timeline">{t("meetings.review.timeline")}</h2>
            <p>{t("meetings.review.timelineDescription")}</p>
          </div>
        </div>
        {snapshot.gaps.length > 0 ? (
          <div className="meeting-gap-list">
            {snapshot.gaps.map((gap) => (
              <div
                key={
                  gap.track_id +
                  ":" +
                  gap.epoch +
                  ":" +
                  (gap.start_offset_ns ?? "start")
                }
                className="meeting-gap-row"
              >
                <span>{t("meetings.review.gap")}</span>
                <span>
                  {gap.start_offset_ns === null
                    ? t("meetings.review.timeUnknown")
                    : formatMeetingOffset(gap.start_offset_ns)}
                  {" – "}
                  {gap.end_offset_ns === null
                    ? t("meetings.review.timeUnknown")
                    : formatMeetingOffset(gap.end_offset_ns)}
                </span>
                <span>{t("meetings.gaps." + gap.reason)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="meeting-empty-state">{t("meetings.review.noGaps")}</p>
        )}
      </section>
    </>
  );
};

interface MeetingTranscriptSectionProps {
  snapshot: MeetingReviewSnapshot;
  speakerNames: Record<string, string>;
  busy: boolean;
  editable: boolean;
  onSegmentEdit: (
    segmentId: string,
    replacementText: string,
    removed: boolean,
  ) => void;
}

const MeetingTranscriptSection: React.FC<MeetingTranscriptSectionProps> = ({
  snapshot,
  speakerNames,
  busy,
  editable,
  onSegmentEdit,
}) => {
  const { t } = useTranslation();

  return (
    <section
      className="meeting-review-section"
      aria-labelledby="meeting-transcript"
    >
      <div className="meeting-section-heading">
        <div>
          <h2 id="meeting-transcript">{t("meetings.review.transcript")}</h2>
          <p>{t("meetings.review.transcriptDescription")}</p>
        </div>
      </div>
      {snapshot.transcript.length === 0 ? (
        <p className="meeting-empty-state">
          {t("meetings.review.noTranscript")}
        </p>
      ) : (
        <ol className="meeting-transcript-list">
          {snapshot.transcript.map((segment) => {
            const text = segment.replacement_text ?? segment.base.text;
            return (
              <li
                key={segment.base.segment_id}
                className="meeting-transcript-segment"
                data-removed={segment.removed || undefined}
              >
                <div className="meeting-transcript-meta">
                  <span>{formatMeetingOffset(segment.base.start_offset_ns)}</span>
                  <span>
                    {speakerNames[segment.assigned_speaker_id] ??
                      t("meetings.review.unknownSpeaker")}
                  </span>
                </div>
                <textarea
                  key={
                    segment.base.segment_id +
                    ":" +
                    (segment.edit_revision ?? "base")
                  }
                  defaultValue={text}
                  aria-label={t("meetings.review.transcriptSegment")}
                  disabled={busy || !editable}
                  onBlur={(event) => {
                    const nextText = event.target.value.trim();
                    if (nextText !== text && nextText.length > 0) {
                      onSegmentEdit(segment.base.segment_id, nextText, false);
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="danger-ghost"
                  size="sm"
                  onClick={() => onSegmentEdit(segment.base.segment_id, text, true)}
                  disabled={busy || !editable || segment.removed}
                >
                  {t("meetings.review.removeSegment")}
                </Button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};

interface MeetingSpeakersSectionProps {
  snapshot: MeetingReviewSnapshot;
  busy: boolean;
  editable: boolean;
  onSpeakerRename: (speakerId: SpeakerId, displayName: string) => void;
  onSpeakerMerge: (sourceSpeakerId: SpeakerId, targetSpeakerId: SpeakerId) => void;
}

const MeetingSpeakersSection: React.FC<MeetingSpeakersSectionProps> = ({
  snapshot,
  busy,
  editable,
  onSpeakerRename,
  onSpeakerMerge,
}) => {
  const { t } = useTranslation();
  const disabled = busy || !editable;
  const speakerKey = snapshot.speakers
    .map((speaker) => speaker.speaker_id + ":" + speaker.revision)
    .join("|");

  return (
    <section
      className="meeting-review-section"
      aria-labelledby="meeting-speakers"
    >
      <div className="meeting-section-heading">
        <div>
          <h2 id="meeting-speakers">{t("meetings.review.speakers")}</h2>
          <p>
            {t("meetings.review.speakersDescription")}
            {" · "}
            {t("meetings.diarization." + snapshot.diarization.status)}
          </p>
        </div>
      </div>
      {snapshot.speakers.length === 0 ? (
        <p className="meeting-empty-state">
          {t("meetings.review.noSpeakers")}
        </p>
      ) : (
        <>
          <ul className="meeting-speaker-list">
            {snapshot.speakers.map((speaker) => (
              <SpeakerRow
                key={speaker.speaker_id + ":" + speaker.revision + ":" + speaker.display_name}
                speakerId={speaker.speaker_id}
                name={speaker.display_name}
                disabled={disabled}
                onRename={onSpeakerRename}
              />
            ))}
          </ul>
          {snapshot.speakers.length > 1 ? (
            <MeetingSpeakerMerge
              key={speakerKey}
              speakers={snapshot.speakers}
              disabled={disabled}
              onMerge={onSpeakerMerge}
            />
          ) : null}
        </>
      )}
    </section>
  );
};

interface MeetingSpeakerMergeProps {
  speakers: MeetingReviewSnapshot["speakers"];
  disabled: boolean;
  onMerge: (sourceSpeakerId: SpeakerId, targetSpeakerId: SpeakerId) => void;
}

const MeetingSpeakerMerge: React.FC<MeetingSpeakerMergeProps> = ({
  speakers,
  disabled,
  onMerge,
}) => {
  const { t } = useTranslation();
  const [source, setSource] = useState<SpeakerId>(
    speakers[0]?.speaker_id ?? "",
  );
  const [target, setTarget] = useState<SpeakerId>(
    speakers[1]?.speaker_id ?? "",
  );
  const canMerge =
    !disabled && source.length > 0 && target.length > 0 && source !== target;

  return (
    <div className="meeting-speaker-merge">
      <select
        value={source}
        onChange={(event) => setSource(event.target.value)}
        aria-label={t("meetings.review.mergeSource")}
        disabled={disabled}
      >
        {speakers.map((speaker) => (
          <option key={speaker.speaker_id} value={speaker.speaker_id}>
            {speaker.display_name}
          </option>
        ))}
      </select>
      <select
        value={target}
        onChange={(event) => setTarget(event.target.value)}
        aria-label={t("meetings.review.mergeTarget")}
        disabled={disabled}
      >
        {speakers.map((speaker) => (
          <option key={speaker.speaker_id} value={speaker.speaker_id}>
            {speaker.display_name}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onMerge(source, target)}
        disabled={!canMerge}
      >
        {t("meetings.review.merge")}
      </Button>
    </div>
  );
};


interface MeetingNotesAndArtifactsProps {
  snapshot: MeetingReviewSnapshot;
  busy: boolean;
  editable: boolean;
  canRegenerate: boolean;
  newNote: string;
  onNewNoteChange: (value: string) => void;
  onCreateNote: () => void;
  onNoteUpdate: (note: ManualNote, body: string) => void;
  onNoteDelete: (note: ManualNote) => void;
  onRegenerate: () => void;
}

const MeetingNotesAndArtifacts: React.FC<MeetingNotesAndArtifactsProps> = (
  props,
) => (
  <>
    <MeetingManualNotes
      snapshot={props.snapshot}
      busy={props.busy}
      editable={props.editable}
      newNote={props.newNote}
      onNewNoteChange={props.onNewNoteChange}
      onCreateNote={props.onCreateNote}
      onNoteUpdate={props.onNoteUpdate}
      onNoteDelete={props.onNoteDelete}
    />
    <MeetingGeneratedArtifacts
      snapshot={props.snapshot}
      busy={props.busy}
      canRegenerate={props.canRegenerate}
      onRegenerate={props.onRegenerate}
    />
  </>
);

interface MeetingManualNotesProps {
  snapshot: MeetingReviewSnapshot;
  busy: boolean;
  editable: boolean;
  newNote: string;
  onNewNoteChange: (value: string) => void;
  onCreateNote: () => void;
  onNoteUpdate: (note: ManualNote, body: string) => void;
  onNoteDelete: (note: ManualNote) => void;
}

const MeetingManualNotes: React.FC<MeetingManualNotesProps> = ({
  snapshot,
  busy,
  editable,
  newNote,
  onNewNoteChange,
  onCreateNote,
  onNoteUpdate,
  onNoteDelete,
}) => {
  const { t } = useTranslation();
  const disabled = busy || !editable;

  return (
    <section className="meeting-review-section" aria-labelledby="meeting-notes">
      <div className="meeting-section-heading">
        <div>
          <h2 id="meeting-notes">{t("meetings.review.manualNotes")}</h2>
          <p>{t("meetings.review.manualNotesDescription")}</p>
        </div>
      </div>
      <textarea
        value={newNote}
        onChange={(event) => onNewNoteChange(event.target.value)}
        placeholder={t("meetings.review.notePlaceholder")}
        aria-label={t("meetings.review.newNote")}
        disabled={disabled}
      />
      <div className="meeting-note-actions">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onCreateNote}
          disabled={disabled || newNote.trim().length === 0}
        >
          {t("meetings.review.addNote")}
        </Button>
      </div>
      {snapshot.notes.length === 0 ? (
        <p className="meeting-empty-state">{t("meetings.review.noNotes")}</p>
      ) : (
        <ul className="meeting-manual-note-list">
          {snapshot.notes.map((note) => (
            <ManualNoteEditor
              key={note.note_id + ":" + note.revision + ":" + note.body}
              note={note}
              disabled={disabled}
              onUpdate={onNoteUpdate}
              onDelete={onNoteDelete}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

interface MeetingGeneratedArtifactsProps {
  snapshot: MeetingReviewSnapshot;
  busy: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
}

const MeetingGeneratedArtifacts: React.FC<MeetingGeneratedArtifactsProps> = ({
  snapshot,
  busy,
  canRegenerate,
  onRegenerate,
}) => {
  const { t } = useTranslation();

  return (
    <section
      className="meeting-review-section meeting-generated-notes"
      aria-labelledby="meeting-generated-notes"
    >
      <div className="meeting-section-heading">
        <div>
          <h2 id="meeting-generated-notes">
            {t("meetings.review.generatedNotes")}
          </h2>
          <p>{t("meetings.review.generatedNotesDescription")}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRegenerate}
          disabled={busy || !canRegenerate}
        >
          <RefreshCcw size={14} aria-hidden="true" />
          {t("meetings.review.regenerate")}
        </Button>
      </div>
      {snapshot.artifacts.length === 0 ? (
        <p className="meeting-empty-state">
          {t("meetings.review.noGeneratedNotes")}
        </p>
      ) : (
        <div className="meeting-artifact-list">
          {snapshot.artifacts.map((artifact) => (
            <MeetingArtifactCard key={artifact.artifact_id} artifact={artifact} />
          ))}
        </div>
      )}
    </section>
  );
};

interface MeetingArtifactCardProps {
  artifact: MeetingReviewSnapshot["artifacts"][number];
}

const MeetingArtifactCard: React.FC<MeetingArtifactCardProps> = ({
  artifact,
}) => {
  const { t } = useTranslation();
  const content = artifact.content;

  return (
    <article className="meeting-artifact">
      <header>
        <div>
          <h3>
            {t("meetings.review.template", {
              template: artifact.template_id,
            })}
          </h3>
          <p>
            {t("meetings.review.artifactRevision", {
              templateVersion: artifact.template_version,
              revision: artifact.input_revision,
            })}
          </p>
        </div>
        <span data-state={artifact.state}>
          {t("meetings.artifactState." + artifact.state)}
        </span>
      </header>
      {content ? (
        <div className="meeting-artifact-content">
          <section>
            <h4>{t("meetings.review.summary")}</h4>
            <CitedText value={content.summary} />
          </section>
          <section>
            <h4>{t("meetings.review.topics")}</h4>
            {content.outline.length === 0 ? (
              <p>{t("meetings.review.none")}</p>
            ) : (
              <ul>
                {content.outline.map((topic, index) => (
                  <li key={artifact.artifact_id + ":topic:" + index}>
                    <CitedText value={topic.title} />
                    {topic.detail ? <CitedText value={topic.detail} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4>{t("meetings.review.decisions")}</h4>
            {content.decisions.length === 0 ? (
              <p>{t("meetings.review.none")}</p>
            ) : (
              <ul>
                {content.decisions.map((decision, index) => (
                  <li key={artifact.artifact_id + ":decision:" + index}>
                    <CitedText value={decision} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4>{t("meetings.review.actions")}</h4>
            {content.action_items.length === 0 ? (
              <p>{t("meetings.review.none")}</p>
            ) : (
              <ul>
                {content.action_items.map((action, index) => (
                  <li key={artifact.artifact_id + ":action:" + index}>
                    <CitedText value={action.text} />
                    <p>
                      {t("meetings.review.actionMeta", {
                        owner:
                          action.owner_text ??
                          t("meetings.review.unassigned"),
                        due:
                          action.due_text ??
                          t("meetings.review.noDueDate"),
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4>{t("meetings.review.keyQuestions")}</h4>
            {content.key_questions.length === 0 ? (
              <p>{t("meetings.review.none")}</p>
            ) : (
              <ul>
                {content.key_questions.map((item, index) => (
                  <li key={artifact.artifact_id + ":question:" + index}>
                    <CitedText value={item} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4>{t("meetings.review.risks")}</h4>
            {content.risks.length === 0 ? (
              <p>{t("meetings.review.none")}</p>
            ) : (
              <ul>
                {content.risks.map((item, index) => (
                  <li key={artifact.artifact_id + ":risk:" + index}>
                    <CitedText value={item} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4>{t("meetings.review.followUp")}</h4>
            <CitedText value={content.follow_up_draft} />
          </section>
        </div>
      ) : (
        <p className="meeting-empty-state">
          {t("meetings.review.artifactUnavailable")}
        </p>
      )}
    </article>
  );
};


interface MeetingQuestionsAndSearchProps {
  snapshot: MeetingReviewSnapshot;
  canAskQuestion: boolean;
  question: string;
  askingQuestion: boolean;
  onQuestionChange: (value: string) => void;
  onAskQuestion: () => void;
  onForgetQuestion: (questionId: string) => void;
  searchQuery: string;
  searchHits: MeetingSearchHit[];
  searching: boolean;
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void;
}

const MeetingQuestionsAndSearch: React.FC<MeetingQuestionsAndSearchProps> = ({
  snapshot,
  canAskQuestion,
  question,
  askingQuestion,
  onQuestionChange,
  onAskQuestion,
  onForgetQuestion,
  searchQuery,
  searchHits,
  searching,
  onSearchQueryChange,
  onSearch,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <section
        className="meeting-review-section"
        aria-labelledby="meeting-questions"
      >
        <div className="meeting-section-heading">
          <div>
            <h2 id="meeting-questions">{t("meetings.review.questions")}</h2>
            <p>{t("meetings.review.questionsDescription")}</p>
          </div>
        </div>
        <div className="meeting-question-composer">
          <textarea
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            placeholder={t("meetings.review.questionPlaceholder")}
            aria-label={t("meetings.review.questions")}
            disabled={!canAskQuestion || askingQuestion}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onAskQuestion}
            disabled={
              !canAskQuestion ||
              askingQuestion ||
              question.trim().length === 0
            }
          >
            {t("meetings.review.ask")}
          </Button>
        </div>
        {snapshot.questions.length === 0 ? (
          <p className="meeting-empty-state">
            {t("meetings.review.noQuestions")}
          </p>
        ) : (
          <ul className="meeting-question-list">
            {snapshot.questions.map((answer) => (
              <li key={answer.question_id + ":" + answer.revision}>
                <div>
                  <strong>
                    {answer.question ?? t("meetings.review.question")}
                  </strong>
                  <span data-state={answer.state}>
                    {t("meetings.answerState." + answer.state)}
                  </span>
                </div>
                <p>
                  {answer.answer ?? t("meetings.review.insufficientEvidence")}
                </p>
                {answer.citations.length > 0 ? (
                  <div className="meeting-citation-list">
                    {answer.citations.map((citation) => (
                      <span
                        key={answer.question_id + ":" + citation.entity_id}
                      >
                        {t("meetings.review.citation", {
                          time: formatMeetingOffset(citation.start_offset_ns),
                        })}
                      </span>
                    ))}
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onForgetQuestion(answer.question_id)}
                  disabled={askingQuestion || answer.state === "forgotten"}
                >
                  {t("meetings.review.forget")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="meeting-review-section"
        aria-labelledby="meeting-search"
      >
        <div className="meeting-section-heading">
          <div>
            <h2 id="meeting-search">{t("meetings.review.exactSearch")}</h2>
            <p>{t("meetings.review.exactSearchDescription")}</p>
          </div>
        </div>
        <div className="meeting-search-form">
          <input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={t("meetings.review.searchPlaceholder")}
            aria-label={t("meetings.review.exactSearch")}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onSearch}
            disabled={searching || searchQuery.trim().length === 0}
          >
            <Search size={14} aria-hidden="true" />
            {t("meetings.review.search")}
          </Button>
        </div>
        {searchHits.length > 0 ? (
          <ul className="meeting-search-results">
            {searchHits.map((hit) => (
              <li
                key={
                  hit.kind +
                  ":" +
                  hit.entity_id +
                  ":" +
                  (hit.start_offset_ns ?? "start")
                }
              >
                <span>{formatMeetingOffset(hit.start_offset_ns)}</span>
                <p>{hit.excerpt}</p>
              </li>
            ))}
          </ul>
        ) : searchQuery.trim().length > 0 && !searching ? (
          <p className="meeting-empty-state">
            {t("meetings.review.noSearchResults")}
          </p>
        ) : null}
      </section>
    </>
  );
};

interface MeetingReviewActionsProps {
  snapshot: MeetingReviewSnapshot;
  busy: boolean;
  canExport: boolean;
  canDelete: boolean;
  canCancelRemote: boolean;
  onExport: (format: MeetingExportFormat) => void;
  onRemoteCancel: () => void;
  onDelete: () => void;
}

const MeetingReviewActions: React.FC<MeetingReviewActionsProps> = ({
  snapshot,
  busy,
  canExport,
  canDelete,
  canCancelRemote,
  onExport,
  onRemoteCancel,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      {snapshot.remote_cancellation_pending ? (
        <Alert variant="warning" contained>
          <span>{t("meetings.review.remoteCancellationPending")}</span>
          <button
            type="button"
            className="meeting-alert-action"
            onClick={onRemoteCancel}
            disabled={busy || !canCancelRemote}
          >
            {t("meetings.review.cancelRemote")}
          </button>
        </Alert>
      ) : null}

      <section
        className="meeting-review-section meeting-export-section"
        aria-labelledby="meeting-export"
      >
        <div className="meeting-section-heading">
          <div>
            <h2 id="meeting-export">{t("meetings.review.export")}</h2>
            <p>{t("meetings.review.exportDescription")}</p>
          </div>
        </div>
        <div className="meeting-export-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onExport("markdown")}
            disabled={busy || !canExport}
          >
            <FileText size={15} aria-hidden="true" />
            {t("meetings.review.exportMarkdown")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onExport("json")}
            disabled={busy || !canExport}
          >
            <FileJson size={15} aria-hidden="true" />
            {t("meetings.review.exportJson")}
          </Button>
          <Button
            type="button"
            variant="danger-ghost"
            onClick={() => setDeleteOpen(true)}
            disabled={busy || !canDelete}
          >
            <Trash2 size={15} aria-hidden="true" />
            {t("meetings.actions.delete")}
          </Button>
        </div>
        <CloudMeetingActions sessionId={snapshot.session.session_id} />
      </section>

      <Dialog
        open={deleteOpen}
        title={t("meetings.delete.title")}
        description={t("meetings.delete.description")}
        closeLabel={t("common.cancel")}
        onOpenChange={setDeleteOpen}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setDeleteOpen(false);
                onDelete();
              }}
            >
              {t("meetings.actions.delete")}
            </Button>
          </>
        }
      >
        <p>{t("meetings.delete.explainsData")}</p>
      </Dialog>
    </>
  );
};
