import React from "react";
import { useTranslation } from "react-i18next";
import type { ContextPolicy } from "@/bindings";
import {
  Notice,
  SettingsField,
  SettingsSurface,
} from "@/components/settings/rows";
import { SegmentedRadioGroup, type SegmentedOption } from "./ModeControls";
import {
  CONTEXT_POLICIES,
  hasHigherPolicy,
  type ModePanelProps,
} from "./modeModel";

export interface ModeContextPanelProps extends ModePanelProps {
  /** The most revealing level Privacy currently permits. */
  ceiling: ContextPolicy;
}

/* One field, and the tab already reads "Context", so the surface is unlabelled
 * rather than repeating the tab as a heading. */
export const ModeContextPanel: React.FC<ModeContextPanelProps> = ({
  mode,
  updaters,
  ceiling,
}) => {
  const { t } = useTranslation();
  const ceilingLabel = t(`settings.modes.context.policy.values.${ceiling}`);
  const blockedByCeiling = t(
    "settings.modes.context.policy.blockedByCeiling",
    "Privacy limits this mode to {{ceiling}}.",
    { ceiling: ceilingLabel },
  );

  const policyOptions: SegmentedOption<ContextPolicy>[] = CONTEXT_POLICIES.map(
    (policy) => {
      const blocked = hasHigherPolicy(policy, ceiling);
      return {
        value: policy,
        label: t(`settings.modes.context.policy.values.${policy}`),
        disabled: blocked,
        reason: blocked ? blockedByCeiling : undefined,
      };
    },
  );

  const anyBlocked = policyOptions.some((option) => option.disabled);
  const selectionAboveCeiling =
    mode.context_policy !== "none" &&
    hasHigherPolicy(mode.context_policy, ceiling);

  return (
    <SettingsSurface>
      <SettingsField
        label={t("settings.modes.context.policy.label")}
        /* Not inferable from four level names: the ceiling outranks whatever
         * this mode asks for. */
        hint={t("settings.modes.context.policy.description")}
      >
        <SegmentedRadioGroup
          layout="grid"
          name="mode-context-policy"
          legend={t("settings.modes.context.policy.label")}
          value={mode.context_policy}
          options={policyOptions}
          onChange={(policy) => updaters.update("context_policy", policy)}
        />
        {selectionAboveCeiling || anyBlocked ? (
          <Notice
            tone={selectionAboveCeiling ? "warning" : "muted"}
            live={false}
            className="mt-2"
          >
            {selectionAboveCeiling
              ? t("settings.modes.context.policy.limitedByPrivacy")
              : `${blockedByCeiling} ${t(
                  "settings.modes.context.policy.raiseCeiling",
                  "Raise the ceiling in Privacy to use higher levels.",
                )}`}
          </Notice>
        ) : null}
      </SettingsField>
    </SettingsSurface>
  );
};
