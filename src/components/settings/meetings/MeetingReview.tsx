import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, FileJson, FileText, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type ManualNote,
  type MeetingExportFormat,
  type MeetingReviewSnapshot,
  type MeetingSearchHit,
  type OperationReceipt,
  type SpeakerId,
} from "@/bindings";
import {
  Alert,
  Button,
  Dialog,
  Section,
  StatusText,
  Tabs,
  type TabItem,
} from "../../ui";
import { CloudMeetingActions } from "../../cloud-sync/CloudMeetingActions";
import {
  InsightsTab,
  QuestionsTab,
  TranscriptTab,
  type SegmentJump,
} from "./MeetingReviewPanels";
import { CaptureCompletenessText, MeetingPhaseText } from "./MeetingStatus";
import {
  formatMeetingDate,
  formatMeetingOffset,
  meetingErrorKey,
  meetingReasonKey,
} from "./meetingUtils";
import {
  actionItemKey,
  getMeetingAnalytics,
  setActionItemDone,
  type MeetingAnalyticsSnapshot,
} from "./meetingAnalytics";

/* The review surface holds five jobs: read the transcript, fix it, read what
 * was generated from it, ask the meeting a question, and get the record out.
 * They are three tabs plus a persistent export bar, because a person doing
 * one of them is never doing the others at the same time.
 *
 * A citation is a jump: every generated claim, saved answer and search hit
 * that points at a transcript segment scrolls that segment into view and
 * marks it, which is the whole reason citations exist. */

const REVIEW_TAB_IDS = ["transcript", "insights", "questions"] as const;

type ReviewTab = (typeof REVIEW_TAB_IDS)[number];

const REVIEW_PANEL_ID = "meeting-review-panel";

interface MeetingReviewProps {
  snapshot: MeetingReviewSnapshot;
  lastReceipt: OperationReceipt | null;
  pendingAction: string | null;
  onBack: () => void;
  onTitleSet: (title: string) => void;
  onSpeakerRename: (speakerId: SpeakerId, displayName: string) => void;
  onSpeakerMerge: (
    sourceSpeakerId: SpeakerId,
    targetSpeakerId: SpeakerId,
  ) => void;
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
  const [tab, setTab] = useState<ReviewTab>("transcript");
  const [jump, setJump] = useState<SegmentJump | null>(null);
  const [newNote, setNewNote] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<MeetingSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [question, setQuestion] = useState("");
  const [askingQuestion, setAskingQuestion] = useState(false);
  const [analytics, setAnalytics] = useState<MeetingAnalyticsSnapshot | null>(
    null,
  );
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
  const speakerNames: Record<string, string> = {};
  for (const speaker of snapshot.speakers) {
    speakerNames[speaker.speaker_id] = speaker.display_name;
  }

  /* Metrics are derived from the transcript, so they are re-read whenever the
   * transcript could have moved: a new session revision means an edit, a
   * regeneration or a finished processing pass. */
  const sessionId = snapshot.session.session_id;
  const revision = snapshot.session.revision;
  const loadAnalytics = useCallback(async () => {
    try {
      setAnalytics(await getMeetingAnalytics(sessionId));
    } catch {
      setAnalytics(null);
    }
  }, [sessionId]);

  const analyticsRevision = useRef<number | null>(null);
  useEffect(() => {
    if (analyticsRevision.current === revision) return;
    analyticsRevision.current = revision;
    void loadAnalytics();
  }, [loadAnalytics, revision]);

  const doneActionItems = new Set(
    (analytics?.action_items ?? [])
      .filter((state) => state.done)
      .map((state) => actionItemKey(state.artifact_id, state.action_index)),
  );

  const toggleActionItem = async (
    artifactId: string,
    actionIndex: number,
    done: boolean,
  ) => {
    try {
      const states = await setActionItemDone({
        session_id: sessionId,
        artifact_id: artifactId,
        action_index: actionIndex,
        done,
      });
      setAnalytics((current) =>
        current === null ? current : { ...current, action_items: states },
      );
    } catch {
      toast.error(t("meetings.errors.operation"));
    }
  };

  const selectTab = (id: string) => {
    const next = REVIEW_TAB_IDS.find((candidate) => candidate === id);
    if (next) setTab(next);
  };

  const jumpToSegment = (segmentId: string) => {
    setTab("transcript");
    setJump((current) => ({ segmentId, nonce: (current?.nonce ?? 0) + 1 }));
  };

  const createNote = () => {
    const body = newNote.trim();
    if (body.length === 0) return;
    onNoteCreate(body);
    setNewNote("");
  };

  const searchTranscript = async () => {
    const query = searchQuery.trim();
    if (query.length === 0) {
      setSearchHits(null);
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

  const tabItems: TabItem[] = [
    {
      id: "transcript",
      label: t("meetings.review.tabs.transcript", "Transcript"),
      panelId: REVIEW_PANEL_ID,
    },
    {
      id: "insights",
      label: t("meetings.review.tabs.insights", "Insights"),
      panelId: REVIEW_PANEL_ID,
    },
    {
      id: "questions",
      label: t("meetings.review.tabs.questions", "Q&A"),
      panelId: REVIEW_PANEL_ID,
    },
  ];

  return (
    <div className="settings-page">
      <MeetingReviewHeader
        snapshot={snapshot}
        lastReceipt={lastReceipt}
        busy={busy}
        editable={editable}
        onBack={onBack}
        onTitleSet={onTitleSet}
      />

      {snapshot.remote_cancellation_pending ? (
        <Alert
          variant="warning"
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRemoteCancel}
              disabled={busy || !canCancelRemote}
            >
              {t("meetings.review.cancelRemote")}
            </Button>
          }
        >
          {t("meetings.review.remoteCancellationPending")}
        </Alert>
      ) : null}

      <div className="pt-1">
        <Tabs
          items={tabItems}
          value={tab}
          onChange={selectTab}
          label={t("meetings.review.tabsLabel", "Meeting review sections")}
        />
      </div>

      <div
        id={REVIEW_PANEL_ID}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        tabIndex={-1}
        className="flex flex-col gap-7"
      >
        {tab === "transcript" ? (
          <TranscriptTab
            snapshot={snapshot}
            speakerNames={speakerNames}
            busy={busy}
            editable={editable}
            jump={jump}
            searchQuery={searchQuery}
            searchHits={searchHits}
            searching={searching}
            onSearchQueryChange={setSearchQuery}
            onSearch={searchTranscript}
            onJumpToSegment={jumpToSegment}
            onSegmentEdit={onSegmentEdit}
            onSpeakerRename={onSpeakerRename}
            onSpeakerMerge={onSpeakerMerge}
          />
        ) : tab === "insights" ? (
          <InsightsTab
            snapshot={snapshot}
            busy={busy}
            editable={editable}
            canRegenerate={canRegenerate}
            newNote={newNote}
            analytics={analytics?.analytics ?? null}
            speakerNames={speakerNames}
            doneActionItems={doneActionItems}
            onNewNoteChange={setNewNote}
            onCreateNote={createNote}
            onNoteUpdate={onNoteUpdate}
            onNoteDelete={onNoteDelete}
            onRegenerate={onRegenerate}
            onJumpToSegment={jumpToSegment}
            onActionItemToggle={(artifactId, actionIndex, done) =>
              void toggleActionItem(artifactId, actionIndex, done)
            }
            onRefresh={onRefresh}
            onAnalyticsRefresh={loadAnalytics}
          />
        ) : (
          <QuestionsTab
            snapshot={snapshot}
            canAskQuestion={canAskQuestion}
            question={question}
            askingQuestion={askingQuestion}
            onQuestionChange={setQuestion}
            onAskQuestion={askQuestion}
            onForgetQuestion={forgetQuestion}
            onJumpToSegment={jumpToSegment}
          />
        )}
      </div>

      <MeetingExportBar
        snapshot={snapshot}
        busy={busy}
        canExport={canExport}
        canDelete={canDelete}
        onExport={onExport}
        onDelete={onDelete}
      />
    </div>
  );
};

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
  const elapsedOffsetNs = snapshot.session.elapsed_offset_ns;

  return (
    <header className="settings-page-header flex flex-col gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ms-2.5 self-start"
        onClick={onBack}
      >
        <ArrowLeft size={14} aria-hidden="true" />
        {t("meetings.actions.back")}
      </Button>
      <MeetingTitleEditor
        key={`${snapshot.session.session_id}:${snapshot.session.revision}:${snapshot.session.title}`}
        title={snapshot.session.title}
        disabled={busy || !editable}
        onTitleSet={onTitleSet}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <MeetingPhaseText phase={snapshot.session.phase} />
        <CaptureCompletenessText
          completeness={snapshot.session.capture_completeness}
        />
        <StatusText tone="muted">
          {snapshot.session.started_at_utc_ms === null
            ? t("meetings.review.noStartTime")
            : t("meetings.review.started", {
                date: formatMeetingDate(snapshot.session.started_at_utc_ms),
              })}
        </StatusText>
        {elapsedOffsetNs === null ? null : (
          <StatusText tone="muted" className="tabular-nums">
            {t("meetings.review.captured", "Captured {{time}}", {
              time: formatMeetingOffset(elapsedOffsetNs),
            })}
          </StatusText>
        )}
      </div>
      {lastReceipt?.session_id === snapshot.session.session_id ? (
        <MeetingReceipt receipt={lastReceipt} />
      ) : null}
    </header>
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
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <label className="microlabel mb-1 block" htmlFor="meeting-review-title">
          {t("meetings.review.meetingTitle")}
        </label>
        <input
          ref={inputRef}
          id="meeting-review-title"
          defaultValue={title}
          onChange={(event) => {
            const nextTitle = event.target.value.trim();
            setCanSave(nextTitle.length > 0 && nextTitle !== title);
          }}
          disabled={disabled}
          className="w-full border-0 border-b border-border bg-transparent pb-1 text-[20px] leading-7 font-semibold tracking-[-0.022em] text-text-primary outline-offset-2 transition-[border-color] duration-150 ease-out enabled:hover:border-border-strong disabled:cursor-not-allowed disabled:text-text-disabled"
        />
      </div>
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
  );
};

interface MeetingReceiptProps {
  receipt: OperationReceipt;
}

const MeetingReceipt: React.FC<MeetingReceiptProps> = ({ receipt }) => {
  const { t } = useTranslation();
  const reasons = receipt.reason_codes
    .map((reason) => t(meetingReasonKey(reason)))
    .join(" · ");

  return (
    <p
      aria-live="polite"
      className="text-[12px] leading-[18px] text-text-secondary"
    >
      <span className="font-medium text-text-primary">
        {t("meetings.receipts.title")}
      </span>{" "}
      {receipt.new_revision === null
        ? t("meetings.receipts.saved")
        : t("meetings.receipts.savedRevision", {
            revision: receipt.new_revision,
          })}
      {reasons.length > 0 ? ` ${reasons}` : ""}
    </p>
  );
};

interface MeetingExportBarProps {
  snapshot: MeetingReviewSnapshot;
  busy: boolean;
  canExport: boolean;
  canDelete: boolean;
  onExport: (format: MeetingExportFormat) => void;
  onDelete: () => void;
}

const MeetingExportBar: React.FC<MeetingExportBarProps> = ({
  snapshot,
  busy,
  canExport,
  canDelete,
  onExport,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <Section
      title={t("meetings.review.export")}
      description={t("meetings.review.exportDescription")}
      className="border-t border-border-subtle pt-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => onExport("markdown")}
          disabled={busy || !canExport}
        >
          <FileText size={14} aria-hidden="true" />
          {t("meetings.review.exportMarkdown")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onExport("json")}
          disabled={busy || !canExport}
        >
          <FileJson size={14} aria-hidden="true" />
          {t("meetings.review.exportJson")}
        </Button>
        <Button
          type="button"
          variant="danger-ghost"
          className="ms-auto"
          onClick={() => setDeleteOpen(true)}
          disabled={busy || !canDelete}
        >
          <Trash2 size={14} aria-hidden="true" />
          {t("meetings.actions.delete")}
        </Button>
      </div>
      <div className="mt-4">
        <CloudMeetingActions sessionId={snapshot.session.session_id} />
      </div>

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
    </Section>
  );
};
