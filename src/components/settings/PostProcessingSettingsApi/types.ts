export type ModelOptionSource = "provider" | "cached" | "saved" | "manual";

export type ModelOption = {
  id: string;
  label: string;
  source: ModelOptionSource;
};

/** One provider this block can be pointed at: the id stored, the name shown. */
export type ProviderOption = {
  value: string;
  label: string;
};
