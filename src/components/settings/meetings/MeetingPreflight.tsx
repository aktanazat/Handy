import React, { useMemo, useState } from "react";
import { ArrowLeft, RefreshCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  MeetingConsentInput,
  MeetingReviewSnapshot,
  MeetingSuggestion,
  SourceKind,
} from "@/bindings";
import { Alert, Button, Input, Section, StatusText } from "../../ui";
import { MeetingSourceList, ProcessingStatusText } from "./MeetingStatus";
import type { MeetingPreflightDraft } from "./meetingTypes";
import {
  MEETING_SOURCES,
  meetingProviderKey,
  sourceAvailabilityKey,
  sourceKey,
} from "./meetingUtils";

/* Setup is a form, so it is built from form semantics: one fieldset per
 * decision, a legend that carries the section heading, and rows that are
 * labels wrapping their own control. */

const LEGEND_CLASSES =
  "text-[15px] leading-[21px] font-semibold tracking-[-0.014em] text-text-primary";
const FIELD_DESCRIPTION_CLASSES =
  "mt-0.5 mb-2.5 max-w-[68ch] text-[12.5px] leading-[18px] text-text-secondary text-pretty";
const READINESS_ROW_CLASSES =
  "flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5";

interface BackButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

const BackButton: React.FC<BackButtonProps> = ({ onClick, disabled }) => {
  const { t } = useTranslation();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ms-2.5 self-start"
      onClick={onClick}
      disabled={disabled}
    >
      <ArrowLeft size={14} aria-hidden="true" />
      {t("meetings.actions.back")}
    </Button>
  );
};

interface ChoiceRowProps {
  type: "checkbox" | "radio";
  name?: string;
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
  children: React.ReactNode;
}

const ChoiceRow: React.FC<ChoiceRowProps> = ({
  type,
  name,
  checked,
  onChange,
  disabled,
  children,
}) => (
  <label
    className={`flex min-h-11 items-start gap-2.5 px-4 py-2.5 text-[13px] leading-[19px] ${
      disabled
        ? "cursor-not-allowed text-text-disabled"
        : "cursor-pointer text-text-primary"
    }`}
  >
    <input
      type={type}
      name={name}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      className="mt-[3px] size-4 flex-none accent-accent-strong"
    />
    <span className="text-pretty">{children}</span>
  </label>
);

interface RemoteProcessingNoteProps {
  className?: string;
}

/* Remote destinations exist in the model and in the wire types, and every one
 * of them fails closed with RemoteUnavailable. Saying that here is cheaper
 * than a control that cannot work. */
const RemoteProcessingNote: React.FC<RemoteProcessingNoteProps> = ({
  className = "",
}) => {
  const { t } = useTranslation();

  return (
    <StatusText tone="muted" className={`block ${className}`}>
      {t(
        "meetings.setup.remoteUnavailable",
        "Remote processing is unavailable in this build, so every meeting is transcribed and summarised on this Mac.",
      )}
    </StatusText>
  );
};

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
    <div className="settings-page">
      <header className="settings-page-header flex flex-col gap-1">
        <BackButton onClick={onCancel} disabled={submitting} />
        <h1 className="settings-page-title">{t("meetings.setup.title")}</h1>
        <p className="settings-page-description">
          {suggestion
            ? t("meetings.setup.suggestedDescription", {
                provider: t(meetingProviderKey(suggestion.provider)),
              })
            : t("meetings.setup.manualDescription")}
        </p>
      </header>

      <Section title={t("meetings.setup.identity")}>
        <label
          className="mb-1.5 block text-[12px] leading-4 text-text-secondary"
          htmlFor="meeting-title-input"
        >
          {t("meetings.setup.meetingTitle")}
        </label>
        <Input
          id="meeting-title-input"
          value={draft.title}
          onChange={(event) =>
            onChange({ ...draft, title: event.target.value })
          }
          placeholder={t("meetings.setup.meetingTitlePlaceholder")}
          disabled={submitting}
          className="w-full max-w-[420px]"
        />
      </Section>

      <fieldset className="settings-group">
        <legend className={LEGEND_CLASSES}>
          {t("meetings.setup.captureSources")}
        </legend>
        <p className={FIELD_DESCRIPTION_CLASSES}>
          {t("meetings.setup.captureSourcesDescription")}
        </p>
        <div className="settings-group-panel">
          <div>
            {MEETING_SOURCES.map((source) => (
              <ChoiceRow
                key={source}
                type="checkbox"
                checked={sourceSelection.has(source)}
                onChange={() => toggleSource(source)}
                disabled={submitting}
              >
                {t(sourceKey(source))}
              </ChoiceRow>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="settings-group">
        <legend className={LEGEND_CLASSES}>
          {t("meetings.setup.sourcePolicy")}
        </legend>
        <p className={FIELD_DESCRIPTION_CLASSES}>
          {t("meetings.setup.sourcePolicyDescription")}
        </p>
        <div className="settings-group-panel">
          <div>
            <ChoiceRow
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
            >
              {t("meetings.setup.strict")}
            </ChoiceRow>
            <ChoiceRow
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
            >
              {t("meetings.setup.continuePartial")}
            </ChoiceRow>
          </div>
        </div>
      </fieldset>

      <Section title={t("meetings.setup.processing")}>
        <div className="settings-group-panel">
          <div>
            <div className={READINESS_ROW_CLASSES}>
              <div className="min-w-0">
                <p className="text-[13px] leading-[19px] font-medium text-text-primary">
                  {t("meetings.setup.localProcessing")}
                </p>
                <StatusText tone="muted" className="block">
                  {t("meetings.setup.localProcessingDescription")}
                </StatusText>
              </div>
              <StatusText tone="neutral" className="flex-none font-medium">
                {t("meetings.setup.selected")}
              </StatusText>
            </div>
            <div className={READINESS_ROW_CLASSES}>
              <div className="min-w-0">
                <p className="text-[13px] leading-[19px] font-medium text-text-primary">
                  {t("meetings.setup.remoteDestination")}
                </p>
                <RemoteProcessingNote />
              </div>
              <StatusText tone="muted" className="flex-none">
                {t("meetings.setup.localOnly")}
              </StatusText>
            </div>
          </div>
        </div>
      </Section>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          onClick={onCheck}
          disabled={!canCheck || submitting}
        >
          {submitting
            ? t("meetings.setup.checking")
            : t("meetings.setup.check")}
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
        (source) => source.required && source.availability !== "available",
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
  const storageAvailable = snapshot.session.storage === "available";
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
      system_audio_acknowledged:
        draft.requestedSources.includes("system_audio"),
      known_missing_sources_acknowledged: missingAcknowledgements,
      degraded_start_policy: partialApproved
        ? "continue_and_mark_partial"
        : "abort_if_required_source_fails",
      destination: draft.destination,
      remote_acknowledgement: null,
    });
  };

  return (
    <div className="settings-page">
      <header className="settings-page-header flex flex-col gap-1">
        <BackButton onClick={onCancel} disabled={starting} />
        <h1 className="settings-page-title">{t("meetings.preflight.title")}</h1>
        <p className="settings-page-description">
          {t("meetings.preflight.description")}
        </p>
      </header>

      <section
        aria-label={t("meetings.preflight.summary")}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-panel border border-border bg-surface px-4 py-3"
      >
        <div className="min-w-0">
          <StatusText tone="muted" className="block">
            {t("meetings.preflight.meeting")}
          </StatusText>
          <p className="truncate text-[13px] leading-[19px] font-medium text-text-primary">
            {snapshot.session.title}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReconfigure}
          disabled={starting}
        >
          {t("meetings.preflight.changeSetup")}
        </Button>
      </section>

      <Section
        title={t("meetings.preflight.readiness")}
        description={t("meetings.preflight.readinessDescription")}
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing || starting}
          >
            <RefreshCcw size={14} aria-hidden="true" />
            {refreshing
              ? t("meetings.preflight.refreshing", "Checking…")
              : t("meetings.actions.refresh")}
          </Button>
        }
      >
        <div className="space-y-3">
          <MeetingSourceList
            sources={snapshot.session.sources}
            label={t("meetings.setup.captureSources")}
          />
          <div className="settings-group-panel">
            <div>
              <div className={READINESS_ROW_CLASSES}>
                <div className="min-w-0">
                  <p className="text-[13px] leading-[19px] font-medium text-text-primary">
                    {t("meetings.preflight.storage")}
                  </p>
                  <StatusText tone="muted" className="block">
                    {storageAvailable
                      ? t("meetings.preflight.storageAvailable")
                      : t("meetings.preflight.storageUnavailable")}
                  </StatusText>
                </div>
                <StatusText
                  tone={storageAvailable ? "neutral" : "danger"}
                  className="flex-none font-medium"
                >
                  {storageAvailable
                    ? t("meetings.readiness.ready")
                    : t("meetings.readiness.unavailable")}
                </StatusText>
              </div>
              <div className={READINESS_ROW_CLASSES}>
                <div className="min-w-0">
                  <p className="text-[13px] leading-[19px] font-medium text-text-primary">
                    {t("meetings.preflight.localModel")}
                  </p>
                  <StatusText tone="muted" className="block">
                    {t("meetings.preflight.localModelDescription")}
                  </StatusText>
                </div>
                <ProcessingStatusText
                  status={snapshot.session.processing_status}
                  className="flex-none"
                />
              </div>
              <div className={READINESS_ROW_CLASSES}>
                <div className="min-w-0">
                  <p className="text-[13px] leading-[19px] font-medium text-text-primary">
                    {t("meetings.preflight.remoteDestination")}
                  </p>
                  {remoteDestination ? (
                    <StatusText tone="warning" className="block">
                      {t("meetings.preflight.remoteSelected", {
                        destination: remoteDestination,
                      })}
                    </StatusText>
                  ) : (
                    <RemoteProcessingNote />
                  )}
                </div>
                <StatusText tone="muted" className="flex-none">
                  {remoteDestination
                    ? t("meetings.readiness.needsAcknowledgement")
                    : t("meetings.readiness.local")}
                </StatusText>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {needsPartialAcknowledgement ? (
        <Alert variant="warning">
          {t("meetings.preflight.partialWarning")}
        </Alert>
      ) : null}

      <fieldset className="settings-group">
        <legend className={LEGEND_CLASSES}>
          {t("meetings.consent.title")}
        </legend>
        <p className={FIELD_DESCRIPTION_CLASSES}>
          {t("meetings.consent.description")}
        </p>
        <div className="settings-group-panel">
          <div>
            <ChoiceRow
              type="checkbox"
              checked={captureAcknowledged}
              onChange={() => setCaptureAcknowledged(!captureAcknowledged)}
              disabled={starting}
            >
              {t("meetings.consent.acknowledge")}
            </ChoiceRow>
            {needsPartialAcknowledgement ? (
              <>
                <ChoiceRow
                  type="checkbox"
                  checked={partialApproved}
                  onChange={() => setPartialApproved(!partialApproved)}
                  disabled={starting}
                >
                  {t("meetings.consent.continuePartial")}
                </ChoiceRow>
                {unavailableRequiredSources.map((source) => (
                  <ChoiceRow
                    key={source.source_kind}
                    type="checkbox"
                    checked={missingAcknowledgementSet.has(source.source_kind)}
                    onChange={() => toggleMissingSource(source.source_kind)}
                    disabled={starting || !partialApproved}
                  >
                    {t("meetings.consent.acceptMissing", {
                      source: t(sourceKey(source.source_kind)),
                      state: t(sourceAvailabilityKey(source.availability)),
                    })}
                  </ChoiceRow>
                ))}
              </>
            ) : null}
          </div>
        </div>
      </fieldset>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={starting}
        >
          {t("common.cancel")}
        </Button>
        <Button type="button" onClick={start} disabled={!canStart}>
          {starting
            ? t("meetings.preflight.starting")
            : t("meetings.actions.startLocal")}
        </Button>
      </div>
    </div>
  );
};
