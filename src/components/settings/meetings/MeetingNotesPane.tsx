import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  FIELD_MAX_W,
  Microlabel,
  Notice,
  SettingsCard,
  SettingsField,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { Textarea } from "@/components/vg/textarea";
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
 * this is one component.
 *
 * Saving reports itself once, as a microlabel beside the label — never a
 * sentence and a spinner and a toast for the same keystroke. */

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

const SAVED_AT_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

export const MeetingNotesPane: React.FC<MeetingNotesPaneProps> = ({
  sessionId,
  revision,
  variant,
  disabled = false,
  onEnhanced,
}) => {
  const { t } = useTranslation();
  const fieldId = useId();
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

  const changeTemplate = async (value: string) => {
    if (notes === null) return;
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

  /* A failed recap is reported where the recap would have been, so the failure
   * is not announced twice — once as a toast and once as a panel. */
  const runCatchUp = async () => {
    setCatchingUp(true);
    try {
      setCatchUp(await meetingCatchUp(sessionId));
    } catch {
      setCatchUp({
        state: "failed",
        bullets: [],
        through_offset_ns: null,
        segment_count: 0,
      });
    } finally {
      setCatchingUp(false);
    }
  };

  const busy = disabled || notes === null;
  const savedAtUtcMs = notes?.updated_at_utc_ms ?? null;
  /* One line for the whole save cycle, and nothing at all before the first
   * edit. A conflict is not in here: it is a sentence with a recovery in it. */
  const saveLabel =
    saveState === "unsaved"
      ? t("meetings.notes.unsaved", "Not saved yet")
      : saveState === "saving"
        ? t("meetings.notes.saving", "Saving…")
        : saveState === "saved"
          ? `${t("meetings.notes.saved", "Notes saved")}${savedAtUtcMs === null ? "" : ` ${SAVED_AT_FORMATTER.format(savedAtUtcMs)}`}`
          : null;

  return (
    <SettingsCard className="divide-y divide-gray-alpha-400">
      <SettingsField
        label={t("meetings.notes.title", "My notes")}
        /* Only the live variant carries a hint. After the meeting, the
         * "Re-enhance with my notes" button states the same fact the review
         * sentence did, and the sentence was the third place it was said. */
        hint={
          variant === "live"
            ? t(
                "meetings.notes.liveDescription",
                "Type as roughly as you like. These notes stay on this Mac and steer the notes Sona generates when the meeting ends.",
              )
            : undefined
        }
        fact={
          saveLabel === null ? undefined : (
            <span role="status" aria-live="polite">
              {saveLabel}
            </span>
          )
        }
        controlId={fieldId}
        disabled={busy}
      >
        <Textarea
          id={fieldId}
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
          disabled={busy}
          rows={variant === "live" ? 8 : 5}
          className="resize-none"
        />

        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          {variant === "live" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runCatchUp()}
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
                onValueChange={(value) => void changeTemplate(value)}
                disabled={busy || enhancing}
              >
                <SelectTrigger
                  size="sm"
                  className={`w-auto ${FIELD_MAX_W}`}
                  aria-label={t("meetings.notes.template", "Template")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEETING_NOTES_TEMPLATES.map((template) => (
                    <SelectItem key={template} value={template}>
                      {t(`meetings.notes.templates.${template}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void reenhance()}
                disabled={busy || enhancing}
              >
                {enhancing
                  ? t("meetings.notes.enhancing", "Rebuilding…")
                  : t("meetings.notes.reenhance", "Re-enhance with my notes")}
              </Button>
            </>
          )}
        </div>
      </SettingsField>

      {saveState === "conflict" ? (
        <div className="px-4 py-3">
          <Notice tone="danger" assertive>
            {t(
              "meetings.notes.conflict",
              "These notes changed somewhere else. Reopen the meeting to load the current version.",
            )}
          </Notice>
        </div>
      ) : null}

      {catchUp === null ? null : <CatchUpResult result={catchUp} />}
    </SettingsCard>
  );
};

interface CatchUpResultProps {
  result: MeetingCatchUp;
}

/* A catch-up over the transcript Sona has so far. Audio is transcribed once
 * capture stops, so during a live recording the honest answer is that there is
 * nothing to read yet — and this says so instead of showing an empty list. */
const CatchUpResult: React.FC<CatchUpResultProps> = ({ result }) => {
  const { t } = useTranslation();

  if (result.state !== "ready") {
    return (
      <div className="px-4 py-3">
        <Notice
          tone={result.state === "no_transcript_yet" ? "muted" : "warning"}
        >
          {result.state === "no_transcript_yet"
            ? t(
                "meetings.notes.catchUpNoTranscript",
                "Nothing to recap yet. Sona transcribes after you stop recording, so a recap is available once the transcript starts arriving.",
              )
            : result.state === "model_unavailable"
              ? t(
                  "meetings.notes.catchUpUnavailable",
                  "The on-device model is unavailable, so no recap was written.",
                )
              : t(
                  "meetings.notes.catchUpFailed",
                  "Sona could not build a recap. Try again.",
                )}
        </Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <h3>
        <Microlabel>{t("meetings.notes.catchUpTitle", "So far")}</Microlabel>
      </h3>
      <ul className="list-disc space-y-1 ps-4 text-sm text-gray-900">
        {result.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
    </div>
  );
};
