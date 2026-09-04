import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
  PostProcessModelCatalog,
  PostProcessModelOption,
} from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { postProcessModelCatalogScope } from "@/stores/settingsStore";
import type { ModelOption, ModelOptionSource } from "./types";

export type PostProcessModelCatalogView = {
  allowsManualModelId: boolean;
  discover: () => Promise<void>;
  discoverIfNeeded: () => Promise<void>;
  isLoading: boolean;
  modelOptions: ModelOption[];
  statusKeys: string[];
};

type CatalogEntry = {
  catalog: PostProcessModelCatalog;
  cachedModels: PostProcessModelOption[];
};

type UsePostProcessModelCatalogOptions = {
  autoDiscover?: boolean;
  autoDiscoveryKey?: string;
  baseUrl: string;
  enabled?: boolean;
  providerId: string;
  savedModelId: string;
};

const DISCOVERY_STATUS_KEYS = {
  requires_consent: "settings.postProcessing.api.model.status.requiresConsent",
  missing_credential:
    "settings.postProcessing.api.model.status.requiresCredential",
  credential_unavailable:
    "settings.postProcessing.api.model.status.credentialUnavailable",
  credential_locked:
    "settings.postProcessing.api.model.status.credentialLocked",
  credential_corrupt:
    "settings.postProcessing.api.model.status.credentialUnavailable",
  credential_busy:
    "settings.postProcessing.api.model.status.credentialUnavailable",
  invalid_destination:
    "settings.postProcessing.remoteConsent.invalidDestination",
  unsupported: "settings.postProcessing.api.model.status.unsupported",
  unauthorized: "settings.postProcessing.api.model.status.unauthorized",
  forbidden: "settings.postProcessing.api.model.status.forbidden",
  rate_limited: "settings.postProcessing.api.model.status.rateLimited",
  unreachable: "settings.postProcessing.api.model.status.unreachable",
  invalid_response: "settings.postProcessing.api.model.status.invalidResponse",
} as const satisfies Record<
  Exclude<PostProcessModelCatalog["discovery"], "ready">,
  string
>;

const addOption = (
  target: Map<string, ModelOption>,
  id: string,
  source: ModelOptionSource,
): void => {
  const trimmed = id.trim();
  if (!trimmed || target.has(trimmed)) return;
  target.set(trimmed, { id: trimmed, label: trimmed, source });
};

/**
 * The provider result is transient. A saved selection belongs to settings, so
 * merge it at the last possible point rather than letting a failed refresh
 * rewrite it.
 */
export const modelOptionsForCatalog = (
  entry: CatalogEntry | undefined,
  savedModelId: string,
): ModelOption[] => {
  const options = new Map<string, ModelOption>();
  const catalog = entry?.catalog;

  if (catalog?.discovery === "ready") {
    for (const option of catalog.models) {
      addOption(options, option.id, "provider");
    }
  } else {
    for (const option of entry?.cachedModels ?? []) {
      addOption(options, option.id, "cached");
    }
  }

  const saved = savedModelId.trim();
  if (saved && (catalog?.discovery !== "ready" || !options.has(saved))) {
    options.set(saved, { id: saved, label: saved, source: "saved" });
  }

  return [...options.values()];
};

const statusKeysForCatalog = (
  entry: CatalogEntry | undefined,
  savedModelId: string,
  isLoading: boolean,
): string[] => {
  if (isLoading) return ["settings.postProcessing.api.model.status.loading"];

  const catalog = entry?.catalog;
  if (!catalog) return [];

  /* A finished load is not news. The notice beside the field is for the cases
   * that need an answer, and `savedNotInLatest` below is the one ready-state
   * fact worth stating. */
  const keys: string[] =
    catalog.discovery === "ready"
      ? []
      : [DISCOVERY_STATUS_KEYS[catalog.discovery]];
  const saved = savedModelId.trim();
  if (
    catalog.discovery === "ready" &&
    saved &&
    !catalog.models.some((option) => option.id === saved)
  ) {
    keys.push("settings.postProcessing.api.model.status.savedNotInLatest");
  } else if (catalog.discovery !== "ready" && entry?.cachedModels.length) {
    keys.push("settings.postProcessing.api.model.status.cachedFallback");
  }
  return keys;
};

/** One provider/configuration result, shared by global and explicit mode UI. */
export const usePostProcessModelCatalog = ({
  autoDiscover = false,
  autoDiscoveryKey = "",
  baseUrl,
  enabled = true,
  providerId,
  savedModelId,
}: UsePostProcessModelCatalogOptions): PostProcessModelCatalogView => {
  const {
    discoverPostProcessModelCatalog,
    isUpdating,
    postProcessModelCatalogs,
  } = useSettings();
  const scope = postProcessModelCatalogScope(providerId, baseUrl);
  const entry = postProcessModelCatalogs[scope];
  const isLoading = isUpdating(`post_process_model_catalog:${scope}`);
  const automaticRequest = useRef<string | null>(null);

  const discover = useCallback(async () => {
    if (!enabled) return;
    await discoverPostProcessModelCatalog(providerId);
  }, [discoverPostProcessModelCatalog, enabled, providerId]);
  const discoverIfNeeded = useCallback(async () => {
    if (entry || isLoading) return;
    await discover();
  }, [discover, entry, isLoading]);

  const automaticSignature =
    autoDiscover && enabled ? `${scope}\u0000${autoDiscoveryKey}` : null;
  useEffect(() => {
    if (
      !automaticSignature ||
      isLoading ||
      automaticRequest.current === automaticSignature
    ) {
      return;
    }
    automaticRequest.current = automaticSignature;
    void discover();
  }, [automaticSignature, discover, isLoading]);

  const modelOptions = useMemo(
    () => modelOptionsForCatalog(entry, savedModelId),
    [entry, savedModelId],
  );
  const statusKeys = useMemo(
    () => statusKeysForCatalog(entry, savedModelId, isLoading),
    [entry, isLoading, savedModelId],
  );

  return {
    /* Every provider except Apple Intelligence accepts an id it did not list,
     * and the Apple branch never renders this control, so an unknown catalog
     * must not be the one state that removes manual entry. */
    allowsManualModelId: entry?.catalog.allows_manual_model_id ?? true,
    discover,
    discoverIfNeeded,
    isLoading,
    modelOptions,
    statusKeys,
  };
};
