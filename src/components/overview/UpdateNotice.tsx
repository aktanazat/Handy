import React from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Alert, Button, IconButton, StatusText } from "@/components/ui";
import type { UpdateCheckResult } from "@/lib/updateCheck";

/* Two surfaces, deliberately unequal.
 *
 * An available update is worth one dismissible line at the top of the page.
 * A failed check is not: it is a quiet line at the foot of the page with a
 * retry, because a GitHub request that did not come back says nothing about
 * the app in front of you. "up_to_date" and "disabled" render nothing at all. */

interface UpdateBannerProps {
  result: UpdateCheckResult;
  onDismiss: () => void;
}

export const UpdateBanner: React.FC<UpdateBannerProps> = ({
  result,
  onDismiss,
}) => {
  const { t } = useTranslation();
  const url = result.url;

  const openRelease = async () => {
    if (url === null) return;
    try {
      await openUrl(url);
    } catch (error) {
      console.error("Failed to open the release page:", error);
    }
  };

  return (
    <Alert
      variant="info"
      action={
        <>
          {url !== null && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void openRelease()}
            >
              {t("overview.update.view", "View release")}
            </Button>
          )}
          <IconButton
            label={t("overview.update.dismiss", "Dismiss")}
            icon={<X className="size-4" aria-hidden="true" />}
            size="sm"
            onClick={onDismiss}
          />
        </>
      }
    >
      {t(
        "overview.update.available",
        "Sona {{latest}} is available. This install is on {{current}}.",
        {
          latest: result.latest_version ?? "",
          current: result.current_version,
        },
      )}
    </Alert>
  );
};

interface UpdateCheckFailureProps {
  result: UpdateCheckResult;
  onRetry: () => void;
  retrying: boolean;
}

export const UpdateCheckFailure: React.FC<UpdateCheckFailureProps> = ({
  result,
  onRetry,
  retrying,
}) => {
  const { t } = useTranslation();

  return (
    <div className="ov-footer-note">
      <StatusText tone="muted" live="polite">
        {result.error === null
          ? t("overview.update.failed", "Could not check for updates.")
          : t(
              "overview.update.failedWithReason",
              "Could not check for updates: {{reason}}",
              { reason: result.error },
            )}
      </StatusText>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRetry}
        disabled={retrying}
      >
        {t("common.retry")}
      </Button>
    </div>
  );
};
