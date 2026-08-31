import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type MeetingRetentionPolicy,
  type MeetingRetentionSnapshot,
} from "@/bindings";
import { Notice, SettingsRow } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { meetingErrorKey } from "./meetingUtils";

const RETENTION_DAYS = [7, 30, 90] as const;

/* One setting, so one row: the policy, and the press that writes it.
 *
 * How long a *meeting* is kept, which is a different object from the dictation
 * recordings Essentials governs — so it lives where meetings do, in Advanced >
 * Meetings. It renders as a bare row rather than a section of its own because
 * it is dropped into that section's hairline surface, where a heading saying
 * "Retention" above a row labelled "Retention" would be the same word twice.
 *
 * The write is explicit because the command carries `expected_revision`: a
 * select that saved on change would race another window and lose. */
export const MeetingRetentionSettings: React.FC = () => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<MeetingRetentionSnapshot | null>(
    null,
  );
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
  const blocked = loading || saving || snapshot === null;

  return (
    <>
      <SettingsRow
        label={t("meetings.retention.title")}
        /* The one thing the control cannot state: what "delete" means here. */
        hint={t("meetings.retention.description")}
        controlId="meeting-retention"
        disabled={loading || snapshot === null}
      >
        {loading ? (
          <Notice tone="muted">
            {t("meetings.retention.loading", "Reading the current policy…")}
          </Notice>
        ) : null}
        <Select
          value={selection}
          onValueChange={setSelection}
          disabled={blocked}
        >
          <SelectTrigger
            id="meeting-retention"
            size="sm"
            className="min-w-52 justify-between"
          >
            <SelectValue>
              {options.find((option) => option.value === selection)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void save()}
          disabled={blocked}
        >
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </SettingsRow>
      {error ? (
        /* `role="alert"` sits on the group, not the sentence, so the failure
         * and the way out are announced as one thing. */
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
        >
          <Notice tone="danger" live={false}>
            {error}
          </Notice>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
          >
            {t("meetings.actions.retry")}
          </Button>
        </div>
      ) : null}
    </>
  );
};
