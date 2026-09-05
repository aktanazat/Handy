import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, events, type HistoryTrendProjection } from "@/bindings";
import { useAudioImport } from "@/hooks/useAudioImport";
import { useSettings } from "@/hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import { formatKeyCombination, keyCapParts } from "@/lib/utils/keyboard";
import { cn } from "@/lib/cn";
import { PAGE_COLUMN, SettingsCard } from "@/components/settings/rows";
import { Aurora } from "@/components/Aurora";
import { Button } from "@/components/vg/button";
import { commandActionIcons } from "@/components/commandPaletteActions";
import { Kbd } from "@/components/vg/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/vg/tooltip";
import { checkForUpdates, type UpdateCheckResult } from "@/lib/updateCheck";
import { waitForFirstVisibleFrame } from "@/lib/launchTrace";
import { UpdateBanner, UpdateCheckFailure } from "./UpdateNotice";
import { ActivityBand } from "./ActivityBand";
import { CaptureModeChip } from "./CaptureModeChip";
import { OverviewWorkflowCards } from "./OverviewWorkflowCards";
import { LearningSuggestionCard } from "./LearningSuggestionCard";

/* Capture stays the primary surface. The activity band below it reuses the
 * history trend projection the former Overview analytics read, now expressed
 * through the shared chart grammar instead of page-local chart markup. */

/* Recording is a command, not an event: the backend starts and stops on a
 * global chord this window never sees, so the status word is polled. One
 * boolean a second is the whole backend cost of this page while it is open. */
const RECORDING_POLL_MS = 1000;
const NewMeetingIcon = commandActionIcons.newMeeting;
const ImportAudioIcon = commandActionIcons.importAudio;
const RecordScreenIcon = commandActionIcons.recordScreen;

const subscribeToActivityUpdates = (reload: () => void): (() => void) => {
  const subscription = events.historyUpdatePayload.listen((event) => {
    if (event.payload.action !== "toggled") reload();
  });
  return () => {
    void subscription.then((unlisten) => unlisten());
  };
};

export interface CaptureHeroProps {
  isRecording: boolean;
  /** The raw chord, or null when nothing is bound. */
  binding: string | null;
  pushToTalk: boolean;
  /** An import dialog is already open. */
  importing: boolean;
  onNewMeeting: () => void;
  onImportAudio: () => void;
  onRecordScreen: () => void;
  onChangeShortcut: () => void;
  /** Opens the Modes editor, from the mode chip's one footer line. */
  onOpenModes: () => void;
}

/**
 * The page's one surface. Everything it draws is passed in, because the state
 * behind it is polled, dialog-driven or read from the settings store — none of
 * which is what this card is: the state word, the chord drawn once, and its
 * direct actions.
 */
export const CaptureHero: React.FC<CaptureHeroProps> = ({
  isRecording,
  binding,
  pushToTalk,
  importing,
  onNewMeeting,
  onImportAudio,
  onRecordScreen,
  onChangeShortcut,
  onOpenModes,
}) => {
  const { t } = useTranslation();
  const osType = useOsType();
  const keys =
    binding === null
      ? []
      : keyCapParts(binding, osType).filter((key) => key.length > 0);
  /* One click starts a meeting, so the promise sits with the button rather than
   * behind a wizard step nobody reads. The key lives in the meetings subtree,
   * which owns this sentence's exact wording in every locale. */
  const assurance = t(
    "meetings.start.assurance",
    "Records your Mac's audio locally. Nothing joins the call.",
  );

  return (
    <SettingsCard
      aria-labelledby="overview-status"
      className="relative overflow-hidden px-6 py-5"
    >
      <Aurora isRecording={isRecording} />
      <div className="relative flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1
            id="overview-status"
            aria-live="polite"
            data-recording={isRecording ? "true" : undefined}
            /* The document-title size from the round-6 type scale, in explicit
             * px: this app sets `:root { font-size: 14px }` (styles/base.css),
             * so every rem utility renders at 87.5% of its name. One word, at
             * the same size a meeting's title is set in, so the page does not
             * shout a state that every other page states quietly. */
            className={cn(
              "text-[24px] leading-[30px] font-semibold tracking-[-0.01em] text-balance",
              isRecording ? "text-accent-strong" : "text-gray-1000",
            )}
          >
            {t(isRecording ? "overview.hero.recording" : "overview.hero.ready")}
          </h1>

          {/* One meta line under the state word: the chord that starts a
           * dictation, the gesture it answers to, and the mode the next one
           * runs in. Three sentence fragments stacked as three paragraphs read
           * as three unrelated announcements; they are one sentence about the
           * next dictation. Nothing bound means no keycaps and no gesture —
           * printing either would claim a capability this install lacks. */}
          <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-[18px] text-gray-900">
            {keys.length === 0 ? (
              /* Bordered, not ghost: a ghost button at rest has no border and
               * no fill, so this read as a sentence fragment where it is the
               * one control that fixes an install with no chord bound. */
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={onChangeShortcut}
                data-testid="overview-shortcut"
              >
                {t("overview.hero.setShortcutAction", "Set a shortcut")}
              </Button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onChangeShortcut}
                  /* The left/right qualifier the caps drop, one hover away. */
                  title={formatKeyCombination(binding ?? "", osType)}
                  aria-label={t(
                    "overview.hero.shortcutAction",
                    "Change dictation shortcut",
                  )}
                  data-testid="overview-shortcut"
                  className="hover-fast -mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
                >
                  {keys.map((key, index) => (
                    <Kbd key={`${key}-${index}`}>{key}</Kbd>
                  ))}
                </button>
                <span>
                  {t(
                    pushToTalk
                      ? "overview.hero.gestureTapHold"
                      : "overview.hero.gestureTapOnly",
                    pushToTalk
                      ? "tap to toggle · hold to talk"
                      : "tap to toggle",
                  )}
                </span>
              </>
            )}
            <span aria-hidden="true" className="text-gray-700">
              ·
            </span>
            {/* Modes left the rail, so this is where one gets picked: the name
             * of the mode the next dictation runs in, one click from the list. */}
            <span>{t("modesV2.chip.lead")}</span>
            <CaptureModeChip onOpenModes={onOpenModes} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* The promise lives in the tooltip and nowhere else. Radix opens the
           * tooltip on focus and points the trigger's aria-describedby at the
           * content while it is open, so a keyboard or screen-reader user reaches
           * this sentence by tabbing to the button — the primitive already does
           * the job a second permanent copy of the sentence was doing here, and
           * that copy also displaced Radix's own wiring (a child's
           * aria-describedby wins the Slot merge). One datum, one place. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" size="sm" onClick={onNewMeeting}>
                <NewMeetingIcon aria-hidden="true" className="size-4" />
                {t("overview.hero.newMeeting")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{assurance}</TooltipContent>
          </Tooltip>
          {osType === "macos" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRecordScreen}
            >
              <RecordScreenIcon aria-hidden="true" className="size-4" />
              {t("recorder.open")}
            </Button>
          ) : null}
          {/* The secondary capture actions keep a real hairline at rest so they
           * remain legible beside the one filled primary action. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={importing}
            onClick={onImportAudio}
          >
            <ImportAudioIcon aria-hidden="true" className="size-4" />
            {t("overview.hero.importAudio")}
          </Button>
        </div>
      </div>
    </SettingsCard>
  );
};

interface OverviewProps {
  /** The shell's section setter for Capture's direct actions. */
  onOpenSection?: (section: "meetings" | "settings" | "modes") => void;
  /** Opens the retained meeting named by a workflow receipt or commitment. */
  onOpenMeeting?: (meetingId: string) => void;
  /** Opens the native screen recorder without creating a second destination. */
  onOpenRecorder: () => void;
}

export const Overview: React.FC<OverviewProps> = ({
  onOpenSection,
  onOpenMeeting,
  onOpenRecorder,
}) => {
  const { settings } = useSettings();
  const [isRecording, setIsRecording] = useState(false);
  const [activityTrend, setActivityTrend] =
    useState<HistoryTrendProjection | null>(null);
  /* No options: Capture has nowhere of its own to draw a failure, so it takes
   * the shared action's toast. It used to swallow the error entirely and tell
   * the reader to go look in Library, which is not where they were. */
  const { start: startAudioImport, importing } = useAudioImport();
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(
    null,
  );
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    let active = true;
    let interval: number | undefined;
    const refresh = async () => {
      try {
        const recording = await commands.isRecording();
        if (active) setIsRecording(recording);
      } catch {
        if (active) setIsRecording(false);
      }
    };
    const syncPolling = () => {
      if (document.hidden) {
        if (interval !== undefined) {
          window.clearInterval(interval);
          interval = undefined;
        }
        return;
      }
      void refresh();
      interval ??= window.setInterval(() => void refresh(), RECORDING_POLL_MS);
    };
    syncPolling();
    document.addEventListener("visibilitychange", syncPolling);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", syncPolling);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const result = await commands.getHistoryTrend({ range: "days_180" });
        if (active) {
          setActivityTrend(result.status === "ok" ? result.data : null);
        }
      } catch {
        if (active) setActivityTrend(null);
      }
    };

    void refresh();
    const stopListening = subscribeToActivityUpdates(() => void refresh());

    return () => {
      active = false;
      stopListening();
    };
  }, []);

  const runUpdateCheck = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      setUpdateResult(await checkForUpdates());
    } catch {
      /* The command reports its own failures in `status`, so a rejected call
       * means it is missing from this build. Nothing worth telling anyone. */
      setUpdateResult(null);
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  /* One check per visit, after the launch shell has composited. The backend
   * still owns the preference decision; disabled checks make no request. */
  useEffect(() => {
    let cancelled = false;
    void waitForFirstVisibleFrame().then(() => {
      if (!cancelled) void runUpdateCheck();
    });
    return () => {
      cancelled = true;
    };
  }, [runUpdateCheck]);

  return (
    /* The hero and the activity cards share the settings-page measure. Order
     * is glanceability: the hero, then the three numbers, then the feed. The
     * band used to sit last, so at the shipped 900x800 a feed with anything in
     * it pushed Dictations/Words/Streak off the bottom edge — the one part of
     * this page you read without scrolling was the one part you had to scroll
     * for. The feed is a list that grows; the band is three fixed cards, so
     * the band is what can be promised above the fold. */
    <div
      className={cn(
        PAGE_COLUMN,
        "flex min-h-full flex-col justify-center gap-8 py-8",
      )}
    >
      {updateResult !== null &&
        updateResult.status === "update_available" &&
        !updateDismissed && (
          <UpdateBanner
            result={updateResult}
            onDismiss={() => setUpdateDismissed(true)}
          />
        )}

      <CaptureHero
        isRecording={isRecording}
        binding={
          settings?.bindings?.transcribe?.current_binding?.trim() || null
        }
        pushToTalk={settings?.push_to_talk ?? true}
        importing={importing}
        onNewMeeting={() => onOpenSection?.("meetings")}
        onImportAudio={() => void startAudioImport()}
        onRecordScreen={onOpenRecorder}
        onChangeShortcut={() => onOpenSection?.("settings")}
        onOpenModes={() => onOpenSection?.("modes")}
      />

      {activityTrend === null ? null : <ActivityBand trend={activityTrend} />}

      <OverviewWorkflowCards
        onOpenMeeting={(meetingId) => onOpenMeeting?.(meetingId)}
      />

      {/* What Sona noticed, beside what Sona did: the same feed, and this half
       * is the one that asks the reader a question. */}
      <LearningSuggestionCard />

      {updateResult !== null && updateResult.status === "check_failed" && (
        <UpdateCheckFailure
          result={updateResult}
          onRetry={() => void runUpdateCheck()}
          retrying={checkingUpdate}
        />
      )}
    </div>
  );
};
