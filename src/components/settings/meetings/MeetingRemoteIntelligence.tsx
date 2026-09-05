import React, { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type MeetingSeriesRemoteRow } from "@/bindings";
import {
  Notice,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/rows";
import { Switch } from "@/components/vg/switch";
import { useSettings } from "@/hooks/useSettings";

/* D14: where a meeting's summaries, ledgers, recaps and answers get written.
 *
 * Two controls and one sentence. The switch routes meeting intelligence to the
 * operator's own server; the sentence says exactly what leaves this Mac when it
 * is on, and it stays on the surface rather than behind an info affordance,
 * because a consent sentence nobody reads is not consent. The list underneath
 * is the escape hatch: a series named here is written on this Mac even while
 * the switch is on.
 *
 * The switch is disabled until a relay is paired. Turning on a route to a
 * server that does not exist would be a setting that claims something untrue,
 * and the backend's own selection reads the same four settings fields this row
 * does, so the two cannot disagree about whether remote work is possible. */

const SeriesRow: React.FC<{
  row: MeetingSeriesRemoteRow;
  locale: string;
  saving: boolean;
  onToggle: (row: MeetingSeriesRemoteRow, optOut: boolean) => void;
}> = ({ row, locale, saving, onToggle }) => {
  const { t } = useTranslation();
  const id = useId();

  return (
    <SettingsRow
      label={row.title || row.series_key}
      fact={t("settings.meetings.remoteIntelligence.lastMet", {
        date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(row.last_met_at_utc_ms),
        ),
      })}
      controlId={id}
    >
      <Switch
        id={id}
        aria-label={t("settings.meetings.remoteIntelligence.keepLocalLabel", {
          series: row.title || row.series_key,
        })}
        checked={row.remote_intelligence_opt_out}
        disabled={saving}
        onCheckedChange={(optOut) => onToggle(row, optOut)}
      />
    </SettingsRow>
  );
};

export const MeetingRemoteIntelligence: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const switchId = useId();
  const [rows, setRows] = useState<MeetingSeriesRemoteRow[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const enabled = getSetting("meeting_remote_intelligence_enabled") ?? false;
  /* The same four fields the backend's own readiness check reads. A relay is
   * reachable only when the panel is on, a pairing was saved, and the pinned
   * key and its URL are both stored. */
  const paired =
    (getSetting("agent_panel_enabled") ?? false) &&
    (getSetting("agent_panel_paired") ?? false) &&
    getSetting("agent_panel_relay_url") != null &&
    getSetting("agent_panel_relay_key_id") != null &&
    getSetting("agent_panel_relay_public_key") != null;

  const load = useCallback(async () => {
    try {
      const result = await commands.meetingSeriesRemoteRoster();
      if (result.status === "ok") {
        setRows(result.data.rows);
        setRevision(result.data.revision);
        return;
      }
    } catch {
      /* A roster that cannot be read costs the list, not the switch. */
    }
    setRows([]);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setRows(null);
      return;
    }
    void load();
  }, [enabled, load]);

  const toggleSeries = (row: MeetingSeriesRemoteRow, optOut: boolean) => {
    setSaving(row.series_key);
    setFailed(false);
    void (async () => {
      try {
        const result = await commands.meetingSeriesRemoteOptOutSet({
          operation_id: crypto.randomUUID(),
          series_key: row.series_key,
          remote_intelligence_opt_out: optOut,
          expected_revision: revision,
        });
        /* The answer carries the receipt and the stored record, so a write
         * another pane fenced out leaves the row showing what is actually
         * stored and the reader can press again. */
        if (result.status === "ok") {
          setFailed(result.data.receipt.result !== "committed");
          await load();
        } else {
          setFailed(true);
        }
      } catch {
        setFailed(true);
      } finally {
        setSaving(null);
      }
    })();
  };

  return (
    <SettingsSection label={t("settings.meetings.remoteIntelligence.title")}>
      <SettingsRow
        label={t("settings.meetings.remoteIntelligence.label")}
        controlId={switchId}
        disabled={!paired}
      >
        <Switch
          id={switchId}
          checked={enabled}
          disabled={
            !paired || isUpdating("meeting_remote_intelligence_enabled")
          }
          onCheckedChange={(next) =>
            void updateSetting("meeting_remote_intelligence_enabled", next)
          }
        />
      </SettingsRow>
      <div className="flex flex-col gap-2 px-6 py-3">
        <Notice live={false}>
          {t("settings.meetings.remoteIntelligence.consent")}
        </Notice>
        {paired ? null : (
          <Notice tone="warning" live={false}>
            {t("settings.meetings.remoteIntelligence.unpaired")}
          </Notice>
        )}
        {failed ? (
          <Notice tone="danger" assertive>
            {t("settings.meetings.remoteIntelligence.saveFailed")}
          </Notice>
        ) : null}
      </div>
      {enabled ? (
        <>
          <SettingsRow
            label={t("settings.meetings.remoteIntelligence.seriesTitle")}
            hint={t("settings.meetings.remoteIntelligence.seriesHint")}
          />
          {rows === null ? (
            <div className="px-6 py-3">
              <Notice>
                {t("settings.meetings.remoteIntelligence.loading")}
              </Notice>
            </div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-3">
              <Notice live={false}>
                {t("settings.meetings.remoteIntelligence.seriesEmpty")}
              </Notice>
            </div>
          ) : (
            rows.map((row) => (
              <SeriesRow
                key={row.series_key}
                row={row}
                locale={i18n.language}
                saving={saving === row.series_key}
                onToggle={toggleSeries}
              />
            ))
          )}
        </>
      ) : null}
    </SettingsSection>
  );
};
