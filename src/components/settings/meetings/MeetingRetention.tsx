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

/* One setting, so one row: the policy, and nothing else.
 *
 * How long a *meeting* is kept, which is a different object from the dictation
 * recordings Essentials governs — so it lives where meetings do, in Advanced >
 * Meetings. It renders as a bare row rather than a section of its own because
 * it is dropped into that section's hairline surface, where a heading saying
 * "Retention" above a row labelled "Retention" would be the same word twice.
 *
 * Picking an option is the write. The command carries `expected_revision`, so
 * a second window that moved the policy underneath this one is refused rather
 * than overwritten: the row states the refusal, re-reads, and shows what is
 * actually stored. That is the same protection the Save button next to this
 * select used to claim, minus a press that only ever repeated the choice
 * already made. */
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

  const save = async (selected: string) => {
    if (!snapshot) return;
    const policy: MeetingRetentionPolicy =
      selected === "forever"
        ? { kind: "forever" }
        : { kind: "delete_after_days", days: Number(selected) };

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
          onValueChange={(next) => {
            setSelection(next);
            void save(next);
          }}
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
      </SettingsRow>
      {error ? (
        /* `role="alert"` sits on the group, not the sentence, so the failure
         * and the way out are announced as one thing. */
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 px-6 py-2.5"
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
