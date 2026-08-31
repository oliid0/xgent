import {
  type ChatRuntimeControls,
  type CustomProvider,
  findProviderModelConfig,
  getChatRuntimeReasoningLevelsForProvider,
  normalizeChatRuntimeControlsForProvider,
} from "../../settings";
import type { ProviderRuntimeConfig } from "./types";

export function createProviderRuntimeConfig(
  provider: CustomProvider,
  model: string,
  controlsInput: ChatRuntimeControls | undefined,
): ProviderRuntimeConfig {
  const modelConfig = findProviderModelConfig(provider, model);
  const reasoningParams = {
    providerId: provider.type,
    requestFormat: provider.requestFormat,
    modelId: model,
    baseUrl: provider.baseUrl,
    modelConfig,
  };
  const controls = normalizeChatRuntimeControlsForProvider(controlsInput, reasoningParams);
  const reasoningSupported = getChatRuntimeReasoningLevelsForProvider(reasoningParams).length > 0;
  return {
    providerConfigId: provider.id,
    baseUrl: provider.baseUrl,
    isFullUrl: provider.isFullUrl,
    apiKey: provider.apiKey,
    authMode: provider.authMode,
    oauthAccountId: provider.oauthAccountId,
    customHeaders: provider.customHeaders,
    requestFormat: provider.requestFormat,
    reasoning: reasoningSupported
      ? controls.thinkingEnabled
        ? controls.reasoning
        : "off"
      : undefined,
    promptCachingEnabled: provider.promptCachingEnabled,
    promptCacheHintMode:
      provider.type === "codex" && provider.promptCachingEnabled === false
        ? "none"
        : provider.promptCacheHintMode,
    promptCacheRetention: provider.promptCacheRetention,
    retryPolicy: provider.retryPolicy,
    nativeWebSearchEnabled: controls.nativeWebSearchEnabled,
    useSystemProxy: provider.useSystemProxy,
    modelConfig,
  };
}
