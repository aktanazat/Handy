import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, FileJson, FileText, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type ManualNote,
  type MeetingExportFormat,
  type MeetingLoopRow,
  type MeetingReviewSnapshot,
  type MeetingSearchHit,
  type OperationReceipt,
  type PersonListEntry,
  type SpeakerId,
} from "@/bindings";
import {
  Notice,
  PageTitle,
  SettingsPage,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/vg/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/vg/tabs";
import { CloudMeetingActions } from "../../cloud-sync/CloudMeetingActions";
import type { SegmentJump } from "./review/Citations";
import { InsightsTab } from "./review/InsightsTab";
import { QuestionsTab } from "./review/QuestionsTab";
import { TalkTimeRow } from "./review/TalkTimeRow";
import { TranscriptTab } from "./review/TranscriptTab";
import { MeetingLedgerSection } from "./MeetingLedgerSection";
import { MeetingPhaseText } from "./MeetingStatus";
import { type LoopChange } from "./review/LoopRows";
import { committedEdit, inlineEditKeys } from "./review/inlineEdit";
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
  type MeetingAnalytics,
  type MeetingAnalyticsSnapshot,
} from "./meetingAnalytics";

/* The review surface holds five jobs: read the transcript, fix it, read what
 * was generated from it, ask the meeting a question, and get the record out.
 * They are four tabs plus a persistent export bar, because a person doing one
 * of them is never doing the others at the same time.
 *
 * A citation is a jump: every generated claim, saved answer and search hit
 * that points at a transcript segment scrolls that segment into view and
 * marks it, which is the whole reason citations exist. */

const REVIEW_TAB_IDS = [
  "transcript",
  "insights",
  "ledger",
  "questions",
] as const;

type ReviewTab = (typeof REVIEW_TAB_IDS)[number];

/**
 * Which tab this record opens on, given whatever was decided before and the
 * snapshot in hand. `null` means nobody has decided yet — the record carries
 * nothing written about it, so the transcript is all there is to read.
 *
 * A decision, once made, is never revisited: `chosen` short-circuits, so a
 * refresh cannot move a reader who picked a tab and a deleted last note cannot
 * pull one off Insights. The only transition this makes is the first one, from
 * "nothing to read" to "something to read", which is exactly the moment a
 * meeting finishes processing under an open review screen.
 */
export const nextReviewTab = (
  chosen: ReviewTab | null,
  snapshot: MeetingReviewSnapshot,
): ReviewTab | null =>
  chosen ??
  (snapshot.artifacts.length > 0 || snapshot.notes.length > 0
    ? "insights"
    : null);

/* The kit's own `line` variant draws the mark; this only quiets the type and
 * moves the focus ring onto the accent. */
const TAB_TRIGGER_CLASSES =
  "flex-none px-0 text-sm font-normal text-gray-900 hover:text-gray-1000 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none data-[state=active]:text-gray-1000 after:bg-gray-1000";

/** Every review panel is a column of sections on the page's own rhythm. */
const TAB_PANEL_CLASSES = "flex flex-col gap-10";

/** How long typing settles before the store is asked for its own answer.
 * Short enough that a finished word is answered, long enough that a typed
 * word is one query rather than five. */
const SEARCH_SETTLE_MS = 250;

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
  /* D19 gives a finished meeting a title from its own content, and what is
   * written about it — the generated notes, or the ones the reader typed
   * during it — is what somebody came back for; the transcript is the evidence
   * behind them, one click away.
   *
   * Decided once, and not before there is anything to decide from. This used
   * to be a plain `useState` initialiser over `snapshot.artifacts`, which
   * reads the record exactly once: a meeting whose artifacts landed after this
   * screen did — the ordinary case, since processing finishes while you are
   * looking at it — latched "transcript" on its first, empty snapshot and
   * stayed there for the rest of the visit. `null` is "nobody has decided
   * yet", which renders the transcript, so nothing flickers while the record
   * is still arriving. Once anything is decided it is final: a later snapshot
   * cannot move a reader who chose a tab, and deleting the last note cannot
   * pull one back off Insights. */
  const [chosenTab, setChosenTab] = useState<ReviewTab | null>(() =>
    nextReviewTab(null, snapshot),
  );
  useEffect(() => {
    setChosenTab((current) => nextReviewTab(current, snapshot));
  }, [snapshot]);
  const tab = chosenTab ?? "transcript";
  const [jump, setJump] = useState<SegmentJump | null>(null);
  const [newNote, setNewNote] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<MeetingSearchHit[] | null>(null);
  const [question, setQuestion] = useState("");
  const [askingQuestion, setAskingQuestion] = useState(false);
  const [exportingLedger, setExportingLedger] = useState(false);
  const [analytics, setAnalytics] = useState<MeetingAnalyticsSnapshot | null>(
    null,
  );
  const [loops, setLoops] = useState<MeetingLoopRow[] | null>(null);
  const [people, setPeople] = useState<PersonListEntry[]>([]);
  const [loopsBusy, setLoopsBusy] = useState(false);
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

  /* Loops are the ledger's actionable half: words from the artifact, state
   * from the store. Re-read on the same trigger as the metrics, because a
   * regeneration can rewrite the rows a resolution was attached to. */
  const loadLoops = useCallback(async () => {
    const [loopsResult, peopleResult] = await Promise.all([
      commands.meetingLoops(sessionId),
      commands.peopleList(),
    ]);
    setLoops(loopsResult.status === "ok" ? loopsResult.data.rows : []);
    setPeople(peopleResult.status === "ok" ? peopleResult.data.entries : []);
  }, [sessionId]);

  const loopsRevision = useRef<number | null>(null);
  useEffect(() => {
    if (loopsRevision.current === revision) return;
    loopsRevision.current = revision;
    void loadLoops();
  }, [loadLoops, revision]);

  /* One path for all three loop commands. They differ only in the request they
   * build, and each answers with the whole refreshed list, so the row somebody
   * just ticked never has to be patched by hand. */
  const changeLoop = async (row: MeetingLoopRow, change: LoopChange) => {
    const operation_id = crypto.randomUUID();
    const loop_id = row.loop_id;
    const expected_revision = row.revision;
    setLoopsBusy(true);
    try {
      const result = await (change.kind === "resolve"
        ? commands.meetingLoopResolve({
            operation_id,
            loop_id,
            expected_revision,
            resolution: change.dropped ? "dropped" : "done",
          })
        : change.kind === "reopen"
          ? commands.meetingLoopReopen({
              operation_id,
              loop_id,
              expected_revision,
            })
          : commands.meetingLoopAssign({
              operation_id,
              loop_id,
              expected_revision,
              owner_person_id: change.personId,
            }));
      if (result.status === "error") {
        toast.error(t(meetingErrorKey(result.error)));
        await loadLoops();
        return;
      }
      setLoops(result.data.loops.rows);
      // A refused write means somebody else moved this row first; the fresh
      // list that came back with the refusal is already the truth.
      if (result.data.receipt.reason_codes.includes("stale_revision")) {
        toast.info(t("meetings.loops.stale"));
      }
    } catch {
      toast.error(t("meetings.errors.operation"));
    } finally {
      setLoopsBusy(false);
    }
  };

  const selectTab = (id: string) => {
    const next = REVIEW_TAB_IDS.find((candidate) => candidate === id);
    if (next) setChosenTab(next);
  };

  const jumpToSegment = (segmentId: string) => {
    setChosenTab("transcript");
    /* A live filter that does not contain the cited turn would swallow the
     * jump, and a citation that lands nowhere is the one thing citations
     * cannot do — so arriving clears the filter. */
    setSearchQuery("");
    setJump((current) => ({ segmentId, nonce: (current?.nonce ?? 0) + 1 }));
  };

  const createNote = () => {
    const body = newNote.trim();
    if (body.length === 0) return;
    onNoteCreate(body);
    setNewNote("");
  };

  /* The field narrows the transcript as it is typed; the store is asked once
   * the typing settles, because its index is the authority on what this
   * meeting contains and reaches the notes and the title as well. */
  const searchTranscript = useCallback(
    async (query: string) => {
      const result = await commands.meetingSearch({
        query,
        session_ids: [sessionId],
        limit: 50,
      });
      if (result.status === "error") {
        toast.error(t(meetingErrorKey(result.error)));
        return null;
      }
      return result.data.entries;
    },
    [sessionId, t],
  );

  useEffect(() => {
    /* Hits belong to the query that asked for them, so a keystroke retires
     * them: the transcript narrows on the words alone until the store answers
     * the query now in the field. */
    setSearchHits(null);
    const query = searchQuery.trim();
    if (query.length === 0) return;

    /* A slow answer to an abandoned query must not overwrite a newer one. */
    let live = true;
    const timer = window.setTimeout(() => {
      searchTranscript(query)
        .then((hits) => {
          if (live && hits !== null) setSearchHits(hits);
        })
        .catch(() => {
          if (live) toast.error(t("meetings.errors.operation"));
        });
    }, SEARCH_SETTLE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [searchQuery, searchTranscript, t]);

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

  /* The ledger page is written from an already-recorded revision, so it takes
   * no operation id and no expected revision: it mutates nothing. A cancelled
   * save dialog is the person changing their mind, not a failure, so it says
   * nothing. */
  const exportLedger = async () => {
    setExportingLedger(true);
    try {
      const result = await commands.produceLedgerHtml(
        snapshot.session.session_id,
      );
      if (result.status === "error") {
        // A cancelled save dialog is the person changing their mind.
        if (result.error === "export_cancelled") return;
        toast.error(
          result.error === "not_found"
            ? t("meetings.ledger.exportMissing")
            : t(meetingErrorKey(result.error)),
        );
        return;
      }
      toast.success(t("meetings.ledger.exported", { path: result.data }));
    } catch {
      toast.error(t("meetings.errors.operation"));
    } finally {
      setExportingLedger(false);
    }
  };

  const tabLabels = {
    transcript: t("meetings.review.tabs.transcript", "Transcript"),
    insights: t("meetings.review.tabs.insights", "Insights"),
    ledger: t("meetings.review.tabs.ledger", "Ledger"),
    questions: t("meetings.review.tabs.questions", "Questions"),
  } satisfies Record<ReviewTab, string>;

  return (
    /* The same column the settings pages are set in — a meeting is read at
     * the page's own measure. The title is an editable field rather than a
     * string, so it goes in the page's `header` slot. */
    <SettingsPage
      header={
        <MeetingReviewHeader
          snapshot={snapshot}
          lastReceipt={lastReceipt}
          analytics={analytics?.analytics ?? null}
          speakerNames={speakerNames}
          busy={busy}
          editable={editable}
          onBack={onBack}
          onTitleSet={onTitleSet}
        />
      }
    >
      {snapshot.remote_cancellation_pending ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Notice tone="warning">
            {t("meetings.review.remoteCancellationPending")}
          </Notice>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRemoteCancel}
            disabled={busy || !canCancelRemote}
          >
            {t("meetings.review.cancelRemote")}
          </Button>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={selectTab} className="gap-8">
        <div className="-mx-8 border-b border-gray-alpha-400 px-8">
          <TabsList
            variant="line"
            aria-label={t(
              "meetings.review.tabsLabel",
              "Meeting review sections",
            )}
            className="justify-start gap-6 px-0"
          >
            {REVIEW_TAB_IDS.map((id) => (
              <TabsTrigger key={id} value={id} className={TAB_TRIGGER_CLASSES}>
                {tabLabels[id]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="transcript" className={TAB_PANEL_CLASSES}>
          <TranscriptTab
            snapshot={snapshot}
            speakerNames={speakerNames}
            busy={busy}
            editable={editable}
            jump={jump}
            searchQuery={searchQuery}
            searchHits={searchHits}
            onSearchQueryChange={setSearchQuery}
            onSegmentEdit={onSegmentEdit}
            onSpeakerRename={onSpeakerRename}
            onSpeakerMerge={onSpeakerMerge}
          />
        </TabsContent>

        <TabsContent value="insights" className={TAB_PANEL_CLASSES}>
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
        </TabsContent>

        <TabsContent value="ledger" className={TAB_PANEL_CLASSES}>
          <MeetingLedgerSection
            snapshot={snapshot}
            busy={busy || exportingLedger || loopsBusy || !editable}
            canExport={canExport}
            onJumpToSegment={jumpToSegment}
            onExportLedger={() => void exportLedger()}
            loops={loops}
            people={people}
            onLoopChange={(row, change) => void changeLoop(row, change)}
          />
        </TabsContent>

        <TabsContent value="questions" className={TAB_PANEL_CLASSES}>
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
        </TabsContent>
      </Tabs>

      <MeetingExportBar
        snapshot={snapshot}
        busy={busy}
        canExport={canExport}
        canDelete={canDelete}
        onExport={onExport}
        onDelete={onDelete}
      />
    </SettingsPage>
  );
};

interface MeetingReviewHeaderProps {
  snapshot: MeetingReviewSnapshot;
  lastReceipt: OperationReceipt | null;
  /** Conversation metrics, or null until the first read lands. */
  analytics: MeetingAnalytics | null;
  speakerNames: Record<string, string>;
  busy: boolean;
  editable: boolean;
  onBack: () => void;
  onTitleSet: (title: string) => void;
}

const MeetingReviewHeader: React.FC<MeetingReviewHeaderProps> = ({
  snapshot,
  lastReceipt,
  analytics,
  speakerNames,
  busy,
  editable,
  onBack,
  onTitleSet,
}) => {
  const { t } = useTranslation();
  const startedAtUtcMs = snapshot.session.started_at_utc_ms;
  const elapsedOffsetNs = snapshot.session.elapsed_offset_ns;
  /* When it started and how long it ran are one sentence, because they are one
   * fact about the recording. A labelled ELAPSED chip made a measurement out
   * of the second half of it. */
  const metadata = [
    startedAtUtcMs === null
      ? t("meetings.review.noStartTime")
      : t("meetings.review.started", {
          date: formatMeetingDate(startedAtUtcMs),
        }),
    elapsedOffsetNs === null ? null : formatMeetingOffset(elapsedOffsetNs),
  ]
    .filter((fact): fact is string => fact !== null)
    .join(" · ");

  return (
    <header className="flex flex-col gap-3">
      {/* Bordered, not ghost: a lone text action with no box reads as a
       * caption. A bordered control aligns its box, so no optical nudge. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        {t("meetings.actions.back")}
      </Button>
      <MeetingTitleEditor
        key={`${snapshot.session.session_id}:${snapshot.session.revision}:${snapshot.session.title}`}
        title={snapshot.session.title}
        disabled={busy || !editable}
        onTitleSet={onTitleSet}
      />
      {/* One line of facts about the recording, and the state it is in. The
       * completeness word only appears when it changes what the record can be
       * trusted for: "Complete" beside "Ready for review" says nothing twice,
       * and a partial recording has to say so in words. */}
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <MeetingPhaseText phase={snapshot.session.phase} />
        {snapshot.session.capture_completeness === "partial" ? (
          /* `StatusWord`'s warning tone; the copy is this surface's own. */
          <span className="text-[12px] leading-4 text-amber-900">
            {t("meetings.review.partialRecording")}
          </span>
        ) : null}
        <span className="text-[13px] leading-5 text-gray-700">{metadata}</span>
      </p>
      {/* Talk share sits under the facts line, not among them: it is a shape,
       * and the chips beside it are single values. */}
      <TalkTimeRow
        diarization={snapshot.diarization}
        analytics={analytics}
        speakerNames={speakerNames}
      />
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

/* The meeting's title is the page's title, so it is the page's title: an H1
 * that reads as one. D19 writes it from the meeting's own content, which makes
 * editing the exception rather than the expected first act — so there is no
 * field and no Save button until somebody presses the words themselves. */
const MeetingTitleEditor: React.FC<MeetingTitleEditorProps> = ({
  title,
  disabled,
  onTitleSet,
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);

  const commit = (draft: string) => {
    setEditing(false);
    const next = committedEdit(draft, title);
    if (next !== null) onTitleSet(next);
  };

  if (editing) {
    return (
      /* Set in the H1's own type so opening the field moves no other line on
       * the page; the heading is still the heading behind it. */
      <input
        autoFocus
        defaultValue={title}
        aria-label={t("meetings.review.meetingTitle")}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={inlineEditKeys(commit, () => setEditing(false))}
        className="w-full border-0 border-b border-blue-700 bg-transparent pb-px text-[24px] leading-[30px] font-medium tracking-tight text-gray-1000 outline-none"
      />
    );
  }

  return (
    <PageTitle>
      {disabled ? (
        title
      ) : (
        <button
          type="button"
          title={t("meetings.review.editTitle")}
          onClick={() => setEditing(true)}
          className="cursor-pointer rounded-md text-start transition-colors hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
        >
          {title}
        </button>
      )}
    </PageTitle>
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
    <p aria-live="polite" className="text-sm text-gray-700">
      <span className="text-gray-900">{t("meetings.receipts.title")}</span>{" "}
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
    <SettingsSection label={t("meetings.review.export")}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onExport("markdown")}
          disabled={busy || !canExport}
        >
          <FileText aria-hidden="true" className="size-3.5" />
          {t("meetings.review.exportMarkdown")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onExport("json")}
          disabled={busy || !canExport}
        >
          <FileJson aria-hidden="true" className="size-3.5" />
          {t("meetings.review.exportJson")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ms-auto text-red-900 hover:text-red-900"
          onClick={() => setDeleteOpen(true)}
          disabled={busy || !canDelete}
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
          {t("meetings.actions.delete")}
        </Button>
      </div>
      <div className="px-4 py-3">
        <CloudMeetingActions sessionId={snapshot.session.session_id} />
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("meetings.delete.title")}</DialogTitle>
            <DialogDescription>
              {t("meetings.delete.explainsData")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setDeleteOpen(false);
                onDelete();
              }}
            >
              {t("meetings.actions.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
};
