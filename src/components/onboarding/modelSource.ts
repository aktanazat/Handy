import type { ModelInfo } from "@/bindings";

// Legacy = a blob (Url-sourced) .bin/ONNX model, kept runnable but no longer the
// advertised download (catalog GGUFs supersede it).
export const isLegacySource = (model: ModelInfo): boolean => {
  if (model.source === "Local") return false;
  return "Url" in model.source;
};
