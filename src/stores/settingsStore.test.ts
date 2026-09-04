import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
  AppSettings,
  PostProcessModelCatalog,
  PostProcessModelOption,
  SecretState,
} from "@/bindings";
import {
  postProcessModelCatalogScope,
  useSettingsStore,
} from "./settingsStore";

type HostArgs = Record<string, string>;
type CatalogResponse =
  | PostProcessModelCatalog
  | Promise<PostProcessModelCatalog>;
type HostReply =
  | AppSettings
  | CatalogResponse
  | SecretState
  | { start: boolean; stop: boolean }
  | number
  | null;

const READY_OPTIONS: PostProcessModelOption[] = [
  { id: "gpt-4o-mini", provenance: "provider_reported" },
];
const SECRET_STATE: SecretState = {
  configured: true,
  lastErrorKind: null,
  lastVerifiedAt: null,
};

const settingsFor = (providerId = "openai"): AppSettings => ({
  post_process_provider_id: providerId,
  post_process_models: { [providerId]: "saved-model" },
  post_process_providers: [
    {
      id: "openai",
      label: "OpenAI",
      base_url: "https://api.openai.com/v1",
    },
    {
      id: "custom",
      label: "Custom",
      base_url: "http://localhost:11434/v1",
      allow_base_url_edit: true,
    },
  ],
  post_process_secret_states: {
    openai: { configured: false, lastErrorKind: null, lastVerifiedAt: null },
    custom: { configured: false, lastErrorKind: null, lastVerifiedAt: null },
  },
});

const catalog = (
  providerId: string,
  overrides: Partial<PostProcessModelCatalog> = {},
): PostProcessModelCatalog => ({
  provider_id: providerId,
  models: READY_OPTIONS,
  discovery: "ready",
  allows_manual_model_id: true,
  ...overrides,
});

let settings = settingsFor();
let catalogResponse: () => CatalogResponse = () => catalog("openai");
let asked: string[] = [];
const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

const answer = (command: string, args: HostArgs): HostReply => {
  asked.push(command);
  switch (command) {
    case "get_app_settings":
    case "get_default_settings":
      return settings;
    case "check_custom_sounds":
      return { start: false, stop: false };
    case "plugin:event|listen":
      return 1;
    case "discover_post_process_model_catalog":
      return catalogResponse();
    case "set_provider_secret":
    case "delete_provider_secret":
      return SECRET_STATE;
    case "change_post_process_base_url_setting": {
      const { providerId, baseUrl } = args;
      settings = {
        ...settings,
        post_process_providers: settings.post_process_providers?.map(
          (provider) =>
            provider.id === providerId
              ? { ...provider, base_url: baseUrl }
              : provider,
        ),
      };
      return null;
    }
    case "change_post_process_model_setting":
      return null;
    default:
      throw new Error(`unexpected command: ${command}`);
  }
};

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      ...globalThis.window,
      __TAURI_INTERNALS__: {
        invoke: (command: string, args: HostArgs = {}) =>
          Promise.resolve(answer(command, args)),
        transformCallback: <Callback>(callback: Callback) => callback,
      },
    },
  });
});

afterAll(() => {
  if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const reset = (providerId = "openai") => {
  asked = [];
  settings = settingsFor(providerId);
  catalogResponse = () => catalog(providerId);
  useSettingsStore.setState({
    settings,
    defaultSettings: settings,
    isLoading: false,
    isUpdating: {},
    postProcessModelCatalogs: {},
  });
};

describe("post-processing model catalog state", () => {
  test("initialization never discovers a remote model catalog", async () => {
    await useSettingsStore.getState().initialize();

    expect(asked).not.toContain("discover_post_process_model_catalog");
  });

  test("keeps a typed ready response under its provider and endpoint", async () => {
    reset();
    const scope = postProcessModelCatalogScope(
      "openai",
      "https://api.openai.com/v1",
    );

    await useSettingsStore.getState().discoverPostProcessModelCatalog("openai");

    expect(useSettingsStore.getState().postProcessModelCatalogs[scope]).toEqual(
      {
        catalog: catalog("openai"),
        cachedModels: READY_OPTIONS,
      },
    );
  });

  test("keeps the requested provider when a typed catalog names another provider", async () => {
    reset();
    catalogResponse = () => catalog("custom");

    await useSettingsStore.getState().discoverPostProcessModelCatalog("openai");

    const scope = postProcessModelCatalogScope(
      "openai",
      "https://api.openai.com/v1",
    );
    expect(useSettingsStore.getState().postProcessModelCatalogs[scope]).toEqual(
      {
        catalog: {
          provider_id: "openai",
          models: [],
          discovery: "invalid_response",
          allows_manual_model_id: true,
        },
        cachedModels: [],
      },
    );
  });

  test("keeps manual entry open when the first discovery cannot be reached", async () => {
    reset();
    catalogResponse = () => {
      throw new Error("offline");
    };

    const result = await useSettingsStore
      .getState()
      .discoverPostProcessModelCatalog("openai");

    expect(result).toEqual({
      provider_id: "openai",
      models: [],
      discovery: "unreachable",
      allows_manual_model_id: true,
    });
  });

  test("stores a non-ready catalog exactly as the backend returned it", async () => {
    reset();
    catalogResponse = () =>
      catalog("openai", {
        discovery: "missing_credential",
        models: [{ id: "listed-model", provenance: "provider_reported" }],
      });

    await useSettingsStore.getState().discoverPostProcessModelCatalog("openai");

    const scope = postProcessModelCatalogScope(
      "openai",
      "https://api.openai.com/v1",
    );
    expect(
      useSettingsStore.getState().postProcessModelCatalogs[scope]?.catalog,
    ).toEqual(
      catalog("openai", {
        discovery: "missing_credential",
        models: [{ id: "listed-model", provenance: "provider_reported" }],
      }),
    );
  });

  test("keeps the same-config ready list as cached after a failed refresh", async () => {
    reset();
    await useSettingsStore.getState().discoverPostProcessModelCatalog("openai");
    catalogResponse = () => {
      throw new Error("offline");
    };

    await useSettingsStore.getState().discoverPostProcessModelCatalog("openai");

    const scope = postProcessModelCatalogScope(
      "openai",
      "https://api.openai.com/v1",
    );
    const state = useSettingsStore.getState().postProcessModelCatalogs[scope];
    expect(state?.catalog.discovery).toBe("unreachable");
    expect(state?.cachedModels).toEqual(READY_OPTIONS);
  });

  test("does not write a catalog that returned after invalidation", async () => {
    reset();
    let resolveCatalog: (value: PostProcessModelCatalog) => void = () => {
      throw new Error("catalog request did not start");
    };
    catalogResponse = () =>
      new Promise<PostProcessModelCatalog>((resolve) => {
        resolveCatalog = resolve;
      });

    const discovery = useSettingsStore
      .getState()
      .discoverPostProcessModelCatalog("openai");
    useSettingsStore.getState().invalidatePostProcessModelCatalog("openai");
    resolveCatalog(catalog("openai"));
    await discovery;

    expect(useSettingsStore.getState().postProcessModelCatalogs).toEqual({});
  });

  test("does not let an older failure replace a newer catalog", async () => {
    reset();
    let rejectCatalog: (error: Error) => void = () => {
      throw new Error("catalog request did not start");
    };
    catalogResponse = () =>
      new Promise<PostProcessModelCatalog>((_resolve, reject) => {
        rejectCatalog = reject;
      });

    const olderDiscovery = useSettingsStore
      .getState()
      .discoverPostProcessModelCatalog("openai");
    const newerCatalog = catalog("openai", {
      models: [{ id: "gpt-4.1-mini", provenance: "provider_reported" }],
    });
    catalogResponse = () => newerCatalog;
    await useSettingsStore.getState().discoverPostProcessModelCatalog("openai");
    rejectCatalog(new Error("offline"));
    await olderDiscovery;

    const scope = postProcessModelCatalogScope(
      "openai",
      "https://api.openai.com/v1",
    );
    expect(useSettingsStore.getState().postProcessModelCatalogs[scope]).toEqual(
      {
        catalog: newerCatalog,
        cachedModels: newerCatalog.models,
      },
    );
  });
  test("invalidates a provider catalog when its credential changes", async () => {
    reset();
    await useSettingsStore.getState().discoverPostProcessModelCatalog("openai");

    await useSettingsStore.getState().replacePostProcessSecret("openai", "key");

    expect(
      Object.keys(useSettingsStore.getState().postProcessModelCatalogs),
    ).not.toContain(
      postProcessModelCatalogScope("openai", "https://api.openai.com/v1"),
    );
  });

  test("invalidates every custom-endpoint catalog when its base URL changes", async () => {
    reset("custom");
    await useSettingsStore.getState().discoverPostProcessModelCatalog("custom");

    await useSettingsStore
      .getState()
      .updatePostProcessBaseUrl("custom", "http://localhost:11435/v1");

    expect(
      Object.keys(useSettingsStore.getState().postProcessModelCatalogs).some(
        (scope) => scope.startsWith("custom\u0000"),
      ),
    ).toBe(false);
  });
});
