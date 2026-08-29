import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, IconButton, Input, Section, StatusText } from "../../ui";
import {
  listKeywordTrackers,
  saveKeywordTrackers,
  type KeywordTracker,
} from "./meetingAnalytics";

/* Watch lists for words that matter to you. Every finished meeting transcript
 * is scanned for them on this Mac, and the hits show up on the meeting's own
 * Insights tab.
 *
 * Patterns are literal phrases, not patterns in the regular-expression sense:
 * "is that your best price?" is a phrase somebody says, and typing it should
 * never produce a syntax error. */

/** Patterns are edited as one comma-separated line, which is how people list
 *  phrases. Commas inside a phrase are not supported, and do not need to be. */
const PATTERN_SEPARATOR = ", ";

export const MeetingTrackersSettings: React.FC = () => {
  const { t } = useTranslation();
  const [trackers, setTrackers] = useState<KeywordTracker[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    listKeywordTrackers()
      .then((loaded) => {
        if (active) setTrackers(loaded);
      })
      .catch(() => {
        if (active) setTrackers([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const commit = async (next: KeywordTracker[]) => {
    setTrackers(next);
    setSaving(true);
    try {
      setTrackers(await saveKeywordTrackers(next));
    } catch {
      toast.error(
        t(
          "meetings.analytics.trackersSaveFailed",
          "Sona could not save the trackers. Change one and try again.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const edit = (index: number, tracker: KeywordTracker) => {
    if (trackers === null) return;
    setTrackers(trackers.map((item, at) => (at === index ? tracker : item)));
  };

  if (trackers === null) {
    return null;
  }

  return (
    <Section
      title={t("meetings.analytics.trackersTitle", "Keyword trackers")}
      description={t(
        "meetings.analytics.trackersDescription",
        "Phrases to watch for in every meeting transcript. Matching is literal and ignores case, and every scan runs on this Mac.",
      )}
      actions={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setTrackers([...trackers, { name: "", patterns: [] }])}
          disabled={saving}
        >
          <Plus size={14} aria-hidden="true" />
          {t("meetings.analytics.addTracker", "Add tracker")}
        </Button>
      }
    >
      {trackers.length === 0 ? (
        <StatusText tone="muted">
          {t(
            "meetings.analytics.noTrackers",
            "No trackers yet. Add one to start counting how often a phrase comes up.",
          )}
        </StatusText>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-panel border border-border">
          {trackers.map((tracker, index) => (
            <li
              key={index}
              className="flex flex-wrap items-center gap-2 px-3 py-2.5"
            >
              <Input
                value={tracker.name}
                onChange={(event) =>
                  edit(index, { ...tracker, name: event.target.value })
                }
                onBlur={() => void commit(trackers)}
                placeholder={t("meetings.analytics.trackerName", "Name")}
                aria-label={t("meetings.analytics.trackerName", "Name")}
                disabled={saving}
                className="w-40 flex-none"
              />
              <Input
                value={tracker.patterns.join(PATTERN_SEPARATOR)}
                onChange={(event) =>
                  edit(index, {
                    ...tracker,
                    patterns: event.target.value.split(","),
                  })
                }
                onBlur={() => void commit(trackers)}
                placeholder={t(
                  "meetings.analytics.trackerPatterns",
                  "discount, best price, too expensive",
                )}
                aria-label={t(
                  "meetings.analytics.trackerPatternsLabel",
                  "Phrases, separated by commas",
                )}
                disabled={saving}
                className="min-w-48 flex-1"
              />
              <IconButton
                type="button"
                variant="danger-ghost"
                size="sm"
                label={t("meetings.analytics.removeTracker", "Remove tracker")}
                icon={<Trash2 size={14} aria-hidden="true" />}
                onClick={() =>
                  void commit(trackers.filter((_, at) => at !== index))
                }
                disabled={saving}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
};
