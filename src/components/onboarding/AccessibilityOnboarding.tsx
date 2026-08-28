import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { platform } from "@tauri-apps/plugin-os";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
  checkMicrophonePermission,
  requestMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import { toast } from "sonner";
import { commands } from "@/bindings";
import { useSettingsStore } from "@/stores/settingsStore";
import { SonaMark } from "../icons/SonaMark";
import { SonaWordmark } from "../icons/SonaWordmark";
import { Keyboard, Mic, Check, Loader2 } from "lucide-react";

interface AccessibilityOnboardingProps {
  onComplete: () => void;
}

type PermissionStatus = "checking" | "needed" | "waiting" | "granted";
type PermissionPlatform = "macos" | "windows" | "other";

interface PermissionsState {
  accessibility: PermissionStatus;
  microphone: PermissionStatus;
}

interface PermissionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: PermissionStatus;
  grantLabel: string;
  onGrant: () => void;
}

const PermissionCard: React.FC<PermissionCardProps> = ({
  icon,
  title,
  description,
  status,
  grantLabel,
  onGrant,
}) => {
  const { t } = useTranslation();

  return (
    <div className="onboarding-permission-card w-full p-4">
      <div className="flex items-center gap-3">
        {icon}
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-text">{title}</h3>
          <p className="text-sm text-text/60 mb-3">{description}</p>
          {status === "granted" ? (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Check className="w-4 h-4" />
              {t("onboarding.permissions.granted")}
            </div>
          ) : status === "waiting" ? (
            <div className="flex items-center gap-2 text-text/50 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("onboarding.permissions.waiting")}
            </div>
          ) : (
            <button
              type="button"
              onClick={onGrant}
              className="liquid-control min-h-8 bg-inverse-background px-3 text-sm font-medium text-inverse-text transition-colors hover:bg-text-primary"
            >
              {grantLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

interface PermissionOnboardingViewState {
  isChecking: boolean;
  allGranted: boolean;
  showMicrophonePermission: boolean;
  showAccessibilityPermission: boolean;
  isWindows: boolean;
}

interface PermissionOnboardingContentProps {
  view: PermissionOnboardingViewState;
  microphoneStatus: PermissionStatus;
  accessibilityStatus: PermissionStatus;
  onGrantMicrophone: () => void;
  onGrantAccessibility: () => void;
}

const PermissionOnboardingContent: React.FC<PermissionOnboardingContentProps> = ({
  view,
  microphoneStatus,
  accessibilityStatus,
  onGrantMicrophone,
  onGrantAccessibility,
}) => {
  const {
    isChecking,
    allGranted,
    showMicrophonePermission,
    showAccessibilityPermission,
    isWindows,
  } = view;
  const { t } = useTranslation();

  if (isChecking) {
    return (
      <div className="onboarding-shell h-screen w-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-text/50" />
      </div>
    );
  }

  if (allGranted) {
    return (
      <div className="onboarding-shell h-screen w-screen flex flex-col items-center justify-center gap-4">
        <div className="rounded-md border border-border bg-surface p-3">
          <Check className="h-8 w-8 text-text-primary" />
        </div>
        <p className="text-lg font-medium text-text">
          {t("onboarding.permissions.allGranted")}
        </p>
      </div>
    );
  }

  return (
    <div className="onboarding-shell h-screen w-screen flex flex-col p-6 gap-6 items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-text-primary">
        <SonaMark width={36} height={36} />
        <SonaWordmark className="text-2xl" />
      </div>

      <div className="onboarding-permission-panel max-w-md w-full flex flex-col items-center gap-4">
        <div className="text-center mb-2">
          <h2 className="text-xl font-semibold text-text mb-2">
            {t("onboarding.permissions.title")}
          </h2>
          <p className="text-text/70">
            {t("onboarding.permissions.description")}
          </p>
        </div>

        {showMicrophonePermission && (
          <PermissionCard
            icon={<Mic className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />}
            title={t("onboarding.permissions.microphone.title")}
            description={t("onboarding.permissions.microphone.description")}
            status={microphoneStatus}
            grantLabel={
              isWindows
                ? t("accessibility.openSettings")
                : t("onboarding.permissions.grant")
            }
            onGrant={onGrantMicrophone}
          />
        )}

        {showAccessibilityPermission && (
          <PermissionCard
            icon={<Keyboard className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />}
            title={t("onboarding.permissions.accessibility.title")}
            description={t("onboarding.permissions.accessibility.description")}
            status={accessibilityStatus}
            grantLabel={t("onboarding.permissions.grant")}
            onGrant={onGrantAccessibility}
          />
        )}
      </div>
    </div>
  );
};

const AccessibilityOnboarding: React.FC<AccessibilityOnboardingProps> = ({
  onComplete,
}) => {
  const { t } = useTranslation();
  const refreshAudioDevices = useSettingsStore(
    (state) => state.refreshAudioDevices,
  );
  const refreshOutputDevices = useSettingsStore(
    (state) => state.refreshOutputDevices,
  );
  const [permissionPlatform, setPermissionPlatform] =
    useState<PermissionPlatform | null>(null);
  const [permissions, setPermissions] = useState<PermissionsState>({
    accessibility: "checking",
    microphone: "checking",
  });
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorCountRef = useRef<number>(0);
  const MAX_POLLING_ERRORS = 3;

  const isMacOS = permissionPlatform === "macos";
  const isWindows = permissionPlatform === "windows";
  const showMicrophonePermission = isMacOS || isWindows;
  const showAccessibilityPermission = isMacOS;

  const allGranted = isMacOS
    ? permissions.accessibility === "granted" &&
      permissions.microphone === "granted"
    : isWindows
      ? permissions.microphone === "granted"
      : true;

  const completeOnboarding = useCallback(async () => {
    await Promise.all([refreshAudioDevices(), refreshOutputDevices()]);
    timeoutRef.current = setTimeout(() => onComplete(), 300);
  }, [onComplete, refreshAudioDevices, refreshOutputDevices]);

  const hasWindowsMicrophoneAccess = useCallback(async (): Promise<boolean> => {
    const microphoneStatus =
      await commands.getWindowsMicrophonePermissionStatus();

    if (!microphoneStatus.supported) {
      return true;
    }

    return microphoneStatus.overall_access !== "denied";
  }, []);

  // Check platform and permission status on mount
  useEffect(() => {
    let cancelled = false;
    const currentPlatform = platform();
    const nextPlatform: PermissionPlatform =
      currentPlatform === "macos"
        ? "macos"
        : currentPlatform === "windows"
          ? "windows"
          : "other";

    setPermissionPlatform(nextPlatform);

    // Skip immediately on unsupported platforms
    if (nextPlatform === "other") {
      onComplete();
      return;
    }

    const checkInitial = async () => {
      if (nextPlatform === "macos") {
        try {
          const [accessibilityGranted, microphoneGranted] = await Promise.all([
            checkAccessibilityPermission(),
            checkMicrophonePermission(),
          ]);
          if (cancelled) return;

          // If accessibility is granted, initialize Enigo and shortcuts
          if (accessibilityGranted) {
            try {
              await Promise.all([
                commands.initializeEnigo(),
                commands.initializeShortcuts(),
              ]);
            } catch (e) {
              console.warn("Failed to initialize after permission grant:", e);
            }
          }

          if (cancelled) return;
          const newState: PermissionsState = {
            accessibility: accessibilityGranted ? "granted" : "needed",
            microphone: microphoneGranted ? "granted" : "needed",
          };

          setPermissions(newState);

          if (!cancelled && accessibilityGranted && microphoneGranted) {
            await completeOnboarding();
          }
        } catch (error) {
          console.error("Failed to check macOS permissions:", error);
          if (cancelled) return;
          toast.error(t("onboarding.permissions.errors.checkFailed"));
          setPermissions({
            accessibility: "needed",
            microphone: "needed",
          });
        }

        return;
      }

      try {
        const microphoneGranted = await hasWindowsMicrophoneAccess();
        if (cancelled) return;

        setPermissions({
          accessibility: "granted",
          microphone: microphoneGranted ? "granted" : "needed",
        });

        if (!cancelled && microphoneGranted) {
          await completeOnboarding();
        }
      } catch (error) {
        console.warn("Failed to check Windows microphone permissions:", error);
        if (cancelled) return;
        setPermissions({
          accessibility: "granted",
          microphone: "granted",
        });
        await completeOnboarding();
      }
    };

    void checkInitial();
    return () => {
      cancelled = true;
    };
  }, [completeOnboarding, hasWindowsMicrophoneAccess, onComplete, t]);

  // Polling for permissions after user clicks a button
  const startPolling = useCallback(() => {
    if (pollingRef.current || permissionPlatform === null) return;

    pollingRef.current = setInterval(async () => {
      try {
        if (permissionPlatform === "windows") {
          const microphoneGranted = await hasWindowsMicrophoneAccess();

          if (microphoneGranted) {
            setPermissions((prev) => ({ ...prev, microphone: "granted" }));

            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }

            await completeOnboarding();
          }

          errorCountRef.current = 0;
          return;
        }

        const [accessibilityGranted, microphoneGranted] = await Promise.all([
          checkAccessibilityPermission(),
          checkMicrophonePermission(),
        ]);

        setPermissions((prev) => {
          const newState = { ...prev };

          if (accessibilityGranted && prev.accessibility !== "granted") {
            newState.accessibility = "granted";
            // Initialize Enigo and shortcuts when accessibility is granted
            Promise.all([
              commands.initializeEnigo(),
              commands.initializeShortcuts(),
            ]).catch((e) => {
              console.warn("Failed to initialize after permission grant:", e);
            });
          }

          if (microphoneGranted && prev.microphone !== "granted") {
            newState.microphone = "granted";
          }

          return newState;
        });

        // If both granted, stop polling, refresh audio devices, and proceed
        if (accessibilityGranted && microphoneGranted) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          await completeOnboarding();
        }

        // Reset error count on success
        errorCountRef.current = 0;
      } catch (error) {
        console.error("Error checking permissions:", error);
        errorCountRef.current += 1;

        if (errorCountRef.current >= MAX_POLLING_ERRORS) {
          // Stop polling after too many consecutive errors
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          toast.error(t("onboarding.permissions.errors.checkFailed"));
        }
      }
    }, 1000);
  }, [completeOnboarding, hasWindowsMicrophoneAccess, permissionPlatform, t]);

  // Cleanup polling and timeouts on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleGrantAccessibility = async () => {
    try {
      await requestAccessibilityPermission();
      setPermissions((prev) => ({ ...prev, accessibility: "waiting" }));
      startPolling();
    } catch (error) {
      console.error("Failed to request accessibility permission:", error);
      toast.error(t("onboarding.permissions.errors.requestFailed"));
    }
  };

  const handleGrantMicrophone = async () => {
    try {
      if (isWindows) {
        await commands.openMicrophonePrivacySettings();
      } else {
        await requestMicrophonePermission();
      }

      setPermissions((prev) => ({ ...prev, microphone: "waiting" }));
      startPolling();
    } catch (error) {
      console.error("Failed to request microphone permission:", error);
      toast.error(t("onboarding.permissions.errors.requestFailed"));
    }
  };

  const isChecking =
    permissionPlatform === null ||
    (isMacOS &&
      permissions.accessibility === "checking" &&
      permissions.microphone === "checking") ||
    (isWindows && permissions.microphone === "checking");

  return (
    <PermissionOnboardingContent
      view={{
        isChecking,
        allGranted,
        showMicrophonePermission,
        showAccessibilityPermission,
        isWindows,
      }}
      microphoneStatus={permissions.microphone}
      accessibilityStatus={permissions.accessibility}
      onGrantMicrophone={handleGrantMicrophone}
      onGrantAccessibility={handleGrantAccessibility}
    />
  );
};

export default AccessibilityOnboarding;
