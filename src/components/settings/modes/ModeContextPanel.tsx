import React from "react";
import { useTranslation } from "react-i18next";
import type { ContextPolicy } from "@/bindings";
import { SettingContainer, SettingsGroup, StatusText } from "@/components/ui";
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
    <SettingsGroup title={t("settings.modes.context.title")}>
      <SettingContainer
        grouped
        layout="stacked"
        title={t("settings.modes.context.policy.label")}
        description={t("settings.modes.context.policy.description")}
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
          <p className="mt-2">
            <StatusText tone={selectionAboveCeiling ? "warning" : "muted"}>
              {selectionAboveCeiling
                ? t("settings.modes.context.policy.limitedByPrivacy")
                : `${blockedByCeiling} ${t(
                    "settings.modes.context.policy.raiseCeiling",
                    "Raise the ceiling in Privacy to use higher levels.",
                  )}`}
            </StatusText>
          </p>
        ) : null}
      </SettingContainer>
    </SettingsGroup>
  );
};
