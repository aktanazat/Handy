import { useCallback, useEffect, useState } from "react";
import {
  commands,
  type MeetingNotesTemplate,
  type MeetingSeriesTemplateSnapshot,
} from "@/bindings";

/* D21's client half: read one series' remembered notes template, and write it.
 *
 * The snapshot is the whole state — the series key (null when a meeting belongs
 * to no series), the template (null when the series has made no choice), and
 * the revision the next write has to carry. A read that fails leaves it null,
 * which every surface renders as "no series": a store that cannot answer costs
 * a missing control rather than an error nobody can act on.
 *
 * Nothing is cached across surfaces. The pre-meeting card and the review screen
 * each ask, and each ask is one row. */

/** The series preference behind one calendar event, for the pre-meeting card. */
export const useSeriesTemplate = (
  seriesKey: string | null | undefined,
): MeetingSeriesTemplateSnapshot | null => {
  const [snapshot, setSnapshot] =
    useState<MeetingSeriesTemplateSnapshot | null>(null);

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
  const [snapshot, setSnapshot] =
    useState<MeetingSeriesTemplateSnapshot | null>(null);
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
        if (result.status === "ok") setSnapshot(result.data.snapshot);
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
