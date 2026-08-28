import React from "react";
import { useTranslation } from "react-i18next";
import {
  Dropdown,
  Input,
  SettingContainer,
  SettingsGroup,
  StatusText,
  ToggleSwitch,
} from "@/components/ui";
import {
  AUTO_SUBMIT_KEYS,
  CLIPBOARD_HANDLING,
  PASTE_METHODS,
  TYPING_TOOLS,
  type ModePanelProps,
} from "./modeModel";

export const ModeDeliveryPanel: React.FC<ModePanelProps> = ({
  mode,
  updaters,
}) => {
  const { t } = useTranslation();
  const { updateDelivery } = updaters;
  const typingToolAvailable = mode.delivery.paste_method === "direct";

  const updateDelay = (
    key: "paste_delay_ms" | "paste_delay_after_ms",
    value: string,
  ) => {
    const next = Number.parseInt(value, 10);
    if (Number.isFinite(next) && next >= 0) {
      updateDelivery(key, next);
    }
  };

  return (
    <SettingsGroup title={t("settings.modes.delivery.title")}>
      <SettingContainer
        grouped
        title={t("settings.modes.delivery.method.label")}
        description={t("settings.modes.delivery.method.description")}
      >
        <Dropdown
          selectedValue={mode.delivery.paste_method}
          options={PASTE_METHODS.map((method) => ({
            value: method,
            label: t(`settings.modes.delivery.method.values.${method}`),
          }))}
          onSelect={(method) => {
            const next = PASTE_METHODS.find(
              (candidate) => candidate === method,
            );
            if (next) updateDelivery("paste_method", next);
          }}
        />
      </SettingContainer>

      {mode.delivery.paste_method === "external_script" ? (
        <SettingContainer
          grouped
          layout="stacked"
          title={t("settings.modes.delivery.script.label")}
          description={t("settings.modes.delivery.script.description")}
          controlId="mode-external-script"
        >
          <Input
            id="mode-external-script"
            value={mode.delivery.external_script_path ?? ""}
            onChange={(event) =>
              updateDelivery("external_script_path", event.target.value || null)
            }
            className="w-full"
          />
        </SettingContainer>
      ) : null}

      <SettingContainer
        grouped
        title={t("settings.modes.delivery.clipboard.label")}
        description={t("settings.modes.delivery.clipboard.description")}
      >
        <Dropdown
          selectedValue={mode.delivery.clipboard_handling}
          options={CLIPBOARD_HANDLING.map((handling) => ({
            value: handling,
            label: t(`settings.modes.delivery.clipboard.values.${handling}`),
          }))}
          onSelect={(handling) => {
            const next = CLIPBOARD_HANDLING.find(
              (candidate) => candidate === handling,
            );
            if (next) updateDelivery("clipboard_handling", next);
          }}
        />
      </SettingContainer>

      <ToggleSwitch
        grouped
        checked={mode.delivery.auto_submit}
        onChange={(enabled) => updateDelivery("auto_submit", enabled)}
        label={t("settings.modes.delivery.autoSubmit.label")}
        description={t("settings.modes.delivery.autoSubmit.description")}
      />

      <SettingContainer
        grouped
        disabled={!mode.delivery.auto_submit}
        title={t("settings.modes.delivery.autoSubmitKey.label")}
        description={t("settings.modes.delivery.autoSubmitKey.description")}
      >
        <div className="flex flex-col items-end gap-1">
          <Dropdown
            selectedValue={mode.delivery.auto_submit_key}
            options={AUTO_SUBMIT_KEYS.map((key) => ({
              value: key,
              label: t(`settings.modes.delivery.autoSubmitKey.values.${key}`),
            }))}
            onSelect={(key) => {
              const next = AUTO_SUBMIT_KEYS.find(
                (candidate) => candidate === key,
              );
              if (next) updateDelivery("auto_submit_key", next);
            }}
            disabled={!mode.delivery.auto_submit}
          />
          {mode.delivery.auto_submit ? null : (
            <StatusText>
              {t(
                "settings.modes.delivery.autoSubmitKey.requiresAutoSubmit",
                "Turn on auto-submit to choose a key.",
              )}
            </StatusText>
          )}
        </div>
      </SettingContainer>

      <ToggleSwitch
        grouped
        checked={mode.delivery.append_trailing_space}
        onChange={(enabled) => updateDelivery("append_trailing_space", enabled)}
        label={t("settings.modes.delivery.trailingSpace.label")}
        description={t("settings.modes.delivery.trailingSpace.description")}
      />
      <ToggleSwitch
        grouped
        checked={mode.delivery.reliable_paste}
        onChange={(enabled) => updateDelivery("reliable_paste", enabled)}
        label={t("settings.modes.delivery.reliablePaste.label")}
        description={t("settings.modes.delivery.reliablePaste.description")}
      />

      <SettingContainer
        grouped
        layout="stacked"
        title={t("settings.modes.delivery.delay.label")}
        description={t("settings.modes.delivery.delay.description")}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="min-w-0 text-xs text-text-secondary">
            <span className="mb-1 block">
              {t("settings.modes.delivery.delay.before")}
            </span>
            <Input
              type="number"
              min="0"
              value={mode.delivery.paste_delay_ms}
              onChange={(event) =>
                updateDelay("paste_delay_ms", event.target.value)
              }
              className="w-full"
            />
          </label>
          <label className="min-w-0 text-xs text-text-secondary">
            <span className="mb-1 block">
              {t("settings.modes.delivery.delay.after")}
            </span>
            <Input
              type="number"
              min="0"
              value={mode.delivery.paste_delay_after_ms}
              onChange={(event) =>
                updateDelay("paste_delay_after_ms", event.target.value)
              }
              className="w-full"
            />
          </label>
        </div>
      </SettingContainer>

      <SettingContainer
        grouped
        disabled={!typingToolAvailable}
        title={t("settings.modes.delivery.typingTool.label")}
        description={t("settings.modes.delivery.typingTool.description")}
      >
        <div className="flex flex-col items-end gap-1">
          <Dropdown
            selectedValue={mode.delivery.typing_tool}
            options={TYPING_TOOLS.map((tool) => ({
              value: tool,
              label: t(`settings.modes.delivery.typingTool.values.${tool}`),
            }))}
            onSelect={(tool) => {
              const next = TYPING_TOOLS.find((candidate) => candidate === tool);
              if (next) updateDelivery("typing_tool", next);
            }}
            disabled={!typingToolAvailable}
          />
          {typingToolAvailable ? null : (
            <StatusText>
              {t(
                "settings.modes.delivery.typingTool.requiresDirect",
                "Choose Type directly as the delivery method to pick a tool.",
              )}
            </StatusText>
          )}
        </div>
      </SettingContainer>
    </SettingsGroup>
  );
};
