import React, { useEffect, useId, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Notice,
  SettingsField,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { useSettings } from "@/hooks/useSettings";
import { cn } from "@/lib/cn";
import { ApiKeyField } from "./ApiKeyField";
import { BaseUrlField } from "./BaseUrlField";
import { ModelSelect } from "./ModelSelect";
import { ProviderSelect } from "./ProviderSelect";
import { usePostProcessProviderState } from "./usePostProcessProviderState";
import { RemoteProviderConsent } from "./RemoteProviderConsent";

const PostProcessingSettingsApiComponent: React.FC = () => {
  const { t } = useTranslation();
  const state = usePostProcessProviderState();
  const { refreshSettings } = useSettings();
  const [endpointChanged, setEndpointChanged] = useState(false);
  const fieldId = useId();

  useEffect(() => {
    setEndpointChanged(false);
  }, [state.selectedProviderId]);

  const handleBaseUrlChange = (value: string) => {
    if (value.trim() !== state.baseUrl.trim()) {
      setEndpointChanged(true);
    }
    state.handleBaseUrlChange(value);
  };
  return (
    <SettingsSection label={t("settings.postProcessing.api.title")}>
      {/* Every control here is a field rather than a row: a provider name, an
       * endpoint URL, a key and a model id are all long enough that a control
       * sized to a settings column's right half would cut them. */}
      <SettingsField
        label={t("settings.postProcessing.api.provider.title")}
        controlId={`${fieldId}-provider`}
      >
        <ProviderSelect
          id={`${fieldId}-provider`}
          options={state.providerOptions}
          value={state.selectedProviderId}
          onChange={state.handleProviderSelect}
        />
      </SettingsField>

      {state.isAppleProvider ? (
        state.appleIntelligenceUnavailable ? (
          <div className="px-4 py-3">
            <Notice tone="danger">
              {t("settings.postProcessing.api.appleIntelligence.unavailable")}
            </Notice>
          </div>
        ) : null
      ) : (
        <>
          {state.selectedProvider?.id === "custom" && (
            <SettingsField
              label={t("settings.postProcessing.api.baseUrl.title")}
              controlId={`${fieldId}-base-url`}
            >
              <BaseUrlField
                id={`${fieldId}-base-url`}
                value={state.baseUrl}
                onBlur={handleBaseUrlChange}
                placeholder={t(
                  "settings.postProcessing.api.baseUrl.placeholder",
                )}
                disabled={state.isBaseUrlUpdating}
              />
            </SettingsField>
          )}

          <SettingsField
            label={t("settings.postProcessing.api.apiKey.title")}
            controlId={`${fieldId}-api-key`}
          >
            <div className="flex items-center gap-2">
              <ApiKeyField
                id={`${fieldId}-api-key`}
                onCommit={state.handleSecretCommit}
                placeholder={t(
                  "settings.postProcessing.api.apiKey.placeholder",
                )}
                disabled={state.isSecretUpdating || state.isSecretUnavailable}
              />
              {state.secretState?.configured ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-red-900"
                  onClick={state.handleSecretDelete}
                  disabled={state.isSecretUpdating}
                >
                  {t("common.delete")}
                </Button>
              ) : null}
            </div>
          </SettingsField>

          {state.secretState?.lastErrorKind ? (
            <div className="px-4 py-3">
              <Notice tone="danger">{state.secretState.lastErrorKind}</Notice>
            </div>
          ) : null}
        </>
      )}

      {!state.isAppleProvider ? (
        <RemoteProviderConsent
          provider={state.selectedProvider}
          consent={state.remoteConsent}
          endpointChanged={endpointChanged}
          onAccepted={refreshSettings}
        />
      ) : null}

      {!state.isAppleProvider && (
        <SettingsField
          label={t("settings.postProcessing.api.model.title")}
          /* On a named provider the list says everything. On a custom endpoint
           * it is the caller who decides what identifier is valid, which no
           * label or list can convey. */
          hint={
            state.isCustomProvider
              ? t("settings.postProcessing.api.model.descriptionCustom")
              : undefined
          }
          controlId={`${fieldId}-model`}
        >
          <div className="flex items-center gap-2">
            <ModelSelect
              id={`${fieldId}-model`}
              value={state.model}
              options={state.modelOptions}
              disabled={state.isModelUpdating}
              isLoading={state.isFetchingModels}
              placeholder={
                state.modelOptions.length > 0
                  ? t(
                      "settings.postProcessing.api.model.placeholderWithOptions",
                    )
                  : t("settings.postProcessing.api.model.placeholderNoOptions")
              }
              onSelect={state.handleModelSelect}
              onCreate={state.handleModelCreate}
              className="min-w-0 flex-1"
            />
            {/* Icon-only, beside an already-bordered trigger: the one place a
             * ghost button cannot be mistaken for a caption. */}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("settings.postProcessing.api.model.refreshModels")}
              onClick={state.handleRefreshModels}
              disabled={
                state.isFetchingModels ||
                (!state.isCustomProvider && !state.secretState?.configured)
              }
            >
              <RefreshCcw
                aria-hidden="true"
                className={cn(state.isFetchingModels && "animate-spin")}
              />
            </Button>
          </div>
        </SettingsField>
      )}
    </SettingsSection>
  );
};

export const PostProcessingSettingsApi = React.memo(
  PostProcessingSettingsApiComponent,
);
PostProcessingSettingsApi.displayName = "PostProcessingSettingsApi";
