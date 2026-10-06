import type { ProviderId, ProviderModelConfig } from "../settings";

export type ModelInputMode = "auto" | "text" | "text-image";
export const MODEL_INPUT_OPTIONS = [
  { value: "auto", labelKey: "settings.modelInput.auto" },
  { value: "text", labelKey: "settings.modelInput.text" },
  { value: "text-image", labelKey: "settings.modelInput.textImage" },
] as const;

// These request adapters accept both text-only and image-capable custom models.
// DeepSeek's current shared adapter rejects image blocks; do not offer a false capability.
export function supportsModelInputOverride(provider: ProviderId): boolean {
  return provider !== "deepseek";
}

export function normalizeModelInput(input: unknown): ("text" | "image")[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const values = input.filter((value) => value === "text" || value === "image");
  if (!values.includes("text")) return undefined;
  return values.includes("image") ? ["text", "image"] : ["text"];
}

export function modelInputMode(model: ProviderModelConfig): ModelInputMode {
  return model.inputModalities
    ? model.inputModalities.includes("image")
      ? "text-image"
      : "text"
    : "auto";
}

export function withModelInputMode(
  model: ProviderModelConfig,
  mode: ModelInputMode,
): ProviderModelConfig {
  return {
    ...model,
    inputModalities:
      mode === "auto" ? undefined : mode === "text-image" ? ["text", "image"] : ["text"],
  };
}
