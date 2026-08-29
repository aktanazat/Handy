import React, { useId, useState } from "react";
import {
  AlignLeft,
  AppWindow,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDashed,
  Clock,
  FileText,
  Link as LinkIcon,
  Mic,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import type { MeetingSuggestion, SourceKind } from "@/bindings";
import { formatDurationShort, formatEntryTimestamp } from "@/lib/utils/format";
import { Button, StatusText, Switch } from "../../ui";
import { MeetingSourceChip } from "./MeetingSourceChip";
import type { MeetingNotesTemplate } from "./meetingAnalytics";
import { MEETING_SOURCES, meetingProviderKey, sourceKey } from "./meetingUtils";
import type {
  CalendarEventSummary,
  NotificationAccess,
  ParticipationStatus,
} from "./detectionStore";

/* The one shape a meeting takes before it is recorded.
 *
 * Three surfaces show a meeting that has not started: the countdown for a
 * calendar event, an offer raised by a running meeting app, and the preflight
 * that previews a start already configured. They used to be three different
 * rows saying three different amounts, which meant the operator learned the
 * layout three times and still could not tell what Sona knew about the call.
 *
 * So one card, and a hard rule about what goes in it: a row exists only when
 * the backend supplied its value. An event with no attendee list has no
 * PARTICIPANTS row, not an empty one; an offer from a running app has no TIME
 * row, because nothing scheduled it. Absence is information, and faking a row
 * to keep the shape tidy would spend the operator's trust on symmetry. */

/** The facts about one meeting-to-be. Pure data: every control the card can
 * drive is passed separately, because the facts travel with a start request
 * and the controls belong to whichever surface is rendering. */
export interface MeetingPreviewFacts {
  /** Stable identity on its surface: event key, prompt id, or offer id. */
  id: string;
  title: string;
  /** Which signal produced this preview, which is also its icon. */
  origin: "calendar" | "app";
  startUtcMs: number | null;
  endUtcMs: number | null;
  /** Title of the calendar the event sits on. */
  calendarName: string | null;
  /** The meeting application detection named, when it named one. */
  appName: string | null;
  /** Participants the event carries, including any EventKit would not name. */
  attendeeCount: number | null;
  participants: MeetingPreviewParticipant[];
  /** The event's own notes. */
  description: string | null;
  /** The URL attached to the event, which for a scheduled call is the join
   * link. */
  url: string | null;
}

export interface MeetingPreviewParticipant {
  name: string;
  status: ParticipationStatus;
  isSelf: boolean;
}

/** How a prompt for this meeting reaches the operator, and whether reaching
 * its start with this card open opens the capture by itself. */
export interface MeetingPreviewNotify {
  access: NotificationAccess;
  /** Whether this particular prompt was delivered natively. `null` when no
   * prompt was raised for this preview. */
  delivered: boolean | null;
  autoOpen: {
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled: boolean;
  } | null;
}

/** The capture sources the next press will request. */
export interface MeetingPreviewRecording {
  armed: SourceKind[];
  /** Absent once the sources are settled: the preflight cannot re-arm them. */
  onToggle?: (source: SourceKind) => void;
  disabled?: boolean;
}

export interface MeetingPreviewCardProps {
  facts: MeetingPreviewFacts;
  /** Live seconds until the event starts, when a countdown is running. */
  secondsToStart?: number | null;
  notify?: MeetingPreviewNotify | null;
  recording?: MeetingPreviewRecording | null;
  /** The shape generated notes will take, read from the real setting. */
  notesTemplate?: MeetingNotesTemplate | null;
  defaultExpanded?: boolean;
  /** Routes through the surface's existing start path, consent screen and
   * all. `null` on a surface that has no start to offer. */
  onStart?: (() => void) | null;
  starting?: boolean;
  onSkip?: (() => void) | null;
}

const PARTICIPATION_ICON = {
  accepted: Check,
  declined: X,
  tentative: CircleDashed,
  pending: Clock,
  unknown: null,
} as const satisfies Record<ParticipationStatus, LucideIcon | null>;

/* Ordered by how much the answer tells you, so the tally reads down from the
 * people who are coming to the people who never said. */
const PARTICIPATION_ORDER: ParticipationStatus[] = [
  "accepted",
  "declined",
  "tentative",
  "pending",
  "unknown",
];

/** Host for a link row, falling back to the whole string for schemes that
 * carry no host. A calendar URL is whatever the organizer pasted. */
const linkLabel = (url: string): string => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

const openLink = async (url: string, failure: string) => {
  try {
    await openUrl(url);
  } catch (error) {
    console.error("Failed to open the meeting link:", error);
    toast.error(failure);
  }
};

interface PreviewRowProps {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}

const PreviewRow: React.FC<PreviewRowProps> = ({ icon, label, children }) => (
  <li className="meeting-row">
    <span className="meeting-preview-key">
      {icon}
      <span className="microlabel">{label}</span>
    </span>
    <span className="meeting-preview-value">{children}</span>
  </li>
);

export const MeetingPreviewCard: React.FC<MeetingPreviewCardProps> = ({
  facts,
  secondsToStart = null,
  notify = null,
  recording = null,
  notesTemplate = null,
  defaultExpanded = false,
  onStart = null,
  starting = false,
  onSkip = null,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const bodyId = useId();

  const durationSeconds =
    facts.startUtcMs === null || facts.endUtcMs === null
      ? null
      : Math.max(0, (facts.endUtcMs - facts.startUtcMs) / 1000);
  const OriginIcon = facts.origin === "calendar" ? CalendarDays : AppWindow;

  const named = facts.participants;
  const unnamed =
    facts.attendeeCount === null
      ? 0
      : Math.max(0, facts.attendeeCount - named.length);
  const tally = PARTICIPATION_ORDER.map((status) => ({
    status,
    count: named.filter((person) => person.status === status).length,
  })).filter((entry) => entry.count > 0);

  const actions =
    onStart === null && onSkip === null ? null : (
      <div className="meeting-preview-actions">
        {onSkip === null ? null : (
          <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
            {t("meetings.preview.actions.skip", "Skip")}
          </Button>
        )}
        {onStart === null ? null : (
          <Button type="button" size="sm" onClick={onStart} disabled={starting}>
            {starting
              ? t("meetings.start.starting", "Starting…")
              : t("meetings.start.action", "Start recording")}
          </Button>
        )}
      </div>
    );

  return (
    <li className="meeting-preview">
      <button
        type="button"
        className="meeting-preview-summary"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="meeting-preview-origin" aria-hidden="true">
          <OriginIcon size={13} />
        </span>
        <span className="meeting-preview-title">{facts.title}</span>
        <span className="meeting-preview-facts">
          {facts.startUtcMs === null ? null : (
            <span className="meeting-preview-chip">
              {formatEntryTimestamp(facts.startUtcMs)}
            </span>
          )}
          {durationSeconds === null ? null : (
            <span className="meeting-preview-chip">
              {formatDurationShort(durationSeconds)}
            </span>
          )}
          {secondsToStart === null ? null : (
            <span className="meeting-preview-chip">
              {t(
                "meetings.detection.pane.countdown",
                "Starts in {{seconds}}s",
                {
                  seconds: Math.max(0, secondsToStart),
                },
              )}
            </span>
          )}
          {facts.attendeeCount === null || facts.attendeeCount === 0 ? null : (
            <span className="meeting-preview-chip">
              {/* The suffix is picked here, not by i18next: a plural category
               * i18next resolves (few, many) has no key in any locale file,
               * and every locale carries exactly _one and _other. Same shape
               * as SecureInputWarning. */}
              {t(
                `meetings.preview.attendees_${
                  facts.attendeeCount === 1 ? "one" : "other"
                }`,
                { count: facts.attendeeCount },
              )}
            </span>
          )}
        </span>
        <ChevronDown
          className="meeting-preview-caret"
          size={14}
          aria-hidden="true"
        />
      </button>

      <div id={bodyId} className="meeting-preview-body" data-open={expanded}>
        <div className="meeting-preview-clip">
          <ul className="meeting-rows meeting-preview-rows">
            {facts.startUtcMs === null ? null : (
              <PreviewRow
                icon={<Clock size={13} aria-hidden="true" />}
                label={t("meetings.preview.rows.time", "Time")}
              >
                <span className="tabular-nums">
                  {formatEntryTimestamp(facts.startUtcMs)}
                </span>
                {durationSeconds === null ? null : (
                  <span className="meeting-preview-chip">
                    {formatDurationShort(durationSeconds)}
                  </span>
                )}
              </PreviewRow>
            )}

            {facts.calendarName === null ? null : (
              <PreviewRow
                icon={<CalendarDays size={13} aria-hidden="true" />}
                label={t("meetings.preview.rows.calendar", "Calendar")}
              >
                {facts.calendarName}
              </PreviewRow>
            )}

            {facts.appName === null ? null : (
              <PreviewRow
                icon={<AppWindow size={13} aria-hidden="true" />}
                label={t("meetings.preview.rows.app", "App")}
              >
                {facts.appName}
              </PreviewRow>
            )}

            {notify === null ? null : (
              <PreviewRow
                icon={<Bell size={13} aria-hidden="true" />}
                label={t("meetings.preview.rows.notify", "Notify")}
              >
                <StatusText
                  tone={notify.access === "authorized" ? "muted" : "warning"}
                >
                  {notify.delivered === true
                    ? t(
                        "meetings.preview.notify.delivered",
                        "Notification sent",
                      )
                    : notify.access === "authorized"
                      ? t(
                          "meetings.preview.notify.willNotify",
                          "Notifies you at the start",
                        )
                      : t(
                          "meetings.preview.notify.inApp",
                          "Shown in Sona only: notifications are off",
                        )}
                </StatusText>
                {notify.autoOpen === null ? null : (
                  <Switch
                    checked={notify.autoOpen.checked}
                    disabled={notify.autoOpen.disabled}
                    onChange={notify.autoOpen.onChange}
                    label={t(
                      "meetings.preview.notify.autoOpen",
                      "Open this meeting when it starts",
                    )}
                  />
                )}
              </PreviewRow>
            )}

            {recording === null ? null : (
              <PreviewRow
                icon={<Mic size={13} aria-hidden="true" />}
                label={t("meetings.preview.rows.recording", "Recording")}
              >
                {recording.onToggle === undefined ? (
                  recording.armed.length === 0 ? (
                    <StatusText tone="warning">
                      {t("meetings.preview.recording.none", "No source armed")}
                    </StatusText>
                  ) : (
                    recording.armed
                      .map((source) => t(sourceKey(source)))
                      .join(" · ")
                  )
                ) : (
                  MEETING_SOURCES.map((source) => (
                    <MeetingSourceChip
                      key={source}
                      source={source}
                      selected={recording.armed.includes(source)}
                      disabled={recording.disabled === true}
                      onToggle={() => recording.onToggle?.(source)}
                    />
                  ))
                )}
              </PreviewRow>
            )}

            {notesTemplate === null ? null : (
              <PreviewRow
                icon={<FileText size={13} aria-hidden="true" />}
                label={t("meetings.preview.rows.notes", "Notes")}
              >
                {t(`meetings.notes.templates.${notesTemplate}`)}
              </PreviewRow>
            )}

            {named.length === 0 ? null : (
              <PreviewRow
                icon={<Users size={13} aria-hidden="true" />}
                label={t("meetings.preview.rows.participants", "Participants")}
              >
                <span className="meeting-preview-people">
                  <span className="meeting-preview-tally">
                    {tally.map(({ status, count }) => (
                      <span key={status} className="microlabel">
                        {t("meetings.preview.participation.tally", {
                          label: t(`meetings.preview.participation.${status}`),
                          count,
                          defaultValue: "{{label}} {{count}}",
                        })}
                      </span>
                    ))}
                  </span>
                  <span className="meeting-preview-chips">
                    {named.map((person) => {
                      const Glyph = PARTICIPATION_ICON[person.status];
                      const status = t(
                        `meetings.preview.participation.${person.status}`,
                      );
                      return (
                        <span
                          key={`${person.name}:${person.status}`}
                          className="meeting-preview-person"
                          data-status={person.status}
                          title={`${person.name} — ${status}`}
                        >
                          {Glyph === null ? null : <Glyph size={11} />}
                          {person.name}
                          {person.isSelf ? (
                            <span className="microlabel">
                              {t("meetings.preview.participation.you", "You")}
                            </span>
                          ) : null}
                        </span>
                      );
                    })}
                    {unnamed === 0 ? null : (
                      <span className="microlabel">
                        {t(
                          `meetings.preview.participation.unnamed_${
                            unnamed === 1 ? "one" : "other"
                          }`,
                          { count: unnamed },
                        )}
                      </span>
                    )}
                  </span>
                </span>
              </PreviewRow>
            )}

            {facts.url === null ? null : (
              <PreviewRow
                icon={<LinkIcon size={13} aria-hidden="true" />}
                label={t("meetings.preview.rows.link", "Link")}
              >
                <button
                  type="button"
                  className="meeting-preview-link"
                  onClick={() =>
                    void openLink(
                      facts.url ?? "",
                      t(
                        "meetings.preview.linkFailed",
                        "Sona could not open that link.",
                      ),
                    )
                  }
                >
                  {linkLabel(facts.url)}
                </button>
              </PreviewRow>
            )}

            {facts.description === null ? null : (
              <PreviewRow
                icon={<AlignLeft size={13} aria-hidden="true" />}
                label={t("meetings.preview.rows.description", "Description")}
              >
                <span
                  className="meeting-preview-description"
                  data-open={descriptionOpen}
                >
                  {facts.description}
                </span>
                <button
                  type="button"
                  className="meeting-preview-more"
                  aria-expanded={descriptionOpen}
                  onClick={() => setDescriptionOpen(!descriptionOpen)}
                >
                  {descriptionOpen
                    ? t("meetings.preview.description.less", "Less")
                    : t("meetings.preview.description.more", "More")}
                </button>
              </PreviewRow>
            )}
          </ul>
        </div>
      </div>

      {/* Outside the collapse on purpose. The rows are detail and may hide;
       * the decision is why the card exists, and burying the one press that
       * records a meeting behind a disclosure would contradict the whole
       * page. */}
      {actions}
    </li>
  );
};

/** The facts a calendar event supplies. Everything the calendar left empty
 * stays null here, so the card omits that row rather than inventing it. */
export const eventFacts = (
  event: CalendarEventSummary,
): MeetingPreviewFacts => ({
  id: event.eventKey,
  title: event.title,
  origin: "calendar",
  startUtcMs: event.startUtcMs,
  endUtcMs: event.endUtcMs,
  calendarName: event.calendarName,
  /* Detection ties no application to a calendar event: the event is evidence
   * on its own. An APP row here would be a guess. */
  appName: null,
  attendeeCount: event.attendeeCount,
  participants: event.attendees.map((attendee) => ({
    name: attendee.name,
    status: attendee.status,
    isSelf: attendee.isSelf,
  })),
  description: event.notes,
  url: event.url,
});

/** The facts an offer from a running meeting app supplies, which is the app
 * and nothing else: the suggestion payload is content-free by design, so this
 * card is deliberately short. */
export const suggestionFacts = (
  suggestion: MeetingSuggestion,
  t: TFunction,
): MeetingPreviewFacts => ({
  id: suggestion.offer_id,
  title: t("meetings.detected.mayBeActive", {
    provider: t(meetingProviderKey(suggestion.provider)),
  }),
  origin: "app",
  startUtcMs: null,
  endUtcMs: null,
  calendarName: null,
  appName: t(meetingProviderKey(suggestion.provider)),
  attendeeCount: null,
  participants: [],
  description: null,
  url: null,
});
