import React from "react";
import { useTranslation } from "react-i18next";
import type {
  ModeActivationRule,
  ModeWebsiteActivationRule,
  WebsiteHostMatch,
} from "@/bindings";
import {
  Button,
  Dropdown,
  SettingContainer,
  SettingsGroup,
  StatusText,
} from "@/components/ui";
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

  return (
    <>
      <SettingsGroup
        title={t("settings.modes.shortcuts.title")}
        description={
          modeCount > 9
            ? t("settings.modes.shortcuts.manyModes")
            : t("settings.modes.shortcuts.description")
        }
      >
        <ShortcutInput
          grouped
          descriptionMode="inline"
          shortcutId={modeBindingId(modeId, "transcribe")}
        />
        <ShortcutInput
          grouped
          descriptionMode="inline"
          shortcutId={modeBindingId(modeId, "switch")}
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.modes.activation.title")}>
        <SettingContainer
          grouped
          layout="stacked"
          disabled={!activationSupported}
          title={t("settings.modes.activation.capture.label")}
          description={t("settings.modes.activation.capture.description")}
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
                  variant="secondary"
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
            <StatusText>{unsupportedNote}</StatusText>
          )}
        </SettingContainer>
      </SettingsGroup>

      <SettingsGroup title={t("settings.modes.activation.website.title")}>
        <SettingContainer
          grouped
          disabled={!activationSupported || !websiteCaptureEnabled}
          title={t("settings.modes.activation.website.scope.label")}
          description={t("settings.modes.activation.website.scope.description")}
        >
          <Dropdown
            selectedValue={websiteMatchKind}
            disabled={!activationSupported || !websiteCaptureEnabled}
            options={WEBSITE_HOST_MATCHES.map((matchKind) => ({
              value: matchKind,
              label: t(
                `settings.modes.activation.website.scope.values.${matchKind}`,
              ),
            }))}
            onSelect={(value) => {
              const matchKind = WEBSITE_HOST_MATCHES.find(
                (candidate) => candidate === value,
              );
              if (matchKind) onWebsiteMatchKindChange(matchKind);
            }}
          />
        </SettingContainer>
        <SettingContainer
          grouped
          layout="stacked"
          disabled={!activationSupported || !websiteCaptureEnabled}
          title={t("settings.modes.activation.website.capture.label")}
          description={t(
            "settings.modes.activation.website.capture.description",
          )}
        >
          {!activationSupported ? (
            <StatusText>{unsupportedNote}</StatusText>
          ) : !websiteCaptureEnabled ? (
            <StatusText tone="warning">
              {t("settings.modes.errors.website_activation_consent_required")}
            </StatusText>
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
                  variant="secondary"
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
        </SettingContainer>
      </SettingsGroup>
    </>
  );
};
