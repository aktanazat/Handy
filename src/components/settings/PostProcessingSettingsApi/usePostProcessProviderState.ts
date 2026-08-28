import { useCallback, useEffect, useMemo, useState } from "react";
import { useSettings } from "../../../hooks/useSettings";
import {
  commands,
  type PostProcessProvider,
  type PostProcessProviderConsent,
  type SecretState,
} from "@/bindings";
import type { ModelOption } from "./types";
import type { DropdownOption } from "../../ui/Dropdown";

type PostProcessProviderState = {
  providerOptions: DropdownOption[];
  selectedProviderId: string;
  selectedProvider: PostProcessProvider | undefined;
  isCustomProvider: boolean;
  isAppleProvider: boolean;
  appleIntelligenceUnavailable: boolean;
  baseUrl: string;
  handleBaseUrlChange: (value: string) => void;
  isBaseUrlUpdating: boolean;
  secretState: SecretState | undefined;
  handleSecretCommit: (value: string) => Promise<boolean>;
  handleSecretDelete: () => void;
  isSecretUpdating: boolean;
  isSecretUnavailable: boolean;
  model: string;
  handleModelChange: (value: string) => void;
  modelOptions: ModelOption[];
  isModelUpdating: boolean;
  isFetchingModels: boolean;
  remoteConsent: PostProcessProviderConsent | undefined;
  handleProviderSelect: (providerId: string) => void;
  handleModelSelect: (value: string) => void;
  handleModelCreate: (value: string) => void;
  handleRefreshModels: () => void;
};

const APPLE_PROVIDER_ID = "apple_intelligence";
const EMPTY_POST_PROCESS_PROVIDERS: PostProcessProvider[] = [];
const EMPTY_POST_PROCESS_MODEL_OPTIONS: string[] = [];

export const usePostProcessProviderState = (): PostProcessProviderState => {
  const {
    settings,
    isUpdating,
    setPostProcessProvider,
    updatePostProcessBaseUrl,
    replacePostProcessSecret,
    removePostProcessSecret,
    refreshPostProcessSecretState,
    updatePostProcessModel,
    fetchPostProcessModels,
    postProcessModelOptions,
  } = useSettings();

  const providers =
    settings?.post_process_providers ?? EMPTY_POST_PROCESS_PROVIDERS;
  const selectedProviderId = useMemo(
    () => settings?.post_process_provider_id || providers[0]?.id || "openai",
    [providers, settings?.post_process_provider_id],
  );
  const selectedProvider = useMemo(
    () =>
      providers.find((provider) => provider.id === selectedProviderId) ||
      providers[0],
    [providers, selectedProviderId],
  );

  const isAppleProvider = selectedProvider?.id === APPLE_PROVIDER_ID;
  const [appleIntelligenceUnavailable, setAppleIntelligenceUnavailable] =
    useState(false);
  const baseUrl = selectedProvider?.base_url ?? "";
  const secretState =
    settings?.post_process_secret_states?.[selectedProviderId];
  const remoteConsent =
    settings?.post_process_provider_consents?.[selectedProviderId];
  const model = settings?.post_process_models?.[selectedProviderId] ?? "";
  useEffect(() => {
    if (!isAppleProvider) {
      void refreshPostProcessSecretState(selectedProviderId);
    }
  }, [isAppleProvider, refreshPostProcessSecretState, selectedProviderId]);

  const providerOptions = useMemo<DropdownOption[]>(
    () =>
      providers.map((provider) => ({
        value: provider.id,
        label: provider.label,
      })),
    [providers],
  );

  const handleProviderSelect = useCallback(
    async (providerId: string) => {
      setAppleIntelligenceUnavailable(false);
      if (providerId === selectedProviderId) {
        return;
      }

      if (providerId === APPLE_PROVIDER_ID) {
        const available = await commands.checkAppleIntelligenceAvailable();
        if (!available) {
          setAppleIntelligenceUnavailable(true);
        }
      }
      await setPostProcessProvider(providerId);
    },
    [selectedProviderId, setPostProcessProvider],
  );

  const handleBaseUrlChange = useCallback(
    (value: string) => {
      if (!selectedProvider || selectedProvider.id !== "custom") {
        return;
      }
      const trimmed = value.trim();
      if (trimmed && trimmed !== baseUrl) {
        void updatePostProcessBaseUrl(selectedProvider.id, trimmed);
      }
    },
    [baseUrl, selectedProvider, updatePostProcessBaseUrl],
  );

  const handleSecretCommit = useCallback(
    (value: string) => replacePostProcessSecret(selectedProviderId, value),
    [replacePostProcessSecret, selectedProviderId],
  );

  const handleSecretDelete = useCallback(() => {
    void removePostProcessSecret(selectedProviderId);
  }, [removePostProcessSecret, selectedProviderId]);

  const handleModelChange = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed !== model) {
        void updatePostProcessModel(selectedProviderId, trimmed);
      }
    },
    [model, selectedProviderId, updatePostProcessModel],
  );

  const handleModelSelect = useCallback(
    (value: string) => {
      void updatePostProcessModel(selectedProviderId, value.trim());
    },
    [selectedProviderId, updatePostProcessModel],
  );

  const handleModelCreate = useCallback(
    (value: string) => {
      void updatePostProcessModel(selectedProviderId, value);
    },
    [selectedProviderId, updatePostProcessModel],
  );

  const handleRefreshModels = useCallback(() => {
    if (isAppleProvider) {
      return;
    }
    void (async () => {
      await refreshPostProcessSecretState(selectedProviderId);
      await fetchPostProcessModels(selectedProviderId);
    })();
  }, [
    fetchPostProcessModels,
    isAppleProvider,
    refreshPostProcessSecretState,
    selectedProviderId,
  ]);

  const availableModelsRaw =
    postProcessModelOptions[selectedProviderId] ??
    EMPTY_POST_PROCESS_MODEL_OPTIONS;
  const modelOptions = useMemo<ModelOption[]>(() => {
    const seen = new Set<string>();
    const options: ModelOption[] = [];
    const upsert = (value: string | null | undefined) => {
      const trimmed = value?.trim();
      if (!trimmed || seen.has(trimmed)) {
        return;
      }
      seen.add(trimmed);
      options.push({ value: trimmed, label: trimmed });
    };

    for (const candidate of availableModelsRaw) {
      upsert(candidate);
    }
    upsert(model);
    return options;
  }, [availableModelsRaw, model]);

  const isBaseUrlUpdating = isUpdating(
    `post_process_base_url:${selectedProviderId}`,
  );
  const isSecretUpdating = isUpdating(
    `post_process_secret:${selectedProviderId}`,
  );
  const isModelUpdating = isUpdating(
    `post_process_model:${selectedProviderId}`,
  );
  const isFetchingModels = isUpdating(
    `post_process_models_fetch:${selectedProviderId}`,
  );
  const isSecretUnavailable = secretState?.lastErrorKind === "unavailable";

  return {
    providerOptions,
    selectedProviderId,
    selectedProvider,
    isCustomProvider: selectedProvider?.id === "custom",
    isAppleProvider,
    appleIntelligenceUnavailable,
    baseUrl,
    handleBaseUrlChange,
    isBaseUrlUpdating,
    secretState,
    handleSecretCommit,
    handleSecretDelete,
    isSecretUpdating,
    isSecretUnavailable,
    model,
    handleModelChange,
    modelOptions,
    isModelUpdating,
    isFetchingModels,
    remoteConsent,
    handleProviderSelect,
    handleModelSelect,
    handleModelCreate,
    handleRefreshModels,
  };
};
