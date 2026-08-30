import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import {
  checkAccessibilityPermission,
  checkMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import { ModelStateEvent, RecordingErrorEvent } from "./lib/types/events";
import "./App.css";
import AccessibilityPermissions from "./components/AccessibilityPermissions";
import SecureInputWarning from "./components/SecureInputWarning";
import Onboarding from "./components/onboarding/Onboarding";
import AccessibilityOnboarding from "./components/onboarding/AccessibilityOnboarding";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { CommandPalette } from "./components/CommandPalette";
import { DetectionListeners } from "./components/settings/meetings/DetectionListeners";
import { PAGE_COLUMN } from "./components/settings/rows";
import { RouteSkeleton } from "./components/RouteSkeleton";
import { Toaster } from "./components/Toaster";
import {
  commandActionIcons,
  isCommandPaletteChord,
  type CommandPaletteAction,
} from "./components/commandPaletteActions";
import {
  buildNavigationActions,
  SECTIONS_CONFIG,
  type SidebarSection,
} from "./components/sidebarSections";
import { WhatsNewGate } from "./components/whats-new";
import { useAudioImport } from "./hooks/useAudioImport";
import { useSettings } from "./hooks/useSettings";
import { useSettingsStore } from "./stores/settingsStore";
import { commands, events, type MeetingNavigationPayload } from "@/bindings";
import { cn } from "@/lib/cn";
import {
  getLanguageDirection,
  initializeRTL,
  type LanguageDirection,
} from "@/lib/utils/rtl";
import { runViewTransition } from "@/lib/utils/viewTransition";
import { MotionProvider } from "@/lib/motion/provider";

type OnboardingStep = "accessibility" | "model" | "done";

interface SettingsContentProps {
  section: SidebarSection;
  meetingInvalidation: number;
  meetingNavigationRequest: MeetingNavigationPayload | null;
  meetingStartRequest: number;
  onSectionChange: (section: SidebarSection) => void;
}

const renderSettingsContent = ({
  section,
  meetingInvalidation,
  meetingNavigationRequest,
  meetingStartRequest,
  onSectionChange,
}: SettingsContentProps) => {
  if (section === "overview") {
    const OverviewComponent = SECTIONS_CONFIG.overview.component;
    return <OverviewComponent onOpenSection={onSectionChange} />;
  }

  if (section === "meetings") {
    const MeetingsComponent = SECTIONS_CONFIG.meetings.component;
    return (
      <MeetingsComponent
        invalidation={meetingInvalidation}
        navigationRequest={meetingNavigationRequest}
        startRequest={meetingStartRequest}
      />
    );
  }

  const ActiveComponent =
    SECTIONS_CONFIG[section]?.component || SECTIONS_CONFIG.overview.component;
  return <ActiveComponent />;
};

const subscribeToMeetingEvents = async (
  invalidate: () => void,
  navigate: (payload: MeetingNavigationPayload) => void,
) => {
  const unlisten = await Promise.all([
    events.meetingSuggestionChanged.listen(invalidate),
    events.meetingSessionChanged.listen(invalidate),
    events.meetingSourceHealthChanged.listen(invalidate),
    events.meetingTranscriptChanged.listen(invalidate),
    events.meetingNoteChanged.listen(invalidate),
    events.meetingArtifactChanged.listen(invalidate),
    events.meetingRemoteJobChanged.listen(invalidate),
    events.meetingRemoved.listen(invalidate),
    events.meetingNavigationRequested.listen((event) => {
      navigate(event.payload);
      invalidate();
    }),
  ]);

  return async () => {
    await Promise.all(unlisten.map((listener) => listener()));
  };
};

/* The toast surface and the route skeleton are app components, not kit
 * primitives — they own this app's copy rules and page rhythm. The shell only
 * decides where they mount. */

interface AppContentProps {
  onboardingStep: OnboardingStep | null;
  onAccessibilityComplete: () => void;
  onModelSelected: () => void;
  direction: LanguageDirection;
  currentSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  loadingLabel: string;
  meetingInvalidation: number;
  meetingNavigationRequest: MeetingNavigationPayload | null;
  meetingStartRequest: number;
  commandOpen: boolean;
  commandActions: CommandPaletteAction[];
  onCommandOpenChange: (open: boolean) => void;
  onCommandOpen: () => void;
}

const AppContent = ({
  onboardingStep,
  onAccessibilityComplete,
  onModelSelected,
  direction,
  currentSection,
  onSectionChange,
  loadingLabel,
  meetingInvalidation,
  meetingNavigationRequest,
  meetingStartRequest,
  commandOpen,
  commandActions,
  onCommandOpenChange,
  onCommandOpen,
}: AppContentProps) => {
  if (onboardingStep === null) return null;
  if (onboardingStep === "accessibility") {
    return <AccessibilityOnboarding onComplete={onAccessibilityComplete} />;
  }
  if (onboardingStep === "model") {
    return <Onboarding onModelSelected={onModelSelected} />;
  }

  return (
    <div
      dir={direction}
      /* `app-shell` carries no styling of its own any more. It survives as the
       * hook the one material override in styles/shell.css keys off: a Glass
       * window has to let the native vibrancy through, and that decision lives
       * on a root attribute Rust writes, which no utility can read. */
      className="app-shell flex h-screen cursor-default select-none bg-background-200"
    >
      <ErrorBoundary context="What's New">
        <WhatsNewGate />
      </ErrorBoundary>
      <Sidebar
        activeSection={currentSection}
        onSectionChange={onSectionChange}
        onOpenCommand={onCommandOpen}
      />
      {/* `settings-main` is a hook as well: primitives.css still styles bare
       * inputs and selects through it for the surfaces that have not moved to
       * the component kit yet. */}
      <main className="settings-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-x-hidden overflow-y-auto">
          {/* Every page owns its own column now, so the scroll region is full
           * width and unpadded. These two are shell banners rather than
           * pages, so they borrow the pages' column from the primitive that
           * owns it — and both render nothing on the ordinary path, which is
           * what collapses the wrapper. */}
          <div className={cn(PAGE_COLUMN, "pt-8 empty:hidden")}>
            <AccessibilityPermissions />
            <SecureInputWarning />
          </div>
          {/* Keyed on the section so switching routes shows the skeleton
           * again rather than holding the previous page while the next
           * chunk loads, and so a crashed section resets when you leave. */}
          <ErrorBoundary key={currentSection} context={currentSection}>
            <Suspense
              fallback={
                <div className={cn(PAGE_COLUMN, "py-12")}>
                  <RouteSkeleton label={loadingLabel} />
                </div>
              }
            >
              {renderSettingsContent({
                section: currentSection,
                meetingInvalidation,
                meetingNavigationRequest,
                meetingStartRequest,
                onSectionChange,
              })}
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
      <CommandPalette
        open={commandOpen}
        onOpenChange={onCommandOpenChange}
        actions={commandActions}
      />
    </div>
  );
};

interface CommandActionDeps {
  t: (key: string) => string;
  agentEnabled: boolean;
  onNavigate: (section: SidebarSection) => void;
  onNewMeeting: () => void;
  onImportAudio: () => void;
  onOpenRecordings: () => void;
  onOpenAgent: () => void;
}

const buildCommandActions = ({
  t,
  agentEnabled,
  onNavigate,
  onNewMeeting,
  onImportAudio,
  onOpenRecordings,
  onOpenAgent,
}: CommandActionDeps): CommandPaletteAction[] => [
  /* The destinations come from the section registry, in the one order it lists
   * them: the rail takes the same list, so neither surface can rename or
   * reorder a destination on its own. Models is last because the registry lists
   * it last, and has no rail row because the registry says `inRail: false`. */
  ...buildNavigationActions(t, onNavigate),
  {
    id: "action-meeting",
    group: "actions",
    label: t("commandPalette.newMeeting"),
    icon: commandActionIcons.video,
    run: onNewMeeting,
  },
  {
    id: "action-import",
    group: "actions",
    label: t("commandPalette.importAudio"),
    icon: commandActionIcons.file,
    run: onImportAudio,
  },
  {
    id: "action-recordings",
    group: "actions",
    label: t("commandPalette.openRecordings"),
    icon: commandActionIcons.folder,
    run: onOpenRecordings,
  },
  ...(agentEnabled
    ? [
        {
          id: "action-agent",
          group: "actions" as const,
          label: t("commandPalette.openAgent"),
          icon: commandActionIcons.agent,
          run: onOpenAgent,
        },
      ]
    : []),
];

const AppEventListeners: React.FC = () => {
  const { t } = useTranslation();
  // Listen for recording errors from the backend and show a toast
  useEffect(() => {
    const unlisten = listen<RecordingErrorEvent>("recording-error", (event) => {
      const { error_type, detail } = event.payload;

      if (error_type === "microphone_permission_denied") {
        const currentPlatform = platform();
        const platformKey = `errors.micPermissionDenied.${currentPlatform}`;
        const description = t(platformKey, {
          defaultValue: t("errors.micPermissionDenied.generic"),
        });
        toast.error(t("errors.micPermissionDeniedTitle"), { description });
      } else if (error_type === "no_input_device") {
        toast.error(t("errors.noInputDeviceTitle"), {
          description: t("errors.noInputDevice"),
        });
      } else if (error_type === "no_speech_detected") {
        toast.info(t("errors.noSpeechDetectedTitle"), {
          description: t("errors.noSpeechDetected"),
        });
      } else if (error_type === "no_model_selected") {
        toast.error(
          t(
            "errors.noModelSelected",
            "No transcription model selected. Choose one in Settings > Models.",
          ),
        );
      } else if (error_type === "command_no_selection") {
        toast.error(
          t(
            "errors.commandNoSelection",
            "Select the text you want to change, then hold the command shortcut and say the change.",
          ),
        );
      } else if (error_type === "command_rewrite_unavailable") {
        toast.error(
          t(
            "errors.commandRewriteUnavailable",
            "The rewrite returned nothing, so your selection was left as it was. Check the provider in Settings > Post-processing and try again.",
          ),
        );
      } else if (error_type === "no_speech_save_failed") {
        toast.error(
          t("errors.recordingFailed", {
            error: t(
              "settings.advanced.customWords.audioImport.failure.history",
            ),
          }),
        );
      } else {
        toast.error(
          t("errors.recordingFailed", { error: detail ?? "Unknown error" }),
        );
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // Listen for paste failures and show a toast.
  // The technical error detail is logged to sona.log on the Rust side
  // (see actions.rs `error!("Failed to paste transcription: ...")`),
  // so we show a localized, user-friendly message here instead of the raw error.
  useEffect(() => {
    const unlisten = listen("paste-error", () => {
      toast.error(t("errors.pasteFailedTitle"), {
        description: t("errors.pasteFailed"),
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // Listen for transcription failures and show a toast.
  // The payload is the backend error message (also logged to sona.log).
  useEffect(() => {
    const unlisten = listen<string>("transcription-error", (event) => {
      toast.error(t("errors.transcriptionFailedTitle"), {
        description: event.payload,
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  useEffect(() => {
    const unlisten = listen("audio-import-open-error", () => {
      toast.error(t("settings.advanced.customWords.audioImport.errors.start"));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // Listen for model loading failures and show a toast
  useEffect(() => {
    const unlisten = listen<ModelStateEvent>("model-state-changed", (event) => {
      if (event.payload.event_type === "loading_failed") {
        toast.error(
          t("errors.modelLoadFailed", {
            model:
              event.payload.model_name || t("errors.modelLoadFailedUnknown"),
          }),
          {
            description: event.payload.error,
          },
        );
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  return null;
};

const revealMainWindowForPermissions = async (): Promise<void> => {
  try {
    await commands.showMainWindowCommand();
  } catch (error) {
    console.warn(
      "Failed to show main window for permission onboarding:",
      error,
    );
  }
};

function App() {
  const { t, i18n } = useTranslation();
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep | null>(
    null,
  );
  // Track if this is a returning user who just needs to grant permissions
  // (vs a new user who needs full onboarding including model selection)
  const isReturningUserRef = useRef(false);
  const [currentSection, setCurrentSection] =
    useState<SidebarSection>("overview");
  const [meetingInvalidation, setMeetingInvalidation] = useState(0);
  const [meetingNavigationRequest, setMeetingNavigationRequest] =
    useState<MeetingNavigationPayload | null>(null);
  const [meetingStartRequest, setMeetingStartRequest] = useState(0);
  const [commandOpen, setCommandOpen] = useState(false);
  const { settings, updateSetting } = useSettings();
  const direction = getLanguageDirection(i18n.language);
  const refreshAudioDevices = useSettingsStore(
    (state) => state.refreshAudioDevices,
  );
  const refreshOutputDevices = useSettingsStore(
    (state) => state.refreshOutputDevices,
  );
  const hasCompletedPostOnboardingInit = useRef(false);

  /* A route change swaps the whole view, which is the one case the View
   * Transitions API is for. The deep-link handler below deliberately keeps the
   * raw setter: it moves three pieces of state at once, and snapshotting a
   * partial update would tear. */
  const navigateToSection = useCallback((section: SidebarSection) => {
    runViewTransition(() => setCurrentSection(section));
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => Promise<void>) | null = null;
    const invalidateMeetings = () => {
      if (!disposed) {
        setMeetingInvalidation((current) => current + 1);
      }
    };

    void subscribeToMeetingEvents(invalidateMeetings, (payload) => {
      setMeetingNavigationRequest(payload);
      // sona://meeting/start asks for the start surface and carries no session
      // (lib.rs dispatch_deep_link); every other preflight payload names one.
      if (payload.destination === "preflight" && payload.session_id === null) {
        setMeetingStartRequest((current) => current + 1);
      }
      setCurrentSection("meetings");
    }).then((cleanup) => {
      if (disposed) {
        void cleanup();
      } else {
        unsubscribe = cleanup;
      }
    });

    return () => {
      disposed = true;
      if (unsubscribe) {
        void unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  // Initialize RTL direction when language changes
  useEffect(() => {
    initializeRTL(i18n.language);
  }, [i18n.language]);

  // Initialize Enigo, shortcuts, and refresh audio devices when main app loads
  useEffect(() => {
    if (onboardingStep === "done" && !hasCompletedPostOnboardingInit.current) {
      hasCompletedPostOnboardingInit.current = true;
      Promise.all([
        commands.initializeEnigo(),
        commands.initializeShortcuts(),
      ]).catch((e) => {
        console.warn("Failed to initialize:", e);
      });
      refreshAudioDevices();
      refreshOutputDevices();
    }
  }, [onboardingStep, refreshAudioDevices, refreshOutputDevices]);

  /* The palette's chord, and the reason `isCommandPaletteChord` is a named
   * predicate: it drops auto-repeats. The chord toggles, and a held key
   * repeats keydown at the OS repeat rate, so this listener used to flip the
   * palette open and shut dozens of times a second for as long as the chord
   * was held. */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isCommandPaletteChord(event)) return;
      event.preventDefault();
      setCommandOpen((open) => !open);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Handle keyboard shortcuts for debug mode toggle
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Ctrl+Shift+D (Windows/Linux) or Cmd+Shift+D (macOS)
      const isDebugShortcut =
        event.shiftKey &&
        event.key.toLowerCase() === "d" &&
        (event.ctrlKey || event.metaKey);

      if (isDebugShortcut) {
        event.preventDefault();
        const currentDebugMode = settings?.debug_mode ?? false;
        updateSetting("debug_mode", !currentDebugMode);
      }
    };

    // Add event listener when component mounts
    document.addEventListener("keydown", handleKeyDown);

    // Cleanup event listener when component unmounts
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settings?.debug_mode, updateSetting]);

  const checkOnboardingStatus = async () => {
    try {
      const settingsResult = await commands.getAppSettings();
      const hasCompletedOnboarding =
        settingsResult.status === "ok" &&
        settingsResult.data.onboarding_completed === true;
      const currentPlatform = platform();

      if (hasCompletedOnboarding) {
        // Returning user - check if they need to grant permissions first
        isReturningUserRef.current = true;

        if (currentPlatform === "macos") {
          try {
            const [hasAccessibility, hasMicrophone] = await Promise.all([
              checkAccessibilityPermission(),
              checkMicrophonePermission(),
            ]);
            if (!hasAccessibility || !hasMicrophone) {
              await revealMainWindowForPermissions();
              setOnboardingStep("accessibility");
              return;
            }
          } catch (e) {
            console.warn("Failed to check macOS permissions:", e);
            // If we can't check, proceed to main app and let them fix it there
          }
        }

        if (currentPlatform === "windows") {
          try {
            const microphoneStatus =
              await commands.getWindowsMicrophonePermissionStatus();
            if (
              microphoneStatus.supported &&
              microphoneStatus.overall_access === "denied"
            ) {
              await revealMainWindowForPermissions();
              setOnboardingStep("accessibility");
              return;
            }
          } catch (e) {
            console.warn("Failed to check Windows microphone permissions:", e);
            // If we can't check, proceed to main app and let them fix it there
          }
        }

        setOnboardingStep("done");
      } else {
        // New user - start full onboarding
        isReturningUserRef.current = false;
        setOnboardingStep("accessibility");
      }
    } catch (error) {
      console.error("Failed to check onboarding status:", error);
      setOnboardingStep("accessibility");
    }
  };

  const handleAccessibilityComplete = () => {
    // Returning users already have models, skip to main app
    // New users need to select a model
    setOnboardingStep(isReturningUserRef.current ? "done" : "model");
  };

  const handleModelSelected = () => {
    // Transition to main app - user has started a download
    setOnboardingStep("done");
  };

  const { start: startAudioImport } = useAudioImport();

  const openRecordingsFolder = useCallback(async () => {
    try {
      const result = await commands.openRecordingsFolder();
      if (result.status !== "ok") {
        throw new Error(String(result.error));
      }
    } catch (error) {
      console.error("Failed to open recordings folder:", error);
    }
  }, []);

  const openAgentPanel = useCallback(async () => {
    try {
      const result = await commands.agentPanelOpen();
      if (result.status === "error") {
        toast.error(t("agentPanel.status.error"));
      }
    } catch {
      toast.error(t("agentPanel.status.error"));
    }
  }, [t]);

  const agentEnabled = settings?.agent_panel_enabled === true;

  const openCommandPalette = useCallback(() => setCommandOpen(true), []);

  /* Route changes go through `navigateToSection` here for the same reason the
   * sidebar rows do — the palette and the rail reach the same destinations, so
   * they cannot swap the view two different ways. */
  const commandActions = buildCommandActions({
    t,
    agentEnabled,
    onNavigate: navigateToSection,
    onNewMeeting: () =>
      runViewTransition(() => {
        setCurrentSection("meetings");
        setMeetingStartRequest((current) => current + 1);
      }),
    onImportAudio: () => void startAudioImport(),
    onOpenRecordings: () => void openRecordingsFolder(),
    onOpenAgent: () => void openAgentPanel(),
  });

  return (
    <MotionProvider>
      <Toaster />
      <AppEventListeners />
      <DetectionListeners />
      <AppContent
        onboardingStep={onboardingStep}
        onAccessibilityComplete={handleAccessibilityComplete}
        onModelSelected={handleModelSelected}
        direction={direction}
        currentSection={currentSection}
        onSectionChange={navigateToSection}
        loadingLabel={t("common.loading")}
        meetingInvalidation={meetingInvalidation}
        meetingNavigationRequest={meetingNavigationRequest}
        meetingStartRequest={meetingStartRequest}
        commandOpen={commandOpen}
        commandActions={commandActions}
        onCommandOpenChange={setCommandOpen}
        onCommandOpen={openCommandPalette}
      />
    </MotionProvider>
  );
}

export default App;
