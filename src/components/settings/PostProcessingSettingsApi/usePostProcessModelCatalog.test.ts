import { describe, expect, test } from "bun:test";
import type {
  PostProcessModelCatalog,
  PostProcessModelOption,
} from "@/bindings";
import { modelOptionsForCatalog } from "./usePostProcessModelCatalog";

const option = (id: string): PostProcessModelOption => ({
  id,
  provenance: "provider_reported",
});

const catalog = (
  overrides: Partial<PostProcessModelCatalog> = {},
): PostProcessModelCatalog => ({
  provider_id: "openai",
  models: [],
  discovery: "ready",
  allows_manual_model_id: true,
  ...overrides,
});

describe("post-processing model options", () => {
  test("keeps a saved model visible when the latest ready list no longer has it", () => {
    expect(
      modelOptionsForCatalog(
        {
          catalog: catalog({ models: [option("gpt-4.1")] }),
          cachedModels: [],
        },
        "legacy-model",
      ),
    ).toEqual([
      { id: "gpt-4.1", label: "gpt-4.1", source: "provider" },
      { id: "legacy-model", label: "legacy-model", source: "saved" },
    ]);
  });

  test("keeps a same-configuration cache and saved selection after discovery fails", () => {
    expect(
      modelOptionsForCatalog(
        {
          catalog: catalog({ discovery: "unreachable" }),
          cachedModels: [option("gpt-4.1")],
        },
        "manual-model",
      ),
    ).toEqual([
      { id: "gpt-4.1", label: "gpt-4.1", source: "cached" },
      { id: "manual-model", label: "manual-model", source: "saved" },
    ]);
  });

  test("lists a saved id the provider still reports once, as the provider's", () => {
    expect(
      modelOptionsForCatalog(
        {
          catalog: catalog({
            models: [option("gpt-4.1"), option("pinned-model")],
          }),
          cachedModels: [],
        },
        "pinned-model",
      ),
    ).toEqual([
      { id: "gpt-4.1", label: "gpt-4.1", source: "provider" },
      { id: "pinned-model", label: "pinned-model", source: "provider" },
    ]);
  });
});
