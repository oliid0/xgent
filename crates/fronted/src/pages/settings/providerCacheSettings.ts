import type { PromptCacheHintMode } from "../../lib/settings";

export const PROVIDER_CACHE_HINT_OPTIONS: { value: PromptCacheHintMode; labelKey: string }[] = [
  { value: "auto", labelKey: "settings.promptCacheHintMode.auto" },
  { value: "openai-key", labelKey: "settings.promptCacheHintMode.openaiKey" },
  { value: "openrouter-session", labelKey: "settings.promptCacheHintMode.openrouterSession" },
  { value: "none", labelKey: "settings.promptCacheHintMode.none" },
];
