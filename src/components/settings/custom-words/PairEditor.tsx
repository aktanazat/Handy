import React, { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { PairEntry } from "@/lib/vocabularyDraft";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import { Notice, SettingsField } from "@/components/settings/rows";
import {
  ColumnHeader,
  EmptyLine,
  Hint,
  literalText,
  LoadingRows,
  RowActions,
  RuleList,
  RuleRow,
} from "../vocabulary/PanelParts";

interface PairEditorLabels {
  /** Names the list for assistive tech; the section above prints it. */
  title: string;
  spoken: string;
  written: string;
  spokenPlaceholder: string;
  writtenPlaceholder: string;
  add: string;
  save: string;
  remove: (spoken: string) => string;
  /** One line, shown instead of the list. Never a second name for the list. */
  empty: string;
}

interface PairEditorProps {
  labels: PairEditorLabels;
  entries: readonly PairEntry[];
  draftSpoken: string;
  draftWritten: string;
  /** Draft-row problem: sits under the new-pair fields and blocks Add. */
  draftHint: { text: string; blocking: boolean } | null;
  canAdd: boolean;
  changed: boolean;
  saving: boolean;
  loading: boolean;
  /** Rules the backend would reject. Named beside Save; they block it. */
  blockers: readonly string[];
  testId: string;
  getRowKey: (entry: PairEntry) => string;
  onDraftSpokenChange: (value: string) => void;
  onDraftWrittenChange: (value: string) => void;
  onAdd: () => void;
  onEdit: (index: number, field: "spoken" | "written", value: string) => void;
  onRemove: (index: number) => void;
  onSave: () => void;
  /** Where the rows in this list come from, and where the others live. */
  footnote?: string;
}

/* One grid template for the column names and every row, so cells line up.
 * The trailing column is a fixed width because it holds an icon button. */
/* The action column is a fixed 35px (2.5rem at this app's 14px root, written
 * as the px it renders): one 28px icon button plus breathing room. */
const PAIR_GRID =
  "grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_35px]";

/**
 * A spoken/written rule list: one row per rule, edited in place, with a
 * new-pair field above it and one save for the whole list. Both the vocabulary
 * and the emoji replacements are this shape, and the backend takes the whole
 * list on every write, which is why Save is per list and not per row.
 *
 * The caller owns the section around this: it is the body of one, never its
 * own box.
 */
export const PairEditor: React.FC<PairEditorProps> = ({
  labels,
  entries,
  draftSpoken,
  draftWritten,
  draftHint,
  canAdd,
  changed,
  saving,
  loading,
  blockers,
  testId,
  getRowKey,
  onDraftSpokenChange,
  onDraftWrittenChange,
  onAdd,
  onEdit,
  onRemove,
  onSave,
  footnote,
}) => {
  const draftHintId = useId();
  const { t } = useTranslation();

  return (
    <div className="divide-y divide-gray-alpha-400" data-testid={testId}>
      <SettingsField label={labels.add}>
        <div className={PAIR_GRID}>
          <Input
            className={literalText}
            value={draftSpoken}
            onChange={(event) => onDraftSpokenChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canAdd) onAdd();
            }}
            placeholder={labels.spokenPlaceholder}
            aria-label={labels.spoken}
            aria-describedby={draftHint ? draftHintId : undefined}
            aria-invalid={draftHint?.blocking ?? false}
            disabled={saving}
            data-testid={`${testId}-new-spoken`}
          />
          <Input
            className={literalText}
            value={draftWritten}
            onChange={(event) => onDraftWrittenChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canAdd) onAdd();
            }}
            placeholder={labels.writtenPlaceholder}
            aria-label={labels.written}
            aria-describedby={draftHint ? draftHintId : undefined}
            disabled={saving}
            data-testid={`${testId}-new-written`}
          />
          <Button
            size="icon-sm"
            variant="outline"
            className="justify-self-start sm:justify-self-end"
            onClick={onAdd}
            disabled={!canAdd}
            aria-label={labels.add}
            data-testid={`${testId}-add`}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
        {draftHint && (
          <Hint
            id={draftHintId}
            tone={draftHint.blocking ? "danger" : "muted"}
            live={draftHint.blocking ? "polite" : "off"}
            className="mt-2"
          >
            {draftHint.text}
          </Hint>
        )}
      </SettingsField>

      {loading ? (
        <LoadingRows label={t("common.loading")} />
      ) : entries.length === 0 ? (
        <EmptyLine text={labels.empty} />
      ) : (
        <div>
          <ColumnHeader
            gridClassName={PAIR_GRID}
            start={labels.spoken}
            end={labels.written}
          />
          <RuleList label={labels.title}>
            {entries.map((entry, index) => (
              <RuleRow key={getRowKey(entry)} data-testid={`${testId}-row`}>
                <div className={PAIR_GRID}>
                  <Input
                    className={cn(literalText, "h-8")}
                    value={entry.spoken}
                    onChange={(event) =>
                      onEdit(index, "spoken", event.target.value)
                    }
                    aria-label={labels.spoken}
                    aria-invalid={entry.spoken.trim() === ""}
                    disabled={saving}
                  />
                  <Input
                    className={cn(literalText, "h-8")}
                    value={entry.written}
                    onChange={(event) =>
                      onEdit(index, "written", event.target.value)
                    }
                    aria-label={labels.written}
                    aria-invalid={entry.written.trim() === ""}
                    disabled={saving}
                  />
                  <RowActions className="justify-self-end">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-gray-700 hover:text-red-900"
                      onClick={() => onRemove(index)}
                      aria-label={labels.remove(entry.spoken)}
                      disabled={saving}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </RowActions>
                </div>
              </RuleRow>
            ))}
          </RuleList>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
        {blockers.length > 0 && (
          <div className="mr-auto flex flex-col gap-1">
            {blockers.map((blocker) => (
              <Notice key={blocker} tone="danger">
                {blocker}
              </Notice>
            ))}
          </div>
        )}
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving || !changed || blockers.length > 0}
          data-testid={`${testId}-save`}
        >
          {labels.save}
        </Button>
      </div>

      {footnote && (
        <Notice live={false} className="px-4 py-3">
          {footnote}
        </Notice>
      )}
    </div>
  );
};
