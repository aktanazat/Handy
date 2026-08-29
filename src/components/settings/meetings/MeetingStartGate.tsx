import React, { useMemo, useState } from "react";
import { ArrowLeft, RefreshCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  MeetingConsentInput,
  MeetingReviewSnapshot,
  SourceKind,
} from "@/bindings";
import { Button, Section, StatusText } from "../../ui";
import { useSettingsStore } from "@/stores/settingsStore";
import { MeetingPreviewCard } from "./MeetingPreviewCard";
import { MeetingSourceList, ProcessingStatusText } from "./MeetingStatus";
import type { MeetingStartOptions } from "./meetingTypes";
import { sourceAvailabilityKey, sourceKey } from "./meetingUtils";

/* The only screen left between pressing Start and recording, and it appears
 * exactly when pressing Start could not work: the session exists but a source
 * it was told to record is unavailable.
 *
 * It is not a wizard step. It names the one thing that is wrong and offers the
 * two honest ways out — fix it and retry, or record without that source and
 * carry the partial mark. The assurance sentence sits directly above the
 * action row here too, because this is one of the three paths that send the
 * consent flags and those flags may only claim what the person could read
 * before pressing. */

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
      variant="ghost"
      onClick={onRefresh}
      disabled={refreshing || starting}
    >
      <RefreshCcw size={14} aria-hidden="true" />
      {refreshing
        ? t("meetings.preflight.refreshing", "Checking…")
        : t("meetings.actions.refresh")}
    </Button>
  );

  return (
    <div className="settings-page">
      <header className="settings-page-header flex flex-col gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ms-2.5 self-start"
          onClick={onCancel}
          disabled={starting}
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {t("meetings.actions.back")}
        </Button>
        <h1 className="settings-page-title">
          {blocked
            ? t("meetings.gate.title", "Recording did not start")
            : t("meetings.gate.readyTitle", "Ready to record")}
        </h1>
        <p className="settings-page-description">
          {blocked
            ? t(
                "meetings.gate.description",
                "Sona created the meeting, but a source it was told to record is unavailable.",
              )
            : t(
                "meetings.gate.readyDescription",
                "Nothing is blocking capture for this meeting.",
              )}
        </p>
      </header>

      {/* What is about to be recorded, when the operator got here from a
       * meeting Sona had already identified. The card carries no Start of its
       * own: this screen's action row below is the consent act, and a second
       * affirmative button would make it ambiguous which press was recorded
       * as the acknowledgment. Sources read as settled text here because the
       * session already exists with them. */}
      {options.preview === null ? null : (
        <ul className="meeting-previews">
          <MeetingPreviewCard
            facts={options.preview}
            defaultExpanded
            recording={{ armed: options.sources }}
            notesTemplate={notesTemplate}
          />
        </ul>
      )}

      {blocked ? (
        <ul
          className="meeting-rows"
          aria-label={t("meetings.setup.captureSources")}
        >
          {blockedSources.map((source) => (
            <li key={source.source_kind} className="meeting-row">
              <p className="meeting-row-label">
                {t(sourceKey(source.source_kind))}
              </p>
              <StatusText tone="warning" className="meeting-row-value">
                {t(sourceAvailabilityKey(source.availability))}
              </StatusText>
            </li>
          ))}
        </ul>
      ) : null}

      <Section
        title={t("meetings.review.status")}
        description={t("meetings.setup.captureSourcesDescription")}
      >
        <MeetingSourceList
          sources={snapshot.session.sources}
          label={t("meetings.review.status")}
        />
        <ul className="meeting-rows mt-3">
          <li className="meeting-row">
            <p className="meeting-row-label">
              {t("meetings.preflight.storage")}
            </p>
            <StatusText
              tone={storageAvailable ? "muted" : "danger"}
              className="meeting-row-value"
            >
              {storageAvailable
                ? t("meetings.preflight.storageAvailable")
                : t("meetings.preflight.storageUnavailable")}
            </StatusText>
          </li>
          <li className="meeting-row">
            <p className="meeting-row-label">
              {t("meetings.preflight.localModel")}
            </p>
            <ProcessingStatusText
              status={snapshot.session.processing_status}
              className="meeting-row-value"
            />
          </li>
          <li className="meeting-row">
            <p className="meeting-row-label">
              {t("meetings.setup.processing")}
            </p>
            <StatusText className="meeting-row-value">
              {t("meetings.setup.localOnly")}
            </StatusText>
          </li>
        </ul>
      </Section>

      <p className="meeting-start-assurance">
        {t(
          "meetings.start.assurance",
          "Records your Mac's audio locally. Nothing joins the call.",
        )}
      </p>

      {blocked ? (
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-2.5 text-[13px] leading-[19px] text-text-primary">
            <input
              type="checkbox"
              className="meeting-check"
              checked={partialAccepted}
              disabled={starting}
              onChange={() => setPartialAccepted(!partialAccepted)}
            />
            <span className="text-pretty">
              {t(
                "meetings.gate.recordAnywayHint",
                "The record is marked partial and the missing source stays named in it.",
              )}
            </span>
          </label>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {refresh}
            <Button
              type="button"
              onClick={() => start(true)}
              disabled={!partialAccepted || starting}
            >
              {starting
                ? t("meetings.start.starting", "Starting…")
                : t("meetings.gate.recordAnyway", "Record without it")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {refresh}
          <Button
            type="button"
            className="meeting-start-button"
            onClick={() => start(false)}
            disabled={starting}
          >
            {starting
              ? t("meetings.start.starting", "Starting…")
              : t("meetings.start.action", "Start recording")}
          </Button>
        </div>
      )}
    </div>
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
