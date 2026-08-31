import type { Api, Context, Model } from "@earendil-works/pi-ai";
import type { StreamDebugLogger } from "../../debug/agentDebug";
import type { PromptCacheHintMode, ProviderId } from "../../settings";
import { attachDeepSeekProviderPayloadAdapter } from "../deepSeekProviderAdapter";
import {
  attachAnthropicMessagesNativeAttachments,
  attachGeminiGenerativeAINativeAttachments,
  attachOpenAICompletionsNativeAttachments,
  attachOpenAIResponsesNativeAttachments,
} from "../nativeResponsesAttachments";
import { attachAnthropicAutomaticCaching } from "./anthropicCache";
import { attachAnthropicLongContextBeta } from "./anthropicLongContext";
import { attachCodexPromptCacheHint } from "./codexPromptCache";
import { attachCodexResponsesStorage } from "./codexStorage";
import { attachDeepSeekResponsesPayloadCompat } from "./deepSeekResponsesPayload";
import { attachGeminiThoughtSignatureGuard } from "./geminiToolPayload";
import { attachProviderNativeWebSearch } from "./nativeSearchPayload";
import type { StreamOptionsEx } from "./types";
import { attachXaiResponsesPayloadCompat } from "./xaiResponsesPayload";

export type ProviderPayloadMiddleware = (
  options: StreamOptionsEx,
  params: FinalizeProviderStreamOptionsParams,
) => StreamOptionsEx;

export type FinalizeProviderStreamOptionsParams = {
  providerId: ProviderId;
  baseUrl: string;
  options: StreamOptionsEx;
  context?: Context;
  model?: Model<Api>;
  workdir?: string;
  nativeWebSearch?: boolean;
  promptCacheHintMode?: PromptCacheHintMode;
  debugLogger?: StreamDebugLogger;
  extra?: {
    phase?: string;
    round?: number;
    sessionId?: string;
  };
};

export function composePayloadMiddlewares(
  middlewares: ProviderPayloadMiddleware[],
): ProviderPayloadMiddleware {
  return (options, params) =>
    middlewares.reduce((next, middleware) => middleware(next, params), options);
}

export function attachPayloadDebugLogging(
  options: StreamOptionsEx,
  debugLogger?: StreamDebugLogger,
  extra?: {
    phase?: string;
    round?: number;
    sessionId?: string;
  },
): StreamOptionsEx {
  const previousOnPayload = options.onPayload;
  const previousOnResponse = options.onResponse;
  if (!debugLogger && !previousOnPayload && !previousOnResponse) return options;

  return {
    ...options,
    onPayload: async (payload, model) => {
      let nextPayload = payload;
      if (previousOnPayload) {
        const overridden = await previousOnPayload(payload, model);
        if (overridden !== undefined) {
          nextPayload = overridden;
        }
      }

      debugLogger?.logRequest({
        phase: extra?.phase ?? "provider_payload",
        round: extra?.round,
        sessionId: extra?.sessionId,
        api: model.api,
        provider: model.provider,
        headers: options.headers,
        payload: nextPayload,
      });

      return nextPayload;
    },
    onResponse: async (response, model) => {
      await previousOnResponse?.(response, model);
      debugLogger?.logResponse({
        phase: extra?.phase ?? "provider_response",
        round: extra?.round,
        sessionId: extra?.sessionId,
        api: model.api,
        provider: model.provider,
        response,
      });
    },
  };
}

const finalizePayloadMiddlewares = composePayloadMiddlewares([
  (options, params) => attachAnthropicAutomaticCaching(params.providerId, params.baseUrl, options),
  (options, params) =>
    attachAnthropicLongContextBeta(options, {
      providerId: params.providerId,
      baseUrl: params.baseUrl,
      model: params.model,
      context: params.context,
    }),
  (options, params) => attachCodexResponsesStorage(params.providerId, options),
  (options, params) =>
    attachCodexPromptCacheHint(
      params.providerId,
      params.baseUrl,
      params.promptCacheHintMode,
      params.model,
      options,
    ),
  (options, params) =>
    attachProviderNativeWebSearch(params.providerId, options, params.nativeWebSearch, {
      baseUrl: params.baseUrl,
    }),
  (options, params) =>
    attachXaiResponsesPayloadCompat(options, {
      providerId: params.providerId,
      baseUrl: params.baseUrl,
    }),
  (options, params) =>
    attachDeepSeekResponsesPayloadCompat(options, {
      providerId: params.providerId,
      model: params.model,
      context: params.context,
    }),
  (options, params) =>
    attachDeepSeekProviderPayloadAdapter(options, {
      providerId: params.providerId,
      baseUrl: params.baseUrl,
      model: params.model,
    }),
  (options, params) => {
    if (!params.context || !params.model) return options;
    let nextOptions = attachOpenAIResponsesNativeAttachments(options, {
      context: params.context,
      model: params.model,
      providerId: params.providerId,
      workdir: params.workdir,
    });
    nextOptions = attachOpenAICompletionsNativeAttachments(nextOptions, {
      context: params.context,
      model: params.model,
      providerId: params.providerId,
      workdir: params.workdir,
    });
    nextOptions = attachAnthropicMessagesNativeAttachments(nextOptions, {
      context: params.context,
      model: params.model,
      providerId: params.providerId,
      workdir: params.workdir,
    });
    return attachGeminiGenerativeAINativeAttachments(nextOptions, {
      context: params.context,
      model: params.model,
      providerId: params.providerId,
      workdir: params.workdir,
    });
  },
  (options, params) =>
    attachGeminiThoughtSignatureGuard(options, {
      providerId: params.providerId,
      baseUrl: params.baseUrl,
    }),
  (options, params) => attachPayloadDebugLogging(options, params.debugLogger, params.extra),
]);

export function finalizeProviderStreamOptions(
  params: FinalizeProviderStreamOptionsParams,
): StreamOptionsEx {
  const finalized = finalizePayloadMiddlewares(params.options, params);
  if (
    params.providerId !== "codex" ||
    params.model?.api !== "openai-completions" ||
    finalized.recoverMissingFinishReason !== undefined
  ) {
    return finalized;
  }
  try {
    const hostname = new URL(params.baseUrl).hostname.toLowerCase();
    return hostname === "api.openai.com" || hostname.endsWith(".api.openai.com")
      ? finalized
      : { ...finalized, recoverMissingFinishReason: true };
  } catch {
    return finalized;
  }
}
