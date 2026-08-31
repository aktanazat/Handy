import { useCallback, useEffect, useState } from "react";
import {
  commands,
  type MeetingCommandError,
  type MeetingNotesTemplate,
  type MeetingSeriesMutationResult,
  type MeetingSeriesPreferences,
  type MeetingUpcomingEvents,
  type MeetingUpcomingRow,
  type Result,
  type SourceKind,
} from "@/bindings";
import { MEETING_CONSENT_POLICY_VERSION } from "../MeetingStartGate";

/* D28's client half: one read of the week ahead, and the three writes its rows
 * offer.
 *
 * One command per mount, not one preference read per row. The backend already
 * joined each recurring row to what its series remembers, so the pane holds a
 * whole week of state and a single fence — `series_revision` — that every write
 * from these rows carries.
 *
 * Two occurrences of the same series can sit in one week, so a write patches
 * every row with that series key rather than the row that was pressed. The
 * answer always carries the stored record, including when the fence rejected
 * the write, which is what makes a rejection self-healing: the switch snaps
 * back to what is actually stored instead of lying until the next mount. */

/** How far ahead the section looks. D28's window: today and the next seven. */
export const UPCOMING_DAYS = 7;

export interface UpcomingEventsState {
  events: MeetingUpcomingEvents | null;
  loading: boolean;
  /** The series key currently being written, so its row can quiet its controls. */
  saving: string | null;
  setAlwaysRecord: (seriesKey: string, alwaysRecord: boolean) => Promise<void>;
  setTemplate: (
    seriesKey: string,
    template: MeetingNotesTemplate | null,
  ) => Promise<void>;
  setDigestIncluded: (seriesKey: string, included: boolean) => Promise<void>;
}

/** Replaces the joined series state on every row that belongs to `seriesKey`. */
const patchSeries = (
  events: MeetingUpcomingEvents,
  seriesKey: string,
  preferences: MeetingSeriesPreferences,
): MeetingUpcomingEvents => ({
  ...events,
  series_revision: preferences.revision,
  rows: events.rows.map((row: MeetingUpcomingRow) =>
    row.series?.series_key === seriesKey
      ? {
          ...row,
          series: {
            series_key: seriesKey,
            always_record: preferences.always_record,
            template: preferences.template,
            digest_included: preferences.digest_included,
          },
        }
      : row,
  ),
});

/**
 * The week ahead plus the writes its rows offer.
 *
 * `sources` is the capture selection shown on this same page. It is the
 * acknowledgement the always-record grant records, which is why it is a
 * parameter and not a default invented here: a standing grant has to name the
 * sources the operator actually saw.
 */
export const useUpcomingEvents = (
  sources: SourceKind[],
): UpcomingEventsState => {
  const [events, setEvents] = useState<MeetingUpcomingEvents | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    commands
      .meetingUpcomingEvents(UPCOMING_DAYS)
      .then((result) => {
        if (!active) return;
        setEvents(result.status === "ok" ? result.data : null);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setEvents(null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  /* Every write is the same three steps against the same fence, so they share
   * one runner and differ only in the command they send.
   *
   * The fence is the pane's own number, defaulting to 0 before the read lands.
   * There is no guard for "no events yet": a control only exists on a row, a
   * row only exists after the read, and a guard for a state the UI cannot
   * produce would be a silent no-op with nothing to explain it. If a write
   * ever did arrive early, the stale-revision fence rejects it and the answer
   * still carries the stored record, which is the same self-healing path a
   * genuinely stale write takes. */
  const write = useCallback(
    async (
      seriesKey: string,
      send: (
        revision: number,
      ) => Promise<Result<MeetingSeriesMutationResult, MeetingCommandError>>,
    ) => {
      setSaving(seriesKey);
      try {
        const result = await send(events?.series_revision ?? 0);
        if (result.status === "ok") {
          setEvents((current) =>
            current === null
              ? current
              : patchSeries(current, seriesKey, result.data.preferences),
          );
        }
      } catch {
        /* Nothing was written and the row still shows the stored state. */
      } finally {
        setSaving(null);
      }
    },
    [events],
  );

  const setAlwaysRecord = useCallback(
    (seriesKey: string, alwaysRecord: boolean) =>
      write(seriesKey, (expected_revision) =>
        commands.meetingSeriesAlwaysRecordSet({
          operation_id: crypto.randomUUID(),
          series_key: seriesKey,
          always_record: alwaysRecord,
          policy_version: MEETING_CONSENT_POLICY_VERSION,
          acknowledged_sources: alwaysRecord ? sources : [],
          expected_revision,
        }),
      ),
    [sources, write],
  );

  const setTemplate = useCallback(
    (seriesKey: string, template: MeetingNotesTemplate | null) =>
      write(seriesKey, (expected_revision) =>
        commands.meetingSeriesTemplateSet({
          operation_id: crypto.randomUUID(),
          series_key: seriesKey,
          template,
          expected_revision,
        }),
      ),
    [write],
  );

  const setDigestIncluded = useCallback(
    (seriesKey: string, included: boolean) =>
      write(seriesKey, (expected_revision) =>
        commands.meetingSeriesDigestSet({
          operation_id: crypto.randomUUID(),
          series_key: seriesKey,
          digest_included: included,
          expected_revision,
        }),
      ),
    [write],
  );

  return {
    events,
    loading,
    saving,
    setAlwaysRecord,
    setTemplate,
    setDigestIncluded,
  };
};
