import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
} from "tauri-plugin-macos-permissions-api";

// Define permission state type
type PermissionState = "request" | "verify" | "granted";

// Define button configuration type
interface ButtonConfig {
  text: string;
  className: string;
}

const AccessibilityPermissions: React.FC = () => {
  const { t } = useTranslation();
  const [hasAccessibility, setHasAccessibility] = useState<boolean>(false);
  const [permissionState, setPermissionState] =
    useState<PermissionState>("request");

  // Accessibility permissions are only required on macOS
  const isMacOS = type() === "macos";

  // Check permissions without requesting
  const checkPermissions = async (): Promise<boolean> => {
    const hasPermissions: boolean = await checkAccessibilityPermission();
    setHasAccessibility(hasPermissions);
    setPermissionState(hasPermissions ? "granted" : "verify");
    return hasPermissions;
  };

  // Handle the unified button action based on current state
  const handleButtonClick = async (): Promise<void> => {
    if (permissionState === "request") {
      try {
        await requestAccessibilityPermission();
        // After system prompt, transition to verification state
        setPermissionState("verify");
      } catch (error) {
        console.error("Error requesting permissions:", error);
        setPermissionState("verify");
      }
    } else if (permissionState === "verify") {
      // State is "verify" - check if permission was granted
      await checkPermissions();
    }
  };

  // On app boot - check permissions (only on macOS)
  useEffect(() => {
    if (!isMacOS) return;

    let cancelled = false;

    const initialSetup = async (): Promise<void> => {
      const hasPermissions: boolean = await checkAccessibilityPermission();
      if (cancelled) return;

      setHasAccessibility(hasPermissions);
      setPermissionState(hasPermissions ? "granted" : "request");
    };

    void initialSetup();
    return () => {
      cancelled = true;
    };
  }, [isMacOS]);

  // Skip rendering on non-macOS platforms or if permission is already granted
  if (!isMacOS || hasAccessibility) {
    return null;
  }

  // Configure button text and style based on state
  const buttonConfig: Record<PermissionState, ButtonConfig | null> = {
    request: {
      text: t("accessibility.openSettings"),
      className:
        "liquid-control min-h-8 cursor-pointer border border-border bg-surface px-3 text-sm font-medium text-text-primary hover:border-border-strong hover:bg-hover",
    },
    verify: {
      text: t("accessibility.openSettings"),
      className:
        "liquid-control min-h-8 cursor-pointer border border-border bg-surface px-3 text-sm font-medium text-text-primary hover:border-border-strong hover:bg-hover",
    },
    granted: null,
  };

  const config = buttonConfig[permissionState] as ButtonConfig;

  return (
    <div
      role="status"
      className="w-full rounded-md border border-border bg-surface p-3"
    >
      <div className="flex justify-between items-center gap-2">
        <div className="">
          <p className="text-sm font-medium text-text-primary">
            {t("accessibility.permissionsDescription")}
          </p>
        </div>
        <button onClick={handleButtonClick} className={config.className}>
          {config.text}
        </button>
      </div>
    </div>
  );
};

export default AccessibilityPermissions;
