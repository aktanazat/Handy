import { useCallback, useEffect, useState } from "react";
import {
  commands,
  type MeetingNotesTemplate,
  type MeetingSeriesPreferences,
} from "@/bindings";

/* The client half of per-series preferences: read what one series has decided,
 * and write one of those decisions.
 *
 * The record is the whole state — the series key (null when a meeting belongs
 * to no series), the template (null when the series has made no choice),
 * whether it stays in the evening digest, whether it records itself, and the
 * revision the next write has to carry. A read that fails leaves it null,
 * which every surface renders as "no series": a store that cannot answer costs
 * a missing control rather than an error nobody can act on.
 *
 * Nothing is cached across surfaces. The pre-meeting card and the review screen
 * each ask, and each ask is one row. D28's Upcoming section does not use these
 * hooks: it reads a week of series in one command rather than one row at a
 * time, which is the same state reached the way a list has to reach it. */

/** The series preference behind one calendar event, for the pre-meeting card. */
export const useSeriesTemplate = (
  seriesKey: string | null | undefined,
): MeetingSeriesPreferences | null => {
  const [snapshot, setSnapshot] = useState<MeetingSeriesPreferences | null>(
    null,
  );

  useEffect(() => {
    if (seriesKey === null || seriesKey === undefined || seriesKey === "") {
      setSnapshot(null);
      return;
    }
    let active = true;
    commands
      .meetingSeriesTemplateGet(seriesKey)
      .then((result) => {
        if (active) setSnapshot(result.status === "ok" ? result.data : null);
      })
      .catch(() => {
        if (active) setSnapshot(null);
      });
    return () => {
      active = false;
    };
  }, [seriesKey]);

  return snapshot;
};

/** The series preference behind one meeting, plus the write the review screen
 * offers. */
export const useSessionSeriesTemplate = (sessionId: string) => {
  const [snapshot, setSnapshot] = useState<MeetingSeriesPreferences | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    commands
      .meetingSeriesTemplateForSession(sessionId)
      .then((result) => {
        if (active) setSnapshot(result.status === "ok" ? result.data : null);
      })
      .catch(() => {
        if (active) setSnapshot(null);
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  /* One press writes the template the reader is looking at. The answer carries
   * its own snapshot, so a write another window fenced out leaves the button
   * showing what is actually stored and the reader can press again. */
  const remember = useCallback(
    async (template: MeetingNotesTemplate) => {
      if (snapshot === null || snapshot.series_key === null) return;
      setSaving(true);
      try {
        const result = await commands.meetingSeriesTemplateSet({
          operation_id: crypto.randomUUID(),
          series_key: snapshot.series_key,
          template,
          expected_revision: snapshot.revision,
        });
        if (result.status === "ok") setSnapshot(result.data.preferences);
      } catch {
        /* The stored row is unchanged and the button is still there. */
      } finally {
        setSaving(false);
      }
    },
    [snapshot],
  );

  return { snapshot, saving, remember };
};
