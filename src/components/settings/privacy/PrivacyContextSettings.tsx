import React from "react";
import { useTranslation } from "react-i18next";
import type { ContextPolicy } from "@/bindings";
import { Switch } from "@/components/vg/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/vg/toggle-group";
import { Notice, SettingsField, SettingsRow } from "@/components/settings/rows";
import { FailureNotice } from "./FailureNotice";
import { useContextCapture } from "./useContextCapture";

const CONTEXT_POLICIES = [
  "none",
  "target",
  "target_and_selection",
  "full",
] as const satisfies readonly ContextPolicy[];

/* The global ceiling on what Sona may read from the app you are dictating
 * into, and the one opt-in that goes past it.
 *
 * A bare row group: Advanced puts this behind a disclosure whose summary
 * already names it, and a heading inside that would say it twice. */
export const PrivacyContextSettings: React.FC = () => {
  const { t } = useTranslation();
  const {
    contextCeiling,
    contextUrlCaptureEnabled,
    ceilingError,
    ceilingUpdating,
    urlCaptureError,
    urlCaptureUpdating,
    changeContextCeiling,
    changeContextUrlCaptureEnabled,
  } = useContextCapture();

  return (
    <>
      <SettingsField label={t("settings.privacy.context.ceiling.label")}>
        {/* The one segmented primitive, same as Library's Processed/Raw and
         * the Material control: a bordered track whose active segment is
         * filled. Four sibling radio chips were a second convention. */}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={contextCeiling}
          aria-label={t("settings.privacy.context.ceiling.label")}
          onValueChange={(next) => {
            /* Radix clears the value when the active segment is pressed
             * again, and a ceiling has no empty state: only a real member
             * reaches the command. */
            const ceiling = CONTEXT_POLICIES.find((policy) => policy === next);
            if (ceiling) void changeContextCeiling(ceiling);
          }}
        >
          {CONTEXT_POLICIES.map((policy) => (
            <ToggleGroupItem
              key={policy}
              value={policy}
              disabled={ceilingUpdating}
            >
              {t("settings.privacy.context.ceiling.values." + policy)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {/* What the selected level reads: a consequence of the choice above,
         * where the old four-row table restated all four labels. */}
        <Notice className="mt-2">
          {t("settings.privacy.context.sources." + contextCeiling)}
        </Notice>
      </SettingsField>
      {ceilingError ? (
        <FailureNotice className="px-4 py-2.5">
          {`${t("settings.privacy.context.ceiling.error")}: ${ceilingError}`}
        </FailureNotice>
      ) : null}
      <SettingsRow
        label={t("settings.privacy.context.urlCapture.label")}
        hint={t("settings.privacy.context.urlCapture.description")}
        controlId="privacy-url-capture"
      >
        <Switch
          id="privacy-url-capture"
          checked={contextUrlCaptureEnabled}
          disabled={urlCaptureUpdating}
          onCheckedChange={(enabled) =>
            void changeContextUrlCaptureEnabled(enabled)
          }
        />
      </SettingsRow>
      {urlCaptureError ? (
        <FailureNotice className="px-4 py-2.5">{urlCaptureError}</FailureNotice>
      ) : null}
    </>
  );
};
