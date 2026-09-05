import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { Switch } from "@/components/vg/switch";
import { Notice, RowActions, SettingsField } from "@/components/settings/rows";
import {
  ColumnHeader,
  EmptyLine,
  Hint,
  literalText,
  LoadingRows,
  RuleList,
  RuleRow,
} from "./PanelParts";
import {
  RULE_KINDS,
  type MergedRule,
  type RuleKind,
  type VocabularyRulesState,
} from "./useVocabularyRules";

/* One grid template for the column names, the add row and every rule, so the
 * kind, the two fields and the trailing controls line up down the list. The
 * trailing column is fixed because its switch comes and goes with the kind. */
const RULE_GRID =
  "grid items-center gap-2 sm:grid-cols-[104px_minmax(0,1fr)_minmax(0,1fr)_70px]";

export interface VocabularyRulesProps {
  state: VocabularyRulesState;
}

/**
 * Every text rule Sona applies after a transcript, as one list.
 *
 * Four stores, four kinds, one row shape: the kind is a word on the row rather
 * than a section heading, so a reader scanning for "why did it write that"
 * reads one list instead of choosing between four. The stores stay exactly
 * where they were — see `useVocabularyRules`.
 */
export const VocabularyRules: React.FC<VocabularyRulesProps> = ({ state }) => {
  const { t } = useTranslation();
  const [newKind, setNewKind] = useState<RuleKind>("vocabulary");
  const [newLeft, setNewLeft] = useState("");
  const [newRight, setNewRight] = useState("");

  const listLabel = t("modesV2.rules.title");
  const leftLabel = t("modesV2.rules.left");
  const rightLabel = t("modesV2.rules.right");
  const addLabel = t("modesV2.rules.add");
  const kindLabel = t("modesV2.rules.kind");

  const trimmedLeft = newLeft.trim();
  const collides =
    trimmedLeft !== "" &&
    state.rules.some(
      (rule) =>
        rule.kind === newKind &&
        rule.left.trim().toLowerCase() === trimmedLeft.toLowerCase(),
    );
  const incomplete = trimmedLeft === "" || newRight.trim() === "";
  const started = newLeft !== "" || newRight !== "";
  const addHint = collides
    ? t("modesV2.rules.errors.duplicate")
    : incomplete && started
      ? t("modesV2.rules.errors.incomplete")
      : t(`modesV2.rules.kindHints.${newKind}`);
  const canAdd = !state.busy && !incomplete && !collides;

  const addRule = () => {
    if (!canAdd) return;
    state.addRule(newKind, newLeft, newRight);
    setNewLeft("");
    setNewRight("");
  };

  const row = (rule: MergedRule) => {
    const problem = state.problems[rule.id];
    const hintId = `rule-hint-${rule.id}`;

    return (
      <RuleRow key={rule.id} data-testid="rule-row" data-rule-kind={rule.kind}>
        <div className={RULE_GRID}>
          {/* The kind is a word, not a coloured pill: it has to survive
           * greyscale, and this list is long enough that four saturated
           * chips per screen would read as decoration. */}
          <span className="truncate text-[12px] text-gray-700">
            {t(`modesV2.rules.kinds.${rule.kind}`)}
          </span>
          <Input
            className={cn(literalText, "h-8")}
            value={rule.left}
            onChange={(event) =>
              state.editRule(rule, "left", event.target.value)
            }
            onBlur={() => state.commitRule(rule)}
            onKeyDown={(event) => {
              if (event.key === "Enter") state.commitRule(rule);
            }}
            aria-label={leftLabel}
            aria-describedby={problem ? hintId : undefined}
            aria-invalid={problem !== undefined}
            disabled={state.busy}
            data-testid="rule-left"
          />
          <Input
            className={cn(literalText, "h-8")}
            value={rule.right}
            onChange={(event) =>
              state.editRule(rule, "right", event.target.value)
            }
            onBlur={() => state.commitRule(rule)}
            onKeyDown={(event) => {
              if (event.key === "Enter") state.commitRule(rule);
            }}
            aria-label={rightLabel}
            aria-describedby={problem ? hintId : undefined}
            disabled={state.busy}
            data-testid="rule-right"
          />
          <span className="flex items-center justify-end gap-1.5">
            {/* The switch is state, not an action: it stays visible while the
             * destructive control waits to be asked for. */}
            {rule.enabled === null ? null : (
              <Switch
                size="sm"
                checked={rule.enabled}
                disabled={state.busy}
                onCheckedChange={(enabled) => state.toggleRule(rule, enabled)}
                aria-label={t("modesV2.rules.applyRule", { rule: rule.left })}
              />
            )}
            <RowActions>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-gray-700 hover:text-red-900"
                disabled={state.busy}
                onClick={() => state.removeRule(rule)}
                aria-label={t("modesV2.rules.removeRule", { rule: rule.left })}
                data-testid="rule-delete"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </RowActions>
          </span>
        </div>
        {problem ? (
          <Hint id={hintId} tone="danger" live="polite" className="mt-1">
            {problem}
          </Hint>
        ) : null}
      </RuleRow>
    );
  };

  return (
    <div className="divide-y divide-gray-alpha-400" data-testid="rules-editor">
      <SettingsField label={addLabel}>
        <div className={RULE_GRID}>
          <Select
            value={newKind}
            disabled={state.busy}
            onValueChange={(value) => {
              const kind = RULE_KINDS.find((candidate) => candidate === value);
              if (kind) setNewKind(kind);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={kindLabel}
              data-testid="rule-new-kind"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RULE_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {t(`modesV2.rules.kinds.${kind}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className={literalText}
            value={newLeft}
            onChange={(event) => setNewLeft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addRule();
            }}
            placeholder={t(`modesV2.rules.placeholders.${newKind}.left`)}
            aria-label={leftLabel}
            aria-describedby="rule-add-hint"
            aria-invalid={collides}
            disabled={state.busy}
            data-testid="rule-new-left"
          />
          <Input
            className={literalText}
            value={newRight}
            onChange={(event) => setNewRight(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addRule();
            }}
            placeholder={t(`modesV2.rules.placeholders.${newKind}.right`)}
            aria-label={rightLabel}
            aria-describedby="rule-add-hint"
            disabled={state.busy}
            data-testid="rule-new-right"
          />
          {/* The field above carries the verb, so the button carries it as its
           * accessible name rather than as a string in a fixed column. */}
          <Button
            size="icon-sm"
            variant="outline"
            className="justify-self-start sm:justify-self-end"
            onClick={addRule}
            disabled={!canAdd}
            aria-label={addLabel}
            data-testid="rule-add"
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
        <Hint
          id="rule-add-hint"
          tone={collides ? "danger" : "muted"}
          live={collides ? "polite" : "off"}
          className="mt-2"
        >
          {addHint}
        </Hint>
      </SettingsField>

      {state.loading ? (
        <LoadingRows label={t("modesV2.rules.loading")} />
      ) : state.rules.length === 0 ? (
        <EmptyLine text={t("modesV2.rules.empty")} />
      ) : (
        <div>
          <ColumnHeader
            gridClassName={RULE_GRID}
            labels={[kindLabel, leftLabel, rightLabel]}
          />
          <RuleList label={listLabel}>{state.rules.map(row)}</RuleList>
        </div>
      )}

      {state.failure ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
          <Notice tone="danger">{state.failure.message}</Notice>
          <Button
            variant="outline"
            size="sm"
            disabled={state.busy}
            onClick={state.failure.retry}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : null}

      <Notice live={false} className="px-6 py-3">
        {t("modesV2.rules.matching")}
      </Notice>
    </div>
  );
};
