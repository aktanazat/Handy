import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type MeetingRetentionPolicy,
  type MeetingRetentionSnapshot,
} from "@/bindings";
import { Button } from "../../ui/Button";
import { Dropdown } from "../../ui/Dropdown";
import { SettingContainer } from "../../ui/SettingContainer";
import { meetingErrorKey } from "./meetingUtils";

const RETENTION_DAYS = [7, 30, 90] as const;

export const MeetingRetentionSettings: React.FC = () => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<MeetingRetentionSnapshot | null>(null);
  const [selection, setSelection] = useState("forever");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await commands.meetingRetentionGet();
      if (result.status === "error") {
        setSnapshot(null);
        setError(t(meetingErrorKey(result.error)));
        return;
      }
      setSnapshot(result.data);
      setSelection(
        result.data.policy.kind === "delete_after_days"
          ? String(result.data.policy.days)
          : "forever",
      );
    } catch {
      setSnapshot(null);
      setError(t("meetings.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!snapshot) return;
    const policy: MeetingRetentionPolicy =
      selection === "forever"
        ? { kind: "forever" }
        : { kind: "delete_after_days", days: Number(selection) };

    setSaving(true);
    setError(null);
    try {
      const result = await commands.meetingRetentionSet({
        operation_id: crypto.randomUUID(),
        expected_revision: snapshot.revision,
        policy,
      });
      if (result.status === "error") {
        setError(t(meetingErrorKey(result.error)));
        if (result.error === "stale_revision") await load();
        return;
      }
      setSnapshot(result.data.snapshot);
    } catch {
      setError(t("meetings.errors.operation"));
    } finally {
      setSaving(false);
    }
  };

  const options = [
    { value: "forever", label: t("meetings.retention.forever") },
    ...RETENTION_DAYS.map((days) => ({
      value: String(days),
      label: t("meetings.retention.days", { days }),
    })),
  ];

  return (
    <>
      <SettingContainer
        grouped
        title={t("meetings.retention.title")}
        description={t("meetings.retention.description")}
      >
        <div className="meeting-retention-control">
          <Dropdown
            selectedValue={selection}
            options={options}
            onSelect={setSelection}
            disabled={loading || saving || snapshot === null}
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void save()}
            disabled={loading || saving || snapshot === null}
          >
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </SettingContainer>
      {error ? (
        <div className="inline-setting-error" role="alert">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            {t("meetings.actions.retry")}
          </Button>
        </div>
      ) : null}
    </>
  );
};
