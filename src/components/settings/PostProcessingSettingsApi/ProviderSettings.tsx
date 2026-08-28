import React, { useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { SettingContainer } from "../../ui/SettingContainer";
import { ResetButton } from "../../ui/ResetButton";
import { ApiKeyField } from "./ApiKeyField";
import { BaseUrlField } from "./BaseUrlField";
import { ModelSelect } from "./ModelSelect";
import { ProviderSelect } from "./ProviderSelect";
import { usePostProcessProviderState } from "./usePostProcessProviderState";
import { RemoteProviderConsent } from "./RemoteProviderConsent";
import { useSettings } from "../../../hooks/useSettings";

const PostProcessingSettingsApiComponent: React.FC = () => {
  const { t } = useTranslation();
  const state = usePostProcessProviderState();
  const { refreshSettings } = useSettings();
  const [endpointChanged, setEndpointChanged] = useState(false);

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
    <>
      <SettingContainer
        title={t("settings.postProcessing.api.provider.title")}
        description={t("settings.postProcessing.api.provider.description")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped
      >
        <ProviderSelect
          options={state.providerOptions}
          value={state.selectedProviderId}
          onChange={state.handleProviderSelect}
        />
      </SettingContainer>

      {state.isAppleProvider ? (
        state.appleIntelligenceUnavailable ? (
          <Alert variant="error" contained>
            {t("settings.postProcessing.api.appleIntelligence.unavailable")}
          </Alert>
        ) : null
      ) : (
        <>
          {state.selectedProvider?.id === "custom" && (
            <SettingContainer
              title={t("settings.postProcessing.api.baseUrl.title")}
              description={t("settings.postProcessing.api.baseUrl.description")}
              descriptionMode="tooltip"
              layout="horizontal"
              grouped
            >
              <BaseUrlField
                value={state.baseUrl}
                onBlur={handleBaseUrlChange}
                placeholder={t(
                  "settings.postProcessing.api.baseUrl.placeholder",
                )}
                disabled={state.isBaseUrlUpdating}
                className="w-full min-w-0"
              />
            </SettingContainer>
          )}

          <SettingContainer
            title={t("settings.postProcessing.api.apiKey.title")}
            description={t("settings.postProcessing.api.apiKey.description")}
            descriptionMode="tooltip"
            layout="horizontal"
            grouped
          >
            <div className="flex w-full min-w-0 items-center gap-2">
              <ApiKeyField
                onCommit={state.handleSecretCommit}
                placeholder={t(
                  "settings.postProcessing.api.apiKey.placeholder",
                )}
                disabled={state.isSecretUpdating || state.isSecretUnavailable}
                className="min-w-0"
              />
              {state.secretState?.configured ? (
                <Button
                  type="button"
                  variant="danger-ghost"
                  size="sm"
                  onClick={state.handleSecretDelete}
                  disabled={state.isSecretUpdating}
                >
                  {t("common.delete")}
                </Button>
              ) : null}
            </div>
          </SettingContainer>

          {state.secretState?.lastErrorKind ? (
            <Alert variant="error" contained>
              {state.secretState.lastErrorKind}
            </Alert>
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
        <SettingContainer
          title={t("settings.postProcessing.api.model.title")}
          description={
            state.isCustomProvider
              ? t("settings.postProcessing.api.model.descriptionCustom")
              : t("settings.postProcessing.api.model.descriptionDefault")
          }
          descriptionMode="tooltip"
          layout="stacked"
          grouped
        >
          <div className="flex w-full min-w-0 items-center gap-2">
            <ModelSelect
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
              onBlur={() => undefined}
              className="min-w-0 flex-1"
            />
            <ResetButton
              onClick={state.handleRefreshModels}
              disabled={
                state.isFetchingModels ||
                (!state.isCustomProvider && !state.secretState?.configured)
              }
              ariaLabel={t("settings.postProcessing.api.model.refreshModels")}
              className="flex h-9 w-9 items-center justify-center"
            >
              <RefreshCcw
                className={`h-4 w-4 ${state.isFetchingModels ? "animate-spin" : ""}`}
              />
            </ResetButton>
          </div>
        </SettingContainer>
      )}
    </>
  );
};

export const PostProcessingSettingsApi = React.memo(
  PostProcessingSettingsApiComponent,
);
PostProcessingSettingsApi.displayName = "PostProcessingSettingsApi";
