import React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { FactChip } from "@/components/settings/rows";
import { FailureNotice } from "./FailureNotice";
import {
  useCloudSyncServiceStatus,
  type CloudSyncServiceStatus,
} from "./privacyStatus";
import { useEgressRoutes } from "./useEgressRoutes";

/* One state word for the chip. Why a route is unavailable is a sentence, and
 * sentences belong in the notice below, not in a slot styled for
 * measurements. */
export const cloudSyncFact = (
  status: CloudSyncServiceStatus | null,
  t: TFunction,
): string => {
  if (status === null) return "…";
  if (status.error) return t("cloudSync.account.status.unavailable");
  if (!status.configured)
    return t("settings.privacy.cloudSync.notConfigured", "Not configured");
  return (
    status.endpoint ?? t("settings.privacy.cloudSync.configured", "Configured")
  );
};

/* The privacy page in four lines: one sentence that holds regardless of
 * settings, then one compact fact per route that can carry anything off this
 * Mac. Every other reassurance paragraph that used to be scattered through
 * that page collapsed into here, and nothing restates it.
 *
 * A bare block, not a card: Advanced keeps it behind a disclosure whose
 * summary already names it. */
export const PrivacyEgress: React.FC = () => {
  const { t } = useTranslation();
  const {
    cloudRoutePending,
    configuredCloudProviders,
    checkingCloudSttRoutes,
    cloudSttRouteError,
    cloudSttDisclosureProviders,
    retryCloudSttRoutes,
  } = useEgressRoutes();
  const service = useCloudSyncServiceStatus();
  const status = service.value;
  const thisMac = t("settings.privacy.egress.thisMac");

  return (
    <div className="flex flex-col gap-3 px-6 py-3.5">
      <p className="text-[14px] leading-[21px] text-gray-900">
        {t("settings.privacy.egress.assurance")}
      </p>
      {/* A route whose state could not be read shows no fact at all: a chip
       * reading "this Mac" would be a guess, and this is the one page that
       * cannot guess. */}
      <div aria-live="polite" className="flex flex-col gap-1.5">
        <FactChip
          label={t("settings.privacy.egress.routes.cleanup")}
          value={
            cloudRoutePending
              ? "…"
              : configuredCloudProviders.length > 0
                ? configuredCloudProviders.join(", ")
                : thisMac
          }
        />
        {cloudSttRouteError ? null : (
          <FactChip
            label={t("settings.privacy.cloudTranscription.title")}
            value={
              checkingCloudSttRoutes
                ? "…"
                : cloudSttDisclosureProviders.length > 0
                  ? cloudSttDisclosureProviders
                      .map((provider) => t(provider.labelKey))
                      .join(", ")
                  : thisMac
            }
          />
        )}
        {/* The chip names the ROUTE — which provider, or this Mac. This names
         * the PAYLOAD, and it is the one sentence in the app that itemises
         * what actually leaves the machine — so while a cloud route exists it
         * is read, not hovered, the same standing the meetings assurance has.
         * With no cloud route there is nothing leaving and nothing to say. */}
        {cloudSttRouteError ||
        cloudSttDisclosureProviders.length === 0 ? null : (
          <p className="text-[14px] leading-[21px] text-gray-900">
            {t("settings.privacy.cloudTranscription.disclosure")}
          </p>
        )}
        {service.phase === "failed" ? null : (
          <FactChip
            label={t("settings.privacy.cloudSync.title", "Cloud sync")}
            value={cloudSyncFact(status, t)}
          />
        )}
      </div>
      {cloudSttRouteError ? (
        <FailureNotice onRetry={retryCloudSttRoutes}>
          {t("settings.privacy.cloudTranscription.checkFailed")}
        </FailureNotice>
      ) : null}
      {service.phase === "failed" ? (
        <FailureNotice onRetry={service.reload}>
          {t(
            "settings.privacy.cloudSync.checkFailed",
            "Sona could not read the cloud sync configuration.",
          )}
          {service.error === null ? "" : ` ${service.error}`}
        </FailureNotice>
      ) : null}
      {status?.error ? (
        <FailureNotice>{t("cloudSync.errors." + status.error)}</FailureNotice>
      ) : null}
    </div>
  );
};
