import {
  type ChatRuntimeControls,
  type CustomProvider,
  findProviderModelConfig,
  getChatRuntimeReasoningLevelsForProvider,
  normalizeChatRuntimeControlsForProvider,
} from "../../settings";
import type { ProviderRuntimeConfig } from "./types";

/**
 * ProviderRuntimeConfig 的唯一构造点——全仓仅此一处注入品牌。任何调用方都只能
 * 拿到完整对象并整体传递（需要改档位等请用展开派生），不得再逐字段转抄。
 */
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
