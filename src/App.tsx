import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
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
import { TopNav } from "./components/TopNav";
import { CommandPalette } from "./components/CommandPalette";
import { DetectionListeners } from "./components/settings/meetings/DetectionListeners";
import { RouteSkeleton, Toaster } from "./components/ui";
import {
  commandActionIcons,
  type CommandPaletteAction,
} from "./components/commandPaletteActions";
import {
  SECTIONS_CONFIG,
  type SidebarSection,
} from "./components/sidebarSections";
import { WhatsNewGate } from "./components/whats-new";
import { useSettings } from "./hooks/useSettings";
import { useSettingsStore } from "./stores/settingsStore";
import { commands, events, type MeetingNavigationPayload } from "@/bindings";
import {
  getLanguageDirection,
  initializeRTL,
  type LanguageDirection,
} from "@/lib/utils/rtl";
import { runViewTransition } from "@/lib/utils/viewTransition";

type OnboardingStep = "accessibility" | "model" | "done";

const MEDIA_IMPORT_EXTENSIONS = [
  "wav",
  "mp3",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "mov",
  "mp4",
  "m4v",
];

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

/* The toast surface and the route skeleton both live in the design system;
 * the shell only decides where they mount. */

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
  onCommandClose: () => void;
  onCommandOpen: () => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
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
  onCommandClose,
  onCommandOpen,
  scrollRef,
  onScroll,
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
      className="app-shell flex h-screen flex-col select-none cursor-default"
    >
      <ErrorBoundary context="What's New">
        <WhatsNewGate />
      </ErrorBoundary>
      <TopNav
        activeSection={currentSection}
        onSectionChange={onSectionChange}
        onOpenCommand={onCommandOpen}
      />
      <main className="settings-main flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="settings-scroll flex-1 overflow-y-auto"
        >
          <div className="settings-content flex w-full flex-col items-stretch">
            <AccessibilityPermissions />
            <SecureInputWarning />
            {/* Keyed on the section so switching routes shows the skeleton
             * again rather than holding the previous page while the next
             * chunk loads, and so a crashed section resets when you leave. */}
            <ErrorBoundary key={currentSection} context={currentSection}>
              <Suspense fallback={<RouteSkeleton label={loadingLabel} />}>
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
        </div>
      </main>
      <CommandPalette
        open={commandOpen}
        onClose={onCommandClose}
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
  {
    id: "nav-overview",
    group: "navigation",
    label: t("sidebar.overview"),
    icon: commandActionIcons.folder,
    run: () => onNavigate("overview"),
  },
  {
    id: "nav-meetings",
    group: "navigation",
    label: t("sidebar.meetings"),
    icon: commandActionIcons.video,
    run: () => onNavigate("meetings"),
  },
  {
    id: "nav-history",
    group: "navigation",
    label: t("sidebar.history"),
    icon: commandActionIcons.file,
    run: () => onNavigate("history"),
  },
  {
    id: "nav-modes",
    group: "navigation",
    label: t("sidebar.modes"),
    icon: commandActionIcons.mic,
    run: () => onNavigate("modes"),
  },
  {
    id: "nav-models",
    group: "navigation",
    label: t("sidebar.models"),
    icon: commandActionIcons.mic,
    run: () => onNavigate("models"),
  },
  {
    id: "nav-settings",
    group: "navigation",
    label: t("sidebar.settings"),
    icon: commandActionIcons.folder,
    run: () => onNavigate("settings"),
  },
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
            "Nothing was selected. Select the text you want to change, then hold the command shortcut and say what to do.",
          ),
        );
      } else if (error_type === "command_rewrite_unavailable") {
        toast.error(
          t(
            "errors.commandRewriteUnavailable",
            "The rewrite returned nothing, so your selection was left as it was. Check the rewrite model in Settings > AI and try again.",
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

  /* The top bar only goes solid once page content passes under it. The flag
   * lives on the document root, the way Vercel's own chrome tracks it, so the
   * bar can react in CSS without this component re-rendering on every scroll
   * event. Re-synced per route because a shorter page can leave the pane
   * clamped back at the top without emitting a scroll. */
  const scrollRef = useRef<HTMLDivElement>(null);
  const syncScrolled = useCallback(() => {
    document.documentElement.toggleAttribute(
      "data-scrolled",
      (scrollRef.current?.scrollTop ?? 0) > 4,
    );
  }, []);
  useEffect(syncScrolled, [currentSection, syncScrolled]);

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

  // Global command palette trigger: Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        !(event.metaKey || event.ctrlKey)
      ) {
        return;
      }
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

  const startAudioImport = useCallback(async () => {
    try {
      const selectedPath = await open({
        directory: false,
        multiple: false,
        filters: [
          {
            name: t("settings.history.audioImport.fileFilter"),
            extensions: MEDIA_IMPORT_EXTENSIONS,
          },
        ],
      });
      if (selectedPath === null || Array.isArray(selectedPath)) return;
      const result = await commands.importAudioFile(selectedPath);
      if (result.status === "error") {
        toast.error(t("settings.history.audioImport.errors.start"));
      }
    } catch {
      toast.error(t("settings.history.audioImport.errors.start"));
    }
  }, [t]);

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

  const commandActions = buildCommandActions({
    t,
    agentEnabled,
    onNavigate: (section) => setCurrentSection(section),
    onNewMeeting: () => {
      setCurrentSection("meetings");
      setMeetingStartRequest((current) => current + 1);
    },
    onImportAudio: () => void startAudioImport(),
    onOpenRecordings: () => void openRecordingsFolder(),
    onOpenAgent: () => void openAgentPanel(),
  });

  return (
    <>
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
        onCommandClose={() => setCommandOpen(false)}
        onCommandOpen={() => setCommandOpen(true)}
        scrollRef={scrollRef}
        onScroll={syncScrolled}
      />
    </>
  );
}

export default App;
