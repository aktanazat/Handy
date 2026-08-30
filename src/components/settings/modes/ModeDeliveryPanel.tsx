import React from "react";
import { useTranslation } from "react-i18next";
import {
  Notice,
  SettingsField,
  SettingsRow,
  SettingsSurface,
} from "@/components/settings/rows";
import { Input } from "@/components/vg/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { Switch } from "@/components/vg/switch";
import {
  AUTO_SUBMIT_KEYS,
  CLIPBOARD_HANDLING,
  PASTE_METHODS,
  TYPING_TOOLS,
  type ModePanelProps,
} from "./modeModel";

/* The Delivery tab: one surface, no section label — the selected tab already
 * reads "Delivery", so a heading here would print the word twice.
 *
 * Each row states its setting once. The sentences this panel used to print
 * under every title repeated the title; the two that carried something the
 * label and the control cannot show — the delay unit, and what "reliable"
 * actually does — survive as hints. */

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
    <SettingsSurface>
      <SettingsRow
        label={t("settings.modes.delivery.method.label")}
        controlId="mode-paste-method"
      >
        <Select
          value={mode.delivery.paste_method}
          onValueChange={(method) => {
            const next = PASTE_METHODS.find(
              (candidate) => candidate === method,
            );
            if (next) updateDelivery("paste_method", next);
          }}
        >
          <SelectTrigger id="mode-paste-method" className="min-w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PASTE_METHODS.map((method) => (
              <SelectItem key={method} value={method}>
                {t(`settings.modes.delivery.method.values.${method}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      {mode.delivery.paste_method === "external_script" ? (
        <SettingsField
          label={t("settings.modes.delivery.script.label")}
          controlId="mode-external-script"
        >
          <Input
            id="mode-external-script"
            value={mode.delivery.external_script_path ?? ""}
            onChange={(event) =>
              updateDelivery("external_script_path", event.target.value || null)
            }
          />
        </SettingsField>
      ) : null}

      <SettingsRow
        label={t("settings.modes.delivery.clipboard.label")}
        controlId="mode-clipboard-handling"
      >
        <Select
          value={mode.delivery.clipboard_handling}
          onValueChange={(handling) => {
            const next = CLIPBOARD_HANDLING.find(
              (candidate) => candidate === handling,
            );
            if (next) updateDelivery("clipboard_handling", next);
          }}
        >
          <SelectTrigger id="mode-clipboard-handling" className="min-w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLIPBOARD_HANDLING.map((handling) => (
              <SelectItem key={handling} value={handling}>
                {t(`settings.modes.delivery.clipboard.values.${handling}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        label={t("settings.modes.delivery.autoSubmit.label")}
        controlId="mode-auto-submit"
      >
        <Switch
          id="mode-auto-submit"
          checked={mode.delivery.auto_submit}
          onCheckedChange={(enabled) => updateDelivery("auto_submit", enabled)}
        />
      </SettingsRow>

      <SettingsRow
        label={t("settings.modes.delivery.autoSubmitKey.label")}
        controlId="mode-auto-submit-key"
        disabled={!mode.delivery.auto_submit}
      >
        <div className="flex flex-col items-end gap-1">
          <Select
            value={mode.delivery.auto_submit_key}
            disabled={!mode.delivery.auto_submit}
            onValueChange={(key) => {
              const next = AUTO_SUBMIT_KEYS.find(
                (candidate) => candidate === key,
              );
              if (next) updateDelivery("auto_submit_key", next);
            }}
          >
            <SelectTrigger id="mode-auto-submit-key" className="min-w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTO_SUBMIT_KEYS.map((key) => (
                <SelectItem key={key} value={key}>
                  {t(`settings.modes.delivery.autoSubmitKey.values.${key}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {mode.delivery.auto_submit ? null : (
            <Notice live={false}>
              {t(
                "settings.modes.delivery.autoSubmitKey.requiresAutoSubmit",
                "Turn on auto-submit to choose a key.",
              )}
            </Notice>
          )}
        </div>
      </SettingsRow>

      <SettingsRow
        label={t("settings.modes.delivery.trailingSpace.label")}
        controlId="mode-trailing-space"
      >
        <Switch
          id="mode-trailing-space"
          checked={mode.delivery.append_trailing_space}
          onCheckedChange={(enabled) =>
            updateDelivery("append_trailing_space", enabled)
          }
        />
      </SettingsRow>

      <SettingsRow
        label={t("settings.modes.delivery.reliablePaste.label")}
        hint={t("settings.modes.delivery.reliablePaste.description")}
        controlId="mode-reliable-paste"
      >
        <Switch
          id="mode-reliable-paste"
          checked={mode.delivery.reliable_paste}
          onCheckedChange={(enabled) =>
            updateDelivery("reliable_paste", enabled)
          }
        />
      </SettingsRow>

      {/* Two numbers, so the label sits over them rather than beside them. The
       * unit is the one thing the field cannot show, which is why this row
       * keeps its sentence. */}
      <SettingsField
        label={t("settings.modes.delivery.delay.label")}
        hint={t("settings.modes.delivery.delay.description")}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="min-w-0 text-[13px] text-gray-800">
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
            />
          </label>
          <label className="min-w-0 text-[13px] text-gray-800">
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
            />
          </label>
        </div>
      </SettingsField>

      <SettingsRow
        label={t("settings.modes.delivery.typingTool.label")}
        controlId="mode-typing-tool"
        disabled={!typingToolAvailable}
      >
        <div className="flex flex-col items-end gap-1">
          <Select
            value={mode.delivery.typing_tool}
            disabled={!typingToolAvailable}
            onValueChange={(tool) => {
              const next = TYPING_TOOLS.find((candidate) => candidate === tool);
              if (next) updateDelivery("typing_tool", next);
            }}
          >
            <SelectTrigger id="mode-typing-tool" className="min-w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPING_TOOLS.map((tool) => (
                <SelectItem key={tool} value={tool}>
                  {t(`settings.modes.delivery.typingTool.values.${tool}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {typingToolAvailable ? null : (
            <Notice live={false}>
              {t(
                "settings.modes.delivery.typingTool.requiresDirect",
                "Choose Type directly as the delivery method to pick a tool.",
              )}
            </Notice>
          )}
        </div>
      </SettingsRow>
    </SettingsSurface>
  );
};
