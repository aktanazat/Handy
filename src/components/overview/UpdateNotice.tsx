import React from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/vg/button";
import { SettingsCard } from "@/components/settings/rows";
import type { UpdateCheckResult } from "@/lib/updateCheck";

/* Two surfaces, deliberately unequal.
 *
 * An available update is worth one dismissible row above the hero: a bordered
 * line, the sentence, the release, the dismiss. A failed check is not — it is a
 * quiet unbordered line at the foot of the page with a retry, because a GitHub
 * request that did not come back says nothing about the app in front of you.
 * "up_to_date" and "disabled" render nothing at all. */

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
    <SettingsCard className="flex flex-wrap items-center gap-3 px-6 py-3.5">
      <span className="min-w-0 flex-1 text-[14px] leading-[21px] text-gray-1000">
        {t(
          "overview.update.available",
          "Sona {{latest}} is available. This install is on {{current}}.",
          {
            latest: result.latest_version ?? "",
            current: result.current_version,
          },
        )}
      </span>
      {/* Bordered, not filled: the page's one filled button starts a meeting,
       * and a release note is not a bigger promise than that. */}
      {url !== null && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => void openRelease()}
        >
          {t("overview.update.view", "View release")}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("overview.update.dismiss", "Dismiss")}
        onClick={onDismiss}
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </SettingsCard>
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
    <div className="flex flex-wrap items-center gap-3 px-1">
      <span
        aria-live="polite"
        className="min-w-0 flex-1 text-[13px] leading-[18px] text-gray-900"
      >
        {result.error === null
          ? t("overview.update.failed", "Could not check for updates.")
          : t(
              "overview.update.failedWithReason",
              "Could not check for updates: {{reason}}",
              { reason: result.error },
            )}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onRetry}
        disabled={retrying}
      >
        {t("common.retry")}
      </Button>
    </div>
  );
};
