import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Radar, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Notice, SettingsSection } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
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
 * never produce a syntax error. The placeholder is where that is said, because
 * three lowercase phrases demonstrate it in less space than a sentence about
 * it did. */

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
          "Sona could not save the trackers. Try again.",
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
    <SettingsSection
      label={t("meetings.analytics.trackersTitle", "Keyword trackers")}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setTrackers([...trackers, { name: "", patterns: [] }])}
          disabled={saving}
        >
          <Plus aria-hidden="true" />
          {t("meetings.analytics.addTracker", "Add tracker")}
        </Button>
      }
    >
      {trackers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <Radar aria-hidden="true" className="size-6 text-gray-700" />
          <Notice tone="muted" live={false}>
            {t(
              "meetings.analytics.noTrackers",
              "No trackers yet. Add one to start counting how often a phrase comes up.",
            )}
          </Notice>
        </div>
      ) : (
        <ul className="divide-y divide-gray-alpha-400">
          {trackers.map((tracker, index) => (
            <li
              key={index}
              className="flex flex-wrap items-center gap-2 px-4 py-2.5"
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
                className="h-8 w-40 flex-none text-[13px]"
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
                className="h-8 min-w-48 flex-1 text-[13px]"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="flex-none text-red-900"
                aria-label={t(
                  "meetings.analytics.removeTracker",
                  "Remove tracker",
                )}
                onClick={() =>
                  void commit(trackers.filter((_, at) => at !== index))
                }
                disabled={saving}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
};
