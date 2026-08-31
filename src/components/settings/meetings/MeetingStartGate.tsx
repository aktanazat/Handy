import React, { useMemo, useState } from "react";
import { ArrowLeft, RefreshCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  MeetingConsentInput,
  MeetingReviewSnapshot,
  SourceKind,
} from "@/bindings";
import { cn } from "@/lib/cn";
import {
  PageTitle,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Checkbox } from "@/components/vg/checkbox";
import { useSettingsStore } from "@/stores/settingsStore";
import { MeetingPreviewCard } from "./MeetingPreviewCard";
import { MeetingSourceList, SourceAvailabilityText } from "./MeetingStatus";
import type { MeetingStartOptions } from "./meetingTypes";
import { preflightAllowsAction } from "./meetingUtils";

/* The only screen left between pressing Start and recording, and it appears
 * exactly when pressing Start could not work: the session exists but a source
 * it was told to record is unavailable.
 *
 * It is not a wizard step. It names the one thing that is wrong and offers the
 * two honest ways out — fix it and retry, or record without that source and
 * carry the partial mark. The wrong source is named once, in the capture-status
 * rows: those rows already print every source's availability in its own tone,
 * so the card that used to list the blocked ones above them was the same fact
 * twice on one screen.
 *
 * The assurance sentence sits directly above the action row here too, on the
 * page rather than behind an affordance, because this is one of the three
 * paths that send the consent flags and those flags may only claim what the
 * person could read before pressing. */

interface MeetingStartGateProps {
  snapshot: MeetingReviewSnapshot;
  options: MeetingStartOptions;
  refreshing: boolean;
  starting: boolean;
  onRefresh: () => void;
  onCancel: () => void;
  onStart: (consent: MeetingConsentInput) => void;
}

export const MeetingStartGate: React.FC<MeetingStartGateProps> = ({
  snapshot,
  options,
  refreshing,
  starting,
  onRefresh,
  onCancel,
  onStart,
}) => {
  const { t } = useTranslation();
  const [partialAccepted, setPartialAccepted] = useState(false);
  const notesTemplate = useSettingsStore(
    (state) => state.settings?.meeting_notes_template ?? null,
  );
  const blockedSources = useMemo(
    () =>
      snapshot.session.sources.filter(
        (source) => source.required && source.availability !== "available",
      ),
    [snapshot.session.sources],
  );
  const blocked = blockedSources.length > 0;
  const storageAvailable = snapshot.session.storage === "available";
  const canStart = preflightAllowsAction(snapshot.session, "start");

  /* Consent flags are populated here: the click on the labelled Start button
   * rendered below the assurance line on this screen is the operator's
   * acknowledgment, and the MeetingConsent row records that act. */
  const start = (acceptPartial: boolean) =>
    onStart(
      consentFor(
        options,
        acceptPartial ? blockedSources.map((source) => source.source_kind) : [],
        acceptPartial,
      ),
    );

  const refresh = (
    <Button
      type="button"
      variant="outline"
      onClick={onRefresh}
      disabled={
        refreshing ||
        starting ||
        !preflightAllowsAction(snapshot.session, "refresh_preflight")
      }
    >
      <RefreshCcw aria-hidden="true" />
      {refreshing
        ? t("meetings.preflight.refreshing", "Checking…")
        : t("meetings.actions.refresh")}
    </Button>
  );

  return (
    <SettingsPage
      header={
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ms-2.5 self-start"
            onClick={onCancel}
            disabled={starting}
          >
            <ArrowLeft aria-hidden="true" />
            {t("meetings.actions.back")}
          </Button>
          <PageTitle>
            {blocked || !canStart
              ? t("meetings.gate.title", "Recording did not start")
              : t("meetings.gate.readyTitle", "Ready to record")}
          </PageTitle>
        </div>
      }
    >
      {/* What is about to be recorded, when the operator got here from a
       * meeting Sona had already identified. The card carries no Start of its
       * own: this screen's action row below is the consent act, and a second
       * affirmative button would make it ambiguous which press was recorded
       * as the acknowledgment. Sources read as settled text here because the
       * session already exists with them. */}
      {options.preview === null ? null : (
        <ul className="flex flex-col gap-2">
          <MeetingPreviewCard
            facts={options.preview}
            defaultExpanded
            recording={{ armed: options.sources }}
            notesTemplate={notesTemplate}
          />
        </ul>
      )}

      <SettingsSection label={t("meetings.review.status")}>
        <MeetingSourceList
          sources={snapshot.session.sources}
          label={t("meetings.review.status")}
        />
        <SettingsRow label={t("meetings.preflight.storage")}>
          <span
            className={cn(
              "text-[12px] leading-4",
              storageAvailable ? "text-gray-800" : "text-red-900",
            )}
          >
            {storageAvailable
              ? t("meetings.preflight.storageAvailable")
              : t("meetings.preflight.storageUnavailable")}
          </span>
        </SettingsRow>
        <SettingsRow label={t("meetings.preflight.localModel")}>
          <SourceAvailabilityText
            availability={
              snapshot.session.preflight_local_processing ?? "unknown"
            }
            live="polite"
          />
        </SettingsRow>
      </SettingsSection>

      <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-5 text-gray-800">
          {t(
            "meetings.start.assurance",
            "Records your Mac's audio locally. Nothing joins the call.",
          )}
        </p>

        {blocked ? (
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="gate-accept-partial"
              className="mt-0.5"
              checked={partialAccepted}
              disabled={starting}
              onCheckedChange={() => setPartialAccepted(!partialAccepted)}
            />
            <label
              htmlFor="gate-accept-partial"
              className="text-pretty text-[13px] leading-5 text-gray-900"
            >
              {t(
                "meetings.gate.recordAnywayHint",
                "The record is marked partial and the missing source stays named in it.",
              )}
            </label>
          </div>
        ) : null}

        {canStart ? null : (
          <p role="status" className="text-[13px] leading-5 text-red-900">
            {t("meetings.reasons.invalid_transition")}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {refresh}
          {blocked ? (
            <Button
              type="button"
              onClick={() => start(true)}
              disabled={!partialAccepted || starting || !canStart}
            >
              {starting
                ? t("meetings.start.starting", "Starting…")
                : t("meetings.gate.recordAnyway", "Record without it")}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => start(false)}
              disabled={starting || !canStart}
            >
              {starting
                ? t("meetings.start.starting", "Starting…")
                : t("meetings.start.action", "Start recording")}
            </Button>
          )}
        </div>
      </div>
    </SettingsPage>
  );
};

/* Consent, in the wire shape the backend persists per attempt.
 *
 * The click on the labelled Start button below the assurance line is the
 * operator's acknowledgment; the MeetingConsent row records that act. There is
 * no separate tick box any more, so a caller that sets these flags from a
 * surface without the assurance sentence on screen would make the row assert
 * an acknowledgment nobody could have made. */
export const consentFor = (
  options: MeetingStartOptions,
  acceptedMissingSources: SourceKind[],
  acceptPartial: boolean,
): MeetingConsentInput => ({
  policy_version: 1,
  microphone_acknowledged: options.sources.includes("microphone"),
  system_audio_acknowledged: options.sources.includes("system_audio"),
  known_missing_sources_acknowledged: acceptedMissingSources,
  degraded_start_policy: acceptPartial
    ? "continue_and_mark_partial"
    : options.degradedStartPolicy,
  destination: options.destination,
  remote_acknowledgement: null,
});
