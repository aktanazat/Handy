import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button, Section, Select, StatusText, Textarea } from "../../ui";
import {
  MEETING_NOTES_TEMPLATES,
  NOTES_AUTOSAVE_DELAY_MS,
  getMeetingUserNotes,
  meetingCatchUp,
  reenhanceMeetingWithNotes,
  saveMeetingUserNotes,
  type MeetingCatchUp,
  type MeetingNotesTemplate,
  type MeetingUserNotes,
} from "./meetingAnalytics";

/* The user's own notes for one meeting: a plain text area they type into while
 * the call runs, saved on a short delay so nothing is lost, and blended into
 * the generated notes when the meeting is enhanced.
 *
 * The pane appears twice with different jobs. During a meeting it also offers
 * a catch-up, because that is when someone needs one. Afterwards it offers the
 * template picker and a re-enhance, because that is when regeneration means
 * something. The typing and saving behavior is identical in both, which is why
 * this is one component. */

type NotesVariant = "live" | "review";

interface MeetingNotesPaneProps {
  sessionId: string;
  /** The session revision a re-enhance must be run against. */
  revision: number;
  variant: NotesVariant;
  disabled?: boolean;
  onEnhanced?: () => Promise<void>;
}

type SaveState = "idle" | "unsaved" | "saving" | "saved" | "conflict";

export const MeetingNotesPane: React.FC<MeetingNotesPaneProps> = ({
  sessionId,
  revision,
  variant,
  disabled = false,
  onEnhanced,
}) => {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<MeetingUserNotes | null>(null);
  const [body, setBody] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [enhancing, setEnhancing] = useState(false);
  const [catchUp, setCatchUp] = useState<MeetingCatchUp | null>(null);
  const [catchingUp, setCatchingUp] = useState(false);
  /* The saved revision is read inside a timer, so it lives in a ref as well as
   * in state: the timer must see the revision the last save returned, not the
   * one captured when the keystroke fired. */
  const savedRevision = useRef(0);
  const pendingSave = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    getMeetingUserNotes(sessionId)
      .then((loaded) => {
        if (!active) return;
        setNotes(loaded);
        setBody(loaded.body);
        savedRevision.current = loaded.revision;
      })
      .catch(() => {
        if (active) setSaveState("conflict");
      });
    return () => {
      active = false;
      clearTimeout(pendingSave.current);
    };
  }, [sessionId]);

  const persist = useCallback(
    async (nextBody: string, template: MeetingNotesTemplate) => {
      setSaveState("saving");
      try {
        const saved = await saveMeetingUserNotes({
          session_id: sessionId,
          body: nextBody,
          template,
          expected_note_revision: savedRevision.current,
        });
        savedRevision.current = saved.revision;
        setNotes(saved);
        setSaveState("saved");
        return saved;
      } catch {
        // A conflict means another window saved first; the reload below is the
        // only honest recovery, and it must not silently discard typing.
        setSaveState("conflict");
        return null;
      }
    },
    [sessionId],
  );

  const scheduleSave = (nextBody: string) => {
    if (notes === null) return;
    setBody(nextBody);
    setSaveState("unsaved");
    clearTimeout(pendingSave.current);
    pendingSave.current = window.setTimeout(() => {
      void persist(nextBody, notes.template);
    }, NOTES_AUTOSAVE_DELAY_MS);
  };

  const changeTemplate = async (value: string | null) => {
    if (notes === null || value === null) return;
    const template = MEETING_NOTES_TEMPLATES.find(
      (candidate) => candidate === value,
    );
    if (template === undefined || template === notes.template) return;
    clearTimeout(pendingSave.current);
    await persist(body, template);
  };

  const reenhance = async () => {
    if (notes === null) return;
    clearTimeout(pendingSave.current);
    setEnhancing(true);
    try {
      await reenhanceMeetingWithNotes({
        operation_id: crypto.randomUUID(),
        session_id: sessionId,
        expected_revision: revision,
        body,
        template: notes.template,
        expected_note_revision: savedRevision.current,
      });
      savedRevision.current += 1;
      setSaveState("saved");
      toast.success(t("meetings.notes.enhanced", "Notes rebuilt."));
      await onEnhanced?.();
    } catch {
      toast.error(
        t(
          "meetings.notes.enhanceFailed",
          "Sona could not rebuild the notes. Open the meeting again and retry.",
        ),
      );
    } finally {
      setEnhancing(false);
    }
  };

  const runCatchUp = async () => {
    setCatchingUp(true);
    try {
      setCatchUp(await meetingCatchUp(sessionId));
    } catch {
      toast.error(
        t(
          "meetings.notes.catchUpFailed",
          "Sona could not build a recap. Try again.",
        ),
      );
    } finally {
      setCatchingUp(false);
    }
  };

  const busy = disabled || notes === null;

  return (
    <Section
      title={t("meetings.notes.title", "My notes")}
      description={
        variant === "live"
          ? t(
              "meetings.notes.liveDescription",
              "Type as roughly as you like. These notes stay on this Mac and steer the notes Sona generates when the meeting ends.",
            )
          : t(
              "meetings.notes.reviewDescription",
              "Your own notes steer what the generated notes emphasize. They are never quoted or cited.",
            )
      }
    >
      <div className="meeting-card">
        <Textarea
          value={body}
          onChange={(event) => scheduleSave(event.target.value)}
          onBlur={() => {
            if (saveState !== "unsaved" || notes === null) return;
            clearTimeout(pendingSave.current);
            void persist(body, notes.template);
          }}
          placeholder={t(
            "meetings.notes.placeholder",
            "Anything worth remembering: names, numbers, what to follow up on",
          )}
          aria-label={t("meetings.notes.title", "My notes")}
          disabled={busy}
          rows={variant === "live" ? 8 : 5}
          className="w-full"
        />

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <NotesSaveState state={saveState} />
          <div className="flex flex-wrap items-center gap-2">
            {variant === "live" ? (
              <Button
                type="button"
                variant="secondary"
                onClick={runCatchUp}
                disabled={catchingUp}
              >
                {catchingUp
                  ? t("meetings.notes.catchingUp", "Catching up…")
                  : t("meetings.notes.catchUp", "Catch me up")}
              </Button>
            ) : (
              <>
                <Select
                  value={notes?.template ?? "general"}
                  options={MEETING_NOTES_TEMPLATES.map((template) => ({
                    value: template,
                    label: t(`meetings.notes.templates.${template}`),
                  }))}
                  onChange={(value) => void changeTemplate(value)}
                  disabled={busy || enhancing}
                  className="min-w-44"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={reenhance}
                  disabled={busy || enhancing}
                >
                  {enhancing
                    ? t("meetings.notes.enhancing", "Rebuilding…")
                    : t("meetings.notes.reenhance", "Re-enhance with my notes")}
                </Button>
              </>
            )}
          </div>
        </div>

        {catchUp === null ? null : <CatchUpResult result={catchUp} />}
      </div>
    </Section>
  );
};

interface NotesSaveStateProps {
  state: SaveState;
}

const NotesSaveState: React.FC<NotesSaveStateProps> = ({ state }) => {
  const { t } = useTranslation();

  switch (state) {
    case "idle":
      return null;
    case "unsaved":
      return (
        <StatusText tone="muted">
          {t("meetings.notes.unsaved", "Not saved yet")}
        </StatusText>
      );
    case "saving":
      return (
        <StatusText tone="muted" live="polite">
          {t("meetings.notes.saving", "Saving…")}
        </StatusText>
      );
    case "saved":
      return (
        <StatusText tone="muted" live="polite">
          {t("meetings.notes.saved", "Notes saved")}
        </StatusText>
      );
    case "conflict":
      return (
        <StatusText tone="danger" live="assertive">
          {t(
            "meetings.notes.conflict",
            "These notes changed somewhere else. Reopen the meeting to load the current version.",
          )}
        </StatusText>
      );
  }
};

interface CatchUpResultProps {
  result: MeetingCatchUp;
}

/* A catch-up over the transcript Sona has so far. Audio is transcribed once
 * capture stops, so during a live recording the honest answer is that there is
 * nothing to read yet — and this says so instead of showing an empty list. */
const CatchUpResult: React.FC<CatchUpResultProps> = ({ result }) => {
  const { t } = useTranslation();

  if (result.state === "no_transcript_yet") {
    return (
      <StatusText tone="muted" className="mt-3 block" live="polite">
        {t(
          "meetings.notes.catchUpNoTranscript",
          "Nothing to recap yet. Sona transcribes after you stop recording, so a recap is available once the transcript starts arriving.",
        )}
      </StatusText>
    );
  }

  if (result.state === "model_unavailable") {
    return (
      <StatusText tone="warning" className="mt-3 block" live="polite">
        {t(
          "meetings.notes.catchUpUnavailable",
          "The on-device model is unavailable, so no recap was written.",
        )}
      </StatusText>
    );
  }

  if (result.state === "failed") {
    return (
      <StatusText tone="danger" className="mt-3 block" live="polite">
        {t(
          "meetings.notes.catchUpFailed",
          "Sona could not build a recap. Try again.",
        )}
      </StatusText>
    );
  }

  return (
    <div className="inset-panel mt-3">
      <h3 className="microlabel mb-2">
        {t("meetings.notes.catchUpTitle", "So far")}
      </h3>
      <ul className="list-disc space-y-1 ps-4">
        {result.bullets.map((bullet) => (
          <li
            key={bullet}
            className="text-[12.5px] leading-[18px] text-text-secondary"
          >
            {bullet}
          </li>
        ))}
      </ul>
    </div>
  );
};
