import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import {
  commands,
  type PromptRun,
  type PromptTarget,
  type SavedPrompt,
} from "@/bindings";
import { Notice, SettingsSection } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { MarkdownContent } from "@/components/whats-new/MarkdownContent";
import { formatRelativeTime } from "@/lib/utils/format";
import {
  promptFailureKeys,
  promptTargetRef,
  runSavedPrompt,
} from "../promptTargets";

/* What the saved prompts have said about this record.
 *
 * Nothing at all until one has been asked: a section reading "no results yet"
 * on every meeting would be a line of furniture on a reading surface. ⌘K is
 * where a prompt is asked the first time; Re-run is here because a second
 * answer is about a record you are already looking at.
 *
 * A failed run is shown, not hidden. Nothing retries, so the row saying which
 * engine was missing is the only record that the question was ever asked. */

interface PromptResultsProps {
  /** Which noun this surface is reading, as its two primitives: a fresh target
   * object every render would re-read the store on every paint. */
  kind: PromptTarget;
  id: string;
}

export const PromptResults: React.FC<PromptResultsProps> = ({ kind, id }) => {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<PromptRun[]>([]);
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [busy, setBusy] = useState(false);
  const target = useMemo(() => promptTargetRef(kind, id), [kind, id]);
  /* Read once per render and handed down, so every row on one paint measures
   * from the same instant. */
  const now = Date.now();

  const refresh = useCallback(async () => {
    const [runsResult, promptsResult] = await Promise.all([
      commands.savedPromptRuns(target),
      commands.savedPromptList(),
    ]);
    if (runsResult.status === "ok") setRuns(runsResult.data);
    if (promptsResult.status === "ok") setPrompts(promptsResult.data.prompts);
  }, [target]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rerun = async (promptId: string) => {
    setBusy(true);
    const outcome = await runSavedPrompt(promptId, target);
    setBusy(false);
    if (outcome.status === "missing") {
      toast.error(t("prompts.run.missing"));
      return;
    }
    if (outcome.status === "failed") {
      toast.error(t("prompts.run.failed"));
      return;
    }
    await refresh();
  };

  if (runs.length === 0) return null;

  return (
    <SettingsSection label={t("prompts.results.title")}>
      {runs.map((run) => (
        <PromptRunRow
          key={run.run_id}
          run={run}
          name={
            prompts.find((prompt) => prompt.prompt_id === run.prompt_id)?.name
          }
          now={now}
          busy={busy}
          onRerun={() => void rerun(run.prompt_id)}
        />
      ))}
    </SettingsSection>
  );
};

interface PromptRunRowProps {
  run: PromptRun;
  /** `undefined` once the prompt behind a run has been deleted. */
  name: string | undefined;
  now: number;
  busy: boolean;
  onRerun: () => void;
}

const PromptRunRow: React.FC<PromptRunRowProps> = ({
  run,
  name,
  now,
  busy,
  onRerun,
}) => {
  const { t } = useTranslation();

  return (
    <div data-slot="prompt-run" className="flex flex-col gap-3 px-6 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <span className="truncate text-[14px] leading-[21px] font-medium text-gray-1000">
          {name ?? t("prompts.results.deleted")}
        </span>
        <span className="flex flex-none items-center gap-2">
          <span className="text-[13px] leading-[18px] tabular-nums text-gray-900">
            {formatRelativeTime(run.produced_at_utc_ms, now)}
          </span>
          {name === undefined ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("prompts.results.rerun", { name })}
              disabled={busy}
              onClick={onRerun}
            >
              <RefreshCcw aria-hidden="true" className="size-3.5" />
            </Button>
          )}
        </span>
      </div>
      <PromptRunBody run={run} />
    </div>
  );
};

/** One answer, in whichever of its three shapes it came back as. */
export const PromptRunBody: React.FC<{ run: PromptRun }> = ({ run }) => {
  const { t } = useTranslation();
  if (run.result.kind === "failed") {
    return (
      <Notice tone="warning" live={false}>
        {t(promptFailureKeys[run.result.reason])}
      </Notice>
    );
  }
  if (run.result.kind === "text") {
    return <MarkdownContent markdown={run.result.text} />;
  }
  return <PromptRunJson json={run.result.json} />;
};

/**
 * A schema answer, as rows.
 *
 * The store only holds JSON that already checked against the prompt's schema,
 * so this renders what is there rather than validating again. It still parses
 * defensively: this is text a model wrote and a database kept, and a throw
 * during render would take the whole review page with it.
 */
const PromptRunJson: React.FC<{ json: string }> = ({ json }) => {
  const entries = jsonEntries(json);

  return (
    <dl data-slot="prompt-run-json" className="flex flex-col gap-1.5">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-baseline gap-3">
          <dt className="w-40 flex-none truncate text-[13px] text-gray-900">
            {key}
          </dt>
          <dd className="min-w-0 flex-1 text-[14px] text-gray-1000">{value}</dd>
        </div>
      ))}
    </dl>
  );
};

/* One cell, read as the text it shows. The schema subset this app enforces
 * describes strings, numbers, booleans and lists of those; anything deeper is
 * printed as JSON rather than flattened into something it is not. */
const scalarText = z.union([
  z.string(),
  z.number().transform(String),
  z.boolean().transform(String),
]);
const cellText = z.union([
  scalarText,
  z.array(scalarText).transform((items) => items.join(", ")),
  z.unknown().transform((value) => JSON.stringify(value) ?? ""),
]);
const promptAnswer = z.record(z.string(), cellText);

/** The stored answer's own keys, or none when it is not an object. */
const jsonEntries = (json: string): [string, string][] => {
  try {
    const parsed = promptAnswer.safeParse(JSON.parse(json));
    return parsed.success ? Object.entries(parsed.data) : [];
  } catch {
    return [];
  }
};
