import React from "react";
import { useTranslation } from "react-i18next";
import type {
  ModeActivationRule,
  ModeWebsiteActivationRule,
  WebsiteHostMatch,
} from "@/bindings";
import {
  Notice,
  SettingsField,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { ShortcutInput } from "../ShortcutInput";
import { ActivationRuleList, type ActivationRuleItem } from "./ModeControls";
import { WEBSITE_HOST_MATCHES, modeBindingId } from "./modeModel";

export interface ModeAutomationPanelProps {
  modeId: string;
  modeCount: number;
  activationRules: readonly ModeActivationRule[];
  websiteActivationRules: readonly ModeWebsiteActivationRule[];
  /** Frontmost-application identity is a macOS capability. */
  activationSupported: boolean;
  /** Privacy > Browser URLs. Website rules cannot be captured without it. */
  websiteCaptureEnabled: boolean;
  websiteMatchKind: WebsiteHostMatch;
  onWebsiteMatchKindChange: (matchKind: WebsiteHostMatch) => void;
  capturing: boolean;
  saving: boolean;
  onCaptureActivation: () => void;
  onRemoveActivation: (appId: string) => void;
  onCaptureWebsiteActivation: (matchKind: WebsiteHostMatch) => void;
  onRemoveWebsiteActivation: (
    host: string,
    matchKind: WebsiteHostMatch,
  ) => void;
}

/* The Automation tab. Three named sections — shortcuts, app rules, website
 * rules — none of which repeats the tab's own word, so all three keep their
 * microlabel. What each section's rows used to repeat underneath their titles
 * is gone; the one sentence that is not inferable from a title survives: that
 * a website rule stores the host and not the URL. */

export const ModeAutomationPanel: React.FC<ModeAutomationPanelProps> = ({
  modeId,
  modeCount,
  activationRules,
  websiteActivationRules,
  activationSupported,
  websiteCaptureEnabled,
  websiteMatchKind,
  onWebsiteMatchKindChange,
  capturing,
  saving,
  onCaptureActivation,
  onRemoveActivation,
  onCaptureWebsiteActivation,
  onRemoveWebsiteActivation,
}) => {
  const { t } = useTranslation();
  const busy = saving || capturing;

  const appItems: ActivationRuleItem[] = [];
  for (const rule of activationRules) {
    if (rule.mode_id !== modeId) continue;
    appItems.push({
      id: rule.app_id,
      target: rule.app_id,
      removeLabel: t(
        "settings.modes.activation.removeTarget",
        "Remove {{target}}",
        { target: rule.app_id },
      ),
      onRemove: () => onRemoveActivation(rule.app_id),
    });
  }

  const websiteItems: ActivationRuleItem[] = [];
  for (const rule of websiteActivationRules) {
    if (rule.mode_id !== modeId) continue;
    websiteItems.push({
      id: `${rule.host}:${rule.match_kind}`,
      target: rule.host,
      detail: t(
        `settings.modes.activation.website.scope.values.${rule.match_kind}`,
      ),
      removeLabel: t(
        "settings.modes.activation.removeTarget",
        "Remove {{target}}",
        { target: rule.host },
      ),
      onRemove: () => onRemoveWebsiteActivation(rule.host, rule.match_kind),
    });
  }

  const unsupportedNote = t(
    "settings.modes.activation.unsupported",
    "App and website activation are available on macOS only.",
  );

  const websiteScopeDisabled = !activationSupported || !websiteCaptureEnabled;

  return (
    <>
      <SettingsSection label={t("settings.modes.shortcuts.title")}>
        {/* Past the ninth mode there is no numbered switch chord left to
         * assign, so a new mode arrives unbound. That is the one thing this
         * section cannot show, and only past nine modes. */}
        {modeCount > 9 ? (
          <div className="px-4 py-3">
            <Notice live={false}>
              {t("settings.modes.shortcuts.manyModes")}
            </Notice>
          </div>
        ) : null}
        <ShortcutInput shortcutId={modeBindingId(modeId, "transcribe")} />
        <ShortcutInput shortcutId={modeBindingId(modeId, "switch")} />
      </SettingsSection>

      <SettingsSection label={t("settings.modes.activation.title")}>
        <SettingsField
          label={t("settings.modes.activation.capture.label")}
          disabled={!activationSupported}
        >
          {activationSupported ? (
            <ActivationRuleList
              label={t("settings.modes.activation.title")}
              items={appItems}
              disabled={busy}
              emptyTitle={t("settings.modes.activation.empty")}
              emptyDescription={t(
                "settings.modes.activation.exampleDescription",
                "A rule stores one application identity, for example com.apple.mail.",
              )}
              removeText={t("settings.modes.activation.remove")}
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={onCaptureActivation}
                >
                  {capturing
                    ? t("settings.modes.activation.capture.capturing")
                    : t("settings.modes.activation.capture.action")}
                </Button>
              }
            />
          ) : (
            <Notice live={false}>{unsupportedNote}</Notice>
          )}
        </SettingsField>
      </SettingsSection>

      <SettingsSection label={t("settings.modes.activation.website.title")}>
        <SettingsRow
          label={t("settings.modes.activation.website.scope.label")}
          controlId="mode-website-scope"
          disabled={websiteScopeDisabled}
        >
          <Select
            value={websiteMatchKind}
            disabled={websiteScopeDisabled}
            onValueChange={(value) => {
              const matchKind = WEBSITE_HOST_MATCHES.find(
                (candidate) => candidate === value,
              );
              if (matchKind) onWebsiteMatchKindChange(matchKind);
            }}
          >
            <SelectTrigger id="mode-website-scope" className="min-w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEBSITE_HOST_MATCHES.map((matchKind) => (
                <SelectItem key={matchKind} value={matchKind}>
                  {t(
                    `settings.modes.activation.website.scope.values.${matchKind}`,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsField
          label={t("settings.modes.activation.website.capture.label")}
          hint={t("settings.modes.activation.website.capture.description")}
          disabled={websiteScopeDisabled}
        >
          {!activationSupported ? (
            <Notice live={false}>{unsupportedNote}</Notice>
          ) : !websiteCaptureEnabled ? (
            <Notice tone="warning" live={false}>
              {t("settings.modes.errors.website_activation_consent_required")}
            </Notice>
          ) : (
            <ActivationRuleList
              label={t("settings.modes.activation.website.title")}
              items={websiteItems}
              disabled={busy}
              emptyTitle={t("settings.modes.activation.website.empty")}
              emptyDescription={t(
                "settings.modes.activation.website.exampleDescription",
                "A rule stores one browser host, for example mail.google.com.",
              )}
              removeText={t("settings.modes.activation.remove")}
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onCaptureWebsiteActivation(websiteMatchKind)}
                >
                  {capturing
                    ? t("settings.modes.activation.website.capture.capturing")
                    : t("settings.modes.activation.website.capture.action")}
                </Button>
              }
            />
          )}
        </SettingsField>
      </SettingsSection>
    </>
  );
};
