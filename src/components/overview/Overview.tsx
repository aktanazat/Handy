import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, events, type HistoryTrendProjection } from "@/bindings";
import { useAudioImport } from "@/hooks/useAudioImport";
import { useSettings } from "@/hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import { formatKeyCombination, keyCapParts } from "@/lib/utils/keyboard";
import { cn } from "@/lib/cn";
import { SettingsCard } from "@/components/settings/rows";
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
  onChangeShortcut: () => void;
  /** Opens the Modes editor, from the mode chip's one footer line. */
  onOpenModes: () => void;
}

/**
 * The page's one surface. Everything it draws is passed in, because the state
 * behind it is polled, dialog-driven or read from the settings store — none of
 * which is what this card is: the state word, the chord drawn once, and the two
 * actions.
 */
export const CaptureHero: React.FC<CaptureHeroProps> = ({
  isRecording,
  binding,
  pushToTalk,
  importing,
  onNewMeeting,
  onImportAudio,
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
      className="relative space-y-8 overflow-hidden p-8"
    >
      <Aurora isRecording={isRecording} />
      <div className="relative space-y-4">
        <h1
          id="overview-status"
          aria-live="polite"
          data-recording={isRecording ? "true" : undefined}
          /* Explicit px, matching SettingsPage's h1 in settings/rows.tsx. This
           * app sets `:root { font-size: 14px }` (styles/base.css), so every rem
           * utility renders at 87.5% of its name and `text-2xl` would be 21px —
           * smaller than every other page's title, on the app's default route,
           * for the one word this page exists to say. The old hero shouted it at
           * 40px/700; 24px/500 is the intended restraint, not a demotion. */
          className={cn(
            "text-[24px] leading-[30px] font-medium tracking-tight",
            isRecording ? "text-accent-strong" : "text-gray-1000",
          )}
        >
          {t(isRecording ? "overview.hero.recording" : "overview.hero.ready")}
        </h1>

        {/* The chord is drawn once, as the keys themselves — and the keys are
         * also the control that changes them, rather than a sentence pointing
         * at a settings page. Nothing bound means no keycaps and no gesture:
         * printing either would claim a capability this install lacks. */}
        {keys.length === 0 ? (
          /* Bordered, not ghost: a ghost button at rest has no border and no
           * fill, so this read as a sentence fragment rather than as the one
           * control that fixes an install with no chord bound. Its box aligns
           * to the card's content edge — the text sits inside the padding,
           * which is what a bordered control is supposed to do. */
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onChangeShortcut}
            data-testid="overview-shortcut"
          >
            {t("overview.hero.setShortcutAction", "Set a shortcut")}
          </Button>
        ) : (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-900">
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
              className="-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
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
                pushToTalk ? "tap to toggle · hold to talk" : "tap to toggle",
              )}
            </span>
          </p>
        )}

        {/* Modes left the rail, so this is where one gets picked: the name of
         * the mode the next dictation runs in, one click from the list. */}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-900">
          <span>{t("modesV2.chip.lead")}</span>
          <CaptureModeChip onOpenModes={onOpenModes} />
        </p>
      </div>

      <div className="relative flex flex-wrap items-center gap-3">
        {/* The promise lives in the tooltip and nowhere else. Radix opens the
         * tooltip on focus and points the trigger's aria-describedby at the
         * content while it is open, so a keyboard or screen-reader user reaches
         * this sentence by tabbing to the button — the primitive already does
         * the job a second permanent copy of the sentence was doing here, and
         * that copy also displaced Radix's own wiring (a child's
         * aria-describedby wins the Slot merge). One datum, one place. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" onClick={onNewMeeting}>
              <NewMeetingIcon aria-hidden="true" className="size-4" />
              {t("overview.hero.newMeeting")}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{assurance}</TooltipContent>
        </Tooltip>
        {/* The secondary capture action keeps a real hairline at rest so it
         * remains legible beside the filled primary action. */}
        <Button
          type="button"
          variant="outline"
          disabled={importing}
          onClick={onImportAudio}
        >
          <ImportAudioIcon aria-hidden="true" className="size-4" />
          {t("overview.hero.importAudio")}
        </Button>
      </div>
    </SettingsCard>
  );
};

interface OverviewProps {
  /** The shell's section setter for Capture's direct actions. */
  onOpenSection?: (section: "meetings" | "settings" | "modes") => void;
  /** Opens the retained meeting named by a workflow receipt or commitment. */
  onOpenMeeting?: (meetingId: string) => void;
}

export const Overview: React.FC<OverviewProps> = ({
  onOpenSection,
  onOpenMeeting,
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
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-center gap-6 px-8 py-12">
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
