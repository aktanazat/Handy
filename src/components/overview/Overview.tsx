import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { useAudioImport } from "@/hooks/useAudioImport";
import { useSettings } from "@/hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import { formatKeyCombination, keyCapParts } from "@/lib/utils/keyboard";
import { cn } from "@/lib/cn";
import { SettingsCard } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { commandActionIcons } from "@/components/commandPaletteActions";
import { Kbd } from "@/components/vg/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/vg/tooltip";
import { checkForUpdates, type UpdateCheckResult } from "@/lib/updateCheck";
import { UpdateBanner, UpdateCheckFailure } from "./UpdateNotice";

/* Capture is one hero and nothing else.
 *
 * Every number this page used to draw belonged somewhere else: the engine and
 * the model are the sidebar chip's, the counters and the activity band are the
 * Library's, the recent rows are the Library's list. What is left is the only
 * thing that is this page's own — the state the app is in, the chord that
 * changes it, and the two ways to start a capture that is not dictation.
 *
 * With no numbers there is nothing to keep in step, so the read wave, its
 * reducer, its history-write subscription and the receipt reads behind them are
 * gone with the surfaces they fed.
 */

/* Recording is a command, not an event: the backend starts and stops on a
 * global chord this window never sees, so the status word is polled. One
 * boolean a second is the whole backend cost of this page while it is open. */
const RECORDING_POLL_MS = 1000;
const NewMeetingIcon = commandActionIcons.newMeeting;
const ImportAudioIcon = commandActionIcons.importAudio;

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
    <SettingsCard aria-labelledby="overview-status" className="space-y-8 p-8">
      <div className="space-y-4">
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
            isRecording ? "text-blue-900" : "text-gray-1000",
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
              className="-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
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
      </div>

      <div className="flex flex-wrap items-center gap-3">
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
        {/* Filled + bordered is Geist's action pair. Ghost was wrong here: with
         * no border and no fill at rest it read as a caption sitting next to
         * New meeting instead of as the second way to start a capture. */}
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
  /** The shell's section setter. Capture sends people exactly two places:
   * Meetings, and Settings when the chord it draws has to be changed. */
  onOpenSection?: (section: "meetings" | "settings") => void;
}

export const Overview: React.FC<OverviewProps> = ({ onOpenSection }) => {
  const { settings } = useSettings();
  const [isRecording, setIsRecording] = useState(false);
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
    const refresh = async () => {
      try {
        const recording = await commands.isRecording();
        if (active) setIsRecording(recording);
      } catch {
        if (active) setIsRecording(false);
      }
    };
    void refresh();
    const interval = window.setInterval(
      () => void refresh(),
      RECORDING_POLL_MS,
    );
    return () => {
      active = false;
      window.clearInterval(interval);
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

  /* One check per visit. The backend owns the decision: with automatic checks
   * off it answers "disabled" without touching the network, and this page
   * renders nothing for that status. */
  useEffect(() => {
    void runUpdateCheck();
  }, [runUpdateCheck]);

  return (
    /* One card in an empty room, placed rather than parked: the column fills
     * the viewport and centres its stack, with the centre biased upward by a
     * viewport twelfth — true centre reads low once a window grows tall. The
     * card itself stays narrow; 560px is the measure of its own sentence, and
     * anything wider read as an empty container. */
    <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col justify-center gap-6 px-8 py-12 pb-[12vh]">
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
      />

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
