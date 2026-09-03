import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type {
  CalendarAccess,
  MeetingNotesTemplate,
  MeetingUpcomingAttendee,
  MeetingUpcomingRow,
  SourceKind,
} from "@/bindings";
import {
  Microlabel,
  SETTINGS_SURFACE,
  SettingsCard,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Skeleton } from "@/components/vg/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { Switch } from "@/components/vg/switch";
import { cn } from "@/lib/cn";
import {
  formatTimeOfDay,
  groupByLocalDay,
  localDayHeading,
} from "@/lib/utils/localDay";
import { MEETING_NOTES_TEMPLATES } from "../meetingAnalytics";
import { PersonDetailDialog } from "@/components/people/PersonDetailDialog";
import {
  useUpcomingEvents,
  type UpcomingEventsState,
} from "./useUpcomingEvents";

/* D28: the week ahead, above the log of what already happened.
 *
 * Quiet rows, read by day, in the same grammar meeting history is written in —
 * the same day bucketer, the same headings, the same hairline surface. What is
 * different is that these rows are not history: they carry the three decisions
 * their series has made, and the only controls on the page that can change
 * them.
 *
 * The section adds no scroll container. It is one more child of the page's
 * column, which is the pane's single scroll owner, because a fixed 900x800
 * window with two scrollbars in it is two places to lose your position.
 *
 * The "no calendar" state is deliberately not an error. Sona reads the calendar
 * macOS already holds — the Google, iCloud and Outlook accounts signed in
 * there — so the fix is a grant, stated in one line, and the section says so
 * once rather than apologizing per row. */

/** The sentinel the picker uses for "no choice", since a Select has no empty. */
const APP_DEFAULT = "app-default";

const templateValue = (template: MeetingNotesTemplate | null): string =>
  template ?? APP_DEFAULT;

/* The Select hands its value back as a plain string. Rather than trusting that
 * string, it is looked up in the catalog the options were built from: the
 * sentinel is not in there, and neither is anything else, so "not a template"
 * and "no choice" are the same answer. */
const templateChoice = (value: string): MeetingNotesTemplate | null =>
  MEETING_NOTES_TEMPLATES.find((template) => template === value) ?? null;

interface AttendeeChipsProps {
  attendees: MeetingUpcomingAttendee[];
  /** Participants EventKit would not name, shown as a count and nothing else. */
  unnamed: number;
  onOpenPerson: (personId: string) => void;
}

/* One chip per named participant. A chip is a button only when the address book
 * already knows that address: a chip that navigates nowhere would teach the
 * reader that chips do not navigate. */
const AttendeeChips: React.FC<AttendeeChipsProps> = ({
  attendees,
  unnamed,
  onOpenPerson,
}) => {
  const { t } = useTranslation();
  if (attendees.length === 0 && unnamed <= 0) return null;

  const chip =
    "rounded-full border border-gray-alpha-400 px-2 py-0.5 text-[12px] leading-4 text-gray-900";

  return (
    <span
      data-slot="upcoming-attendees"
      role="group"
      aria-label={t("meetings.upcoming.attendees", "Attendees")}
      className="flex flex-wrap items-center gap-1"
    >
      {attendees.map((attendee, index) =>
        attendee.person_id === null ? (
          <span key={`${attendee.name}-${index}`} className={chip}>
            {attendee.is_self
              ? t("meetings.upcoming.you", "You")
              : attendee.name}
          </span>
        ) : (
          <button
            key={`${attendee.name}-${index}`}
            type="button"
            data-slot="upcoming-attendee-link"
            onClick={() => onOpenPerson(attendee.person_id ?? "")}
            className={cn(
              chip,
              "text-accent-strong transition-colors hover:border-gray-alpha-500 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none",
            )}
          >
            {attendee.name}
          </button>
        ),
      )}
      {unnamed > 0 ? (
        <span className={cn(chip, "tabular-nums")}>
          {t("meetings.upcoming.attendeesMore", "+{{count}}", {
            count: unnamed,
          })}
        </span>
      ) : null}
    </span>
  );
};

export interface SeriesControlsProps {
  row: MeetingUpcomingRow;
  /** Capture sources selected on this page — the grant's acknowledgement. */
  sources: SourceKind[];
  saving: boolean;
  onAlwaysRecord: (seriesKey: string, alwaysRecord: boolean) => void;
  onTemplate: (
    seriesKey: string,
    template: MeetingNotesTemplate | null,
  ) => void;
  onDigest: (seriesKey: string, included: boolean) => void;
}

/* The three decisions, on the series rather than on this occurrence. They are
 * behind a disclosure because a calendar row's job is to say what is next, and
 * three switches per row would make the section a settings page with dates on
 * it. */
export const SeriesControls: React.FC<SeriesControlsProps> = ({
  row,
  sources,
  saving,
  onAlwaysRecord,
  onTemplate,
  onDigest,
}) => {
  const { t } = useTranslation();
  const series = row.series;
  if (series === null) return null;
  /* A standing grant records the sources the operator acknowledged. With none
   * selected there is nothing to acknowledge, so the switch states why rather
   * than writing a grant that names nothing. */
  const canGrant = sources.length > 0 || series.always_record;

  return (
    <div
      data-slot="upcoming-series-controls"
      className="flex flex-col gap-3 border-t border-gray-alpha-400 px-4 py-3"
    >
      <div className="flex items-center justify-between gap-6">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] leading-5 text-gray-1000">
            {t("meetings.upcoming.alwaysRecord", "Always record this series")}
          </span>
          {canGrant ? null : (
            <Microlabel className="text-amber-900">
              {t(
                "meetings.upcoming.alwaysRecordNeedsSource",
                "Choose a capture source above first.",
              )}
            </Microlabel>
          )}
        </span>
        <Switch
          aria-label={t(
            "meetings.upcoming.alwaysRecord",
            "Always record this series",
          )}
          checked={series.always_record}
          disabled={saving || !canGrant}
          onCheckedChange={(next) => onAlwaysRecord(series.series_key, next)}
        />
      </div>

      <div className="flex items-center justify-between gap-6">
        <span className="text-[13px] leading-5 text-gray-1000">
          {t("meetings.upcoming.template", "Notes template")}
        </span>
        <Select
          value={templateValue(series.template)}
          disabled={saving}
          onValueChange={(value) =>
            onTemplate(series.series_key, templateChoice(value))
          }
        >
          <SelectTrigger
            size="sm"
            className="w-auto"
            aria-label={t("meetings.upcoming.template", "Notes template")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={APP_DEFAULT}>
              {t("meetings.upcoming.templateDefault", "App default")}
            </SelectItem>
            {MEETING_NOTES_TEMPLATES.map((template) => (
              <SelectItem key={template} value={template}>
                {t(`meetings.notes.templates.${template}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-6">
        <span className="text-[13px] leading-5 text-gray-1000">
          {t("meetings.upcoming.digest", "Include in the evening digest")}
        </span>
        <Switch
          aria-label={t(
            "meetings.upcoming.digest",
            "Include in the evening digest",
          )}
          checked={series.digest_included}
          disabled={saving}
          onCheckedChange={(next) => onDigest(series.series_key, next)}
        />
      </div>
    </div>
  );
};

interface UpcomingRowProps extends Omit<SeriesControlsProps, "row"> {
  row: MeetingUpcomingRow;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenPerson: (personId: string) => void;
}

const UpcomingRow: React.FC<UpcomingRowProps> = ({
  row,
  expanded,
  onToggleExpanded,
  onOpenPerson,
  ...controls
}) => {
  const { t } = useTranslation();
  const unnamed = Math.max(0, row.attendee_count - row.attendees.length);

  return (
    <li data-slot="upcoming-row" className="flex flex-col">
      <div className="flex items-start gap-4 px-4 py-3">
        {/* The time column. Tabular so a column of clock times keeps one
         * left edge instead of jittering with the digits. */}
        <span className="flex w-[74px] flex-none flex-col gap-0.5 pt-px text-end">
          <span className="text-[13px] leading-5 tabular-nums text-gray-1000">
            {formatTimeOfDay(row.start_utc_ms)}
          </span>
          <Microlabel className="tabular-nums text-gray-800">
            {formatTimeOfDay(row.end_utc_ms)}
          </Microlabel>
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[13px] leading-5 text-gray-1000">
              {row.title}
            </span>
            {row.series === null ? null : (
              <span
                data-slot="upcoming-series-chip"
                className="rounded-full border border-gray-alpha-400 px-2 py-0.5 text-[12px] leading-4 text-gray-900"
              >
                {t("meetings.upcoming.recurring", "Repeats")}
              </span>
            )}
          </span>
          <AttendeeChips
            attendees={row.attendees}
            unnamed={unnamed}
            onOpenPerson={onOpenPerson}
          />
          {row.calendar_name === null ? null : (
            <Microlabel className="text-gray-800">
              {row.calendar_name}
            </Microlabel>
          )}
        </span>

        {row.series === null ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            aria-label={t("meetings.upcoming.seriesOptions", {
              title: row.title,
              defaultValue: "Series options for {{title}}",
            })}
            onClick={onToggleExpanded}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-4 transition-transform",
                expanded && "rotate-180",
              )}
            />
          </Button>
        )}
      </div>
      {expanded ? <SeriesControls row={row} {...controls} /> : null}
    </li>
  );
};

const UpcomingSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <div role="status" aria-label={label} className={SETTINGS_SURFACE}>
    {[0, 1].map((row) => (
      <div key={row} className="flex items-center gap-4 px-4 py-3">
        <Skeleton className="h-3.5 w-14" />
        <Skeleton className="h-3.5 flex-1" />
      </div>
    ))}
  </div>
);

/** What the section says when there are no rows to show, and why. */
interface AccessCopy {
  /** The catalog key for the line. */
  line: string;
  /** The English the line falls back to, so the state is never blank. */
  fallback: string;
  /** Whether the line is followed by the sentence naming the grant. */
  hint: boolean;
}

/** The one calm line each state of a calendar Sona cannot read says. */
const accessCopy = (access: CalendarAccess): AccessCopy => {
  switch (access) {
    case "authorized":
      return {
        line: "meetings.upcoming.empty",
        fallback: "Nothing scheduled for the next week.",
        hint: false,
      };
    case "unavailable":
      return {
        line: "meetings.upcoming.unavailable",
        fallback: "This system has no calendar Sona can read.",
        hint: false,
      };
    default:
      return {
        line: "meetings.upcoming.noAccess",
        fallback: "Sona cannot see your calendar.",
        hint: true,
      };
  }
};

export interface MeetingsUpcomingViewProps
  extends Pick<
    UpcomingEventsState,
    | "events"
    | "loading"
    | "saving"
    | "setAlwaysRecord"
    | "setTemplate"
    | "setDigestIncluded"
  > {
  sources: SourceKind[];
}

/** The section, rendered from state alone, so every one of its states is one
 *  prop away in a test. */
export const MeetingsUpcomingView: React.FC<MeetingsUpcomingViewProps> = ({
  events,
  loading,
  saving,
  sources,
  setAlwaysRecord,
  setTemplate,
  setDigestIncluded,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);

  const title = t("meetings.upcoming.title", "Upcoming");
  const rows = events?.rows ?? [];
  const days = groupByLocalDay(rows, (row) => row.start_utc_ms);

  /* A read that failed and a calendar that cannot be read are the same thing
   * to a reader: the section cannot say what is next. It says so once. */
  const copy = accessCopy(events?.access ?? "denied");

  return (
    <section data-slot="meetings-upcoming" className="flex flex-col gap-3">
      <div className="flex min-h-6 items-center">
        <h2>
          <Microlabel>{title}</Microlabel>
        </h2>
      </div>

      {loading ? (
        <UpcomingSkeleton
          label={t("meetings.upcoming.loading", "Reading your calendar…")}
        />
      ) : rows.length === 0 ? (
        <SettingsCard className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <p className="text-[13px] leading-5 text-gray-1000">
            {t(copy.line, copy.fallback)}
          </p>
          {copy.hint ? (
            <p className="max-w-[52ch] text-[13px] leading-5 text-gray-800">
              {t(
                "meetings.upcoming.noAccessHint",
                'Turn on "Use my calendar" in Meetings settings, then allow full access when macOS asks. Whatever macOS Calendar already shows — Google, iCloud, Outlook — comes with it.',
              )}
            </p>
          ) : null}
        </SettingsCard>
      ) : (
        <div className="flex flex-col gap-6">
          {days.map((day) => {
            const heading = localDayHeading(day.startOfDayMs, t);
            return (
              <section
                key={day.startOfDayMs}
                data-slot="upcoming-day"
                className="flex flex-col gap-3"
              >
                <div className="flex min-h-6 items-center">
                  <h3 className="text-[13px] leading-5 text-gray-900">
                    {heading}
                  </h3>
                </div>
                <ul
                  role="list"
                  aria-label={heading}
                  className={SETTINGS_SURFACE}
                >
                  {day.items.map((row) => (
                    <UpcomingRow
                      key={row.event_key}
                      row={row}
                      sources={sources}
                      saving={saving === row.series?.series_key}
                      expanded={expanded === row.event_key}
                      onToggleExpanded={() =>
                        setExpanded((current) =>
                          current === row.event_key ? null : row.event_key,
                        )
                      }
                      onOpenPerson={setPersonId}
                      onAlwaysRecord={(seriesKey, next) =>
                        void setAlwaysRecord(seriesKey, next)
                      }
                      onTemplate={(seriesKey, template) =>
                        void setTemplate(seriesKey, template)
                      }
                      onDigest={(seriesKey, next) =>
                        void setDigestIncluded(seriesKey, next)
                      }
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <PersonDetailDialog
        personId={personId}
        onPersonChange={setPersonId}
        onClose={() => setPersonId(null)}
      />
    </section>
  );
};

/** The connected section Meetings home mounts. */
export const MeetingsUpcoming: React.FC<{ sources: SourceKind[] }> = ({
  sources,
}) => {
  const state = useUpcomingEvents(sources);
  return <MeetingsUpcomingView sources={sources} {...state} />;
};
