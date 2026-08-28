import React, { useMemo, useState } from "react";
import { ArrowLeft, RefreshCcw, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  MeetingConsentInput,
  MeetingReviewSnapshot,
  MeetingSuggestion,
  SourceKind,
} from "@/bindings";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { ProcessingStatusLine, SourceHealthCard } from "./MeetingStatus";
import type { MeetingPreflightDraft } from "./meetingTypes";
import {
  MEETING_SOURCES,
  meetingProviderKey,
  sourceAvailabilityKey,
  sourceKey,
} from "./meetingUtils";

interface MeetingDraftComposerProps {
  draft: MeetingPreflightDraft;
  suggestion: MeetingSuggestion | null;
  submitting: boolean;
  onChange: (draft: MeetingPreflightDraft) => void;
  onCheck: () => void;
  onCancel: () => void;
}

export const MeetingDraftComposer: React.FC<MeetingDraftComposerProps> = ({
  draft,
  suggestion,
  submitting,
  onChange,
  onCheck,
  onCancel,
}) => {
  const { t } = useTranslation();
  const sourceSelection = new Set(draft.requestedSources);
  const canCheck = draft.title.trim().length > 0 && sourceSelection.size > 0;

  const toggleSource = (source: SourceKind) => {
    const requestedSources = sourceSelection.has(source)
      ? draft.requestedSources.filter((candidate) => candidate !== source)
      : [...draft.requestedSources, source];
    onChange({
      ...draft,
      requestedSources,
      requiredSources: requestedSources,
    });
  };

  return (
    <div className="meetings-page meetings-preflight-draft">
      <header className="settings-page-header meetings-page-header">
        <button
          type="button"
          className="meeting-back-button"
          onClick={onCancel}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {t("meetings.actions.back")}
        </button>
        <h1 className="settings-page-title">{t("meetings.setup.title")}</h1>
        <p className="settings-page-description">
          {suggestion
            ? t("meetings.setup.suggestedDescription", {
                provider: t(meetingProviderKey(suggestion.provider)),
              })
            : t("meetings.setup.manualDescription")}
        </p>
      </header>

      <section className="meeting-form-section" aria-labelledby="meeting-title">
        <h2 id="meeting-title">{t("meetings.setup.identity")}</h2>
        <label className="meeting-field-label" htmlFor="meeting-title-input">
          {t("meetings.setup.meetingTitle")}
        </label>
        <Input
          id="meeting-title-input"
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          placeholder={t("meetings.setup.meetingTitlePlaceholder")}
          disabled={submitting}
        />
      </section>

      <fieldset className="meeting-form-section">
        <legend>{t("meetings.setup.captureSources")}</legend>
        <p>{t("meetings.setup.captureSourcesDescription")}</p>
        <div className="meeting-choice-list">
          {MEETING_SOURCES.map((source) => (
            <label key={source} className="meeting-choice-row">
              <input
                type="checkbox"
                checked={sourceSelection.has(source)}
                onChange={() => toggleSource(source)}
                disabled={submitting}
              />
              <span>{t(sourceKey(source))}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="meeting-form-section">
        <legend>{t("meetings.setup.sourcePolicy")}</legend>
        <p>{t("meetings.setup.sourcePolicyDescription")}</p>
        <div className="meeting-choice-list">
          <label className="meeting-choice-row">
            <input
              type="radio"
              name="meeting-source-policy"
              checked={
                draft.degradedStartPolicy === "abort_if_required_source_fails"
              }
              onChange={() =>
                onChange({
                  ...draft,
                  degradedStartPolicy: "abort_if_required_source_fails",
                })
              }
              disabled={submitting}
            />
            <span>{t("meetings.setup.strict")}</span>
          </label>
          <label className="meeting-choice-row">
            <input
              type="radio"
              name="meeting-source-policy"
              checked={
                draft.degradedStartPolicy === "continue_and_mark_partial"
              }
              onChange={() =>
                onChange({
                  ...draft,
                  degradedStartPolicy: "continue_and_mark_partial",
                })
              }
              disabled={submitting}
            />
            <span>{t("meetings.setup.continuePartial")}</span>
          </label>
        </div>
      </fieldset>

      <section className="meeting-form-section" aria-labelledby="meeting-processing">
        <h2 id="meeting-processing">{t("meetings.setup.processing")}</h2>
        <div className="meeting-readiness-row">
          <div>
            <strong>{t("meetings.setup.localProcessing")}</strong>
            <span>{t("meetings.setup.localProcessingDescription")}</span>
          </div>
          <span className="meeting-readiness-value">
            {t("meetings.setup.selected")}
          </span>
        </div>
        <div className="meeting-readiness-row">
          <div>
            <strong>{t("meetings.setup.remoteDestination")}</strong>
            <span>{t("meetings.setup.remoteNotSelected")}</span>
          </div>
          <span className="meeting-readiness-value">
            {t("meetings.setup.localOnly")}
          </span>
        </div>
      </section>

      <div className="meeting-form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          onClick={onCheck}
          disabled={!canCheck || submitting}
        >
          {submitting ? t("meetings.setup.checking") : t("meetings.setup.check")}
        </Button>
      </div>
    </div>
  );
};

interface MeetingPreflightProps {
  snapshot: MeetingReviewSnapshot;
  draft: MeetingPreflightDraft;
  refreshing: boolean;
  starting: boolean;
  onRefresh: () => void;
  onReconfigure: () => void;
  onCancel: () => void;
  onStart: (consent: MeetingConsentInput) => void;
}

export const MeetingPreflight: React.FC<MeetingPreflightProps> = ({
  snapshot,
  draft,
  refreshing,
  starting,
  onRefresh,
  onReconfigure,
  onCancel,
  onStart,
}) => {
  const { t } = useTranslation();
  const [captureAcknowledged, setCaptureAcknowledged] = useState(false);
  const [partialApproved, setPartialApproved] = useState(
    draft.degradedStartPolicy === "continue_and_mark_partial",
  );
  const [missingAcknowledgements, setMissingAcknowledgements] = useState<
    SourceKind[]
  >([]);
  const unavailableRequiredSources = useMemo(
    () =>
      snapshot.session.sources.filter(
        (source) =>
          source.required && source.availability !== "available",
      ),
    [snapshot.session.sources],
  );
  const needsPartialAcknowledgement = unavailableRequiredSources.length > 0;
  const missingAcknowledgementSet = useMemo(
    () => new Set(missingAcknowledgements),
    [missingAcknowledgements],
  );
  const allMissingSourcesAcknowledged = unavailableRequiredSources.every(
    (source) => missingAcknowledgementSet.has(source.source_kind),
  );
  const remoteDestination =
    draft.destination.kind === "remote"
      ? draft.destination.destination_id
      : null;
  const canStart =
    captureAcknowledged &&
    (!needsPartialAcknowledgement ||
      (partialApproved && allMissingSourcesAcknowledged)) &&
    !starting;

  const toggleMissingSource = (source: SourceKind) => {
    setMissingAcknowledgements((current) => {
      const selected = new Set(current);
      if (selected.has(source)) {
        selected.delete(source);
      } else {
        selected.add(source);
      }
      return [...selected];
    });
  };

  const start = () => {
    onStart({
      policy_version: 1,
      microphone_acknowledged: draft.requestedSources.includes("microphone"),
      system_audio_acknowledged: draft.requestedSources.includes("system_audio"),
      known_missing_sources_acknowledged: missingAcknowledgements,
      degraded_start_policy: partialApproved
        ? "continue_and_mark_partial"
        : "abort_if_required_source_fails",
      destination: draft.destination,
      remote_acknowledgement: null,
    });
  };

  return (
    <div className="meetings-page meetings-preflight">
      <header className="settings-page-header meetings-page-header">
        <button
          type="button"
          className="meeting-back-button"
          onClick={onCancel}
          disabled={starting}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {t("meetings.actions.back")}
        </button>
        <h1 className="settings-page-title">{t("meetings.preflight.title")}</h1>
        <p className="settings-page-description">
          {t("meetings.preflight.description")}
        </p>
      </header>

      <section className="meeting-preflight-summary" aria-label={t("meetings.preflight.summary")}>
        <div>
          <span>{t("meetings.preflight.meeting")}</span>
          <strong>{snapshot.session.title}</strong>
        </div>
        <button
          type="button"
          className="meeting-inline-action"
          onClick={onReconfigure}
          disabled={starting}
        >
          {t("meetings.preflight.changeSetup")}
        </button>
      </section>

      <section className="meeting-form-section" aria-labelledby="meeting-readiness-title">
        <div className="meeting-section-heading">
          <div>
            <h2 id="meeting-readiness-title">{t("meetings.preflight.readiness")}</h2>
            <p>{t("meetings.preflight.readinessDescription")}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing || starting}
          >
            <RefreshCcw
              className={refreshing ? "animate-spin" : ""}
              size={14}
              aria-hidden="true"
            />
            {t("meetings.actions.refresh")}
          </Button>
        </div>
        <div className="meeting-source-grid">
          {snapshot.session.sources.map((source) => (
            <SourceHealthCard key={source.source_kind} source={source} />
          ))}
        </div>
        <div className="meeting-readiness-row">
          <div>
            <strong>{t("meetings.preflight.storage")}</strong>
            <span>
              {snapshot.session.storage === "available"
                ? t("meetings.preflight.storageAvailable")
                : t("meetings.preflight.storageUnavailable")}
            </span>
          </div>
          <span
            className="meeting-readiness-value"
            data-state={snapshot.session.storage}
          >
            {snapshot.session.storage === "available"
              ? t("meetings.readiness.ready")
              : t("meetings.readiness.unavailable")}
          </span>
        </div>
        <div className="meeting-readiness-row">
          <div>
            <strong>{t("meetings.preflight.localModel")}</strong>
            <span>{t("meetings.preflight.localModelDescription")}</span>
          </div>
          <ProcessingStatusLine status={snapshot.session.processing_status} />
        </div>
        <div className="meeting-readiness-row">
          <div>
            <strong>{t("meetings.preflight.remoteDestination")}</strong>
            <span>
              {remoteDestination
                ? t("meetings.preflight.remoteSelected", {
                    destination: remoteDestination,
                  })
                : t("meetings.preflight.remoteNotSelected")}
            </span>
          </div>
          <span className="meeting-readiness-value">
            {remoteDestination
              ? t("meetings.readiness.needsAcknowledgement")
              : t("meetings.readiness.local")}
          </span>
        </div>
      </section>

      {needsPartialAcknowledgement ? (
        <Alert variant="warning" contained>
          {t("meetings.preflight.partialWarning")}
        </Alert>
      ) : null}

      <section className="meeting-consent-panel" aria-labelledby="meeting-consent-title">
        <div className="meeting-consent-title">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <h2 id="meeting-consent-title">{t("meetings.consent.title")}</h2>
            <p>{t("meetings.consent.description")}</p>
          </div>
        </div>
        <label className="meeting-choice-row meeting-consent-check">
          <input
            type="checkbox"
            checked={captureAcknowledged}
            onChange={(event) => setCaptureAcknowledged(event.target.checked)}
            disabled={starting}
          />
          <span>{t("meetings.consent.acknowledge")}</span>
        </label>
        {needsPartialAcknowledgement ? (
          <>
            <label className="meeting-choice-row meeting-consent-check">
              <input
                type="checkbox"
                checked={partialApproved}
                onChange={(event) => setPartialApproved(event.target.checked)}
                disabled={starting}
              />
              <span>{t("meetings.consent.continuePartial")}</span>
            </label>
            <div className="meeting-missing-source-list">
              {unavailableRequiredSources.map((source) => (
                <label
                  key={source.source_kind}
                  className="meeting-choice-row meeting-consent-check"
                >
                  <input
                    type="checkbox"
                    checked={missingAcknowledgementSet.has(source.source_kind)}
                    onChange={() => toggleMissingSource(source.source_kind)}
                    disabled={starting || !partialApproved}
                  />
                  <span>
                    {t("meetings.consent.acceptMissing", {
                      source: t(sourceKey(source.source_kind)),
                      state: t(sourceAvailabilityKey(source.availability)),
                    })}
                  </span>
                </label>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <div className="meeting-form-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={starting}
        >
          {t("common.cancel")}
        </Button>
        <Button type="button" onClick={start} disabled={!canStart}>
          {starting ? t("meetings.preflight.starting") : t("meetings.actions.startLocal")}
        </Button>
      </div>
    </div>
  );
};
