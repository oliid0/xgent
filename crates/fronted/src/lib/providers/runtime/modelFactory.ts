import type { Model, ModelThinkingLevel, OpenAICompletionsCompat } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import {
  type ModelThinkingCapability,
  resolveModelThinking,
  type ThinkingLevelMap,
  toThinkingLevelMap,
} from "../../models/modelThinking";
import {
  type CodexRequestFormat,
  getProviderModelDefaults,
  type ProviderId,
  type ProviderModelConfig,
} from "../../settings";
import {
  anthropicModelSupportsXHigh,
  findBuiltinAnthropicModel,
  isAnthropicAdaptiveModelId,
  resolveAnthropicContextWindow,
  resolveAnthropicWireModelId,
} from "../anthropicModels";
import {
  DEEPSEEK_RESPONSES_API,
  isOfficialDeepSeekBaseUrl,
  normalizeDeepSeekResponsesBaseUrl,
} from "../deepSeekNative";
import {
  applyDeepSeekModelDefaults,
  isDeepSeekCodexTarget,
  resolveDeepSeekOpenAICompletionsOverrides,
} from "../deepSeekProviderAdapter";
import { isXaiProviderTarget } from "./xaiResponsesPayload";

const CODEX_RESPONSES_SUFFIX = "/responses";
const CODEX_RESPONSE_SUFFIX = "/response";
const CODEX_CHAT_COMPLETIONS_SUFFIX = "/chat/completions";

type CodexApi = "openai-responses" | "openai-completions";

const XAI_THINKING_LEVEL_MAP = { minimal: "low", max: "high" } as const;
const DEEPSEEK_THINKING_LEVEL_MAP = {
  off: "none",
  minimal: "low",
  medium: "high",
  xhigh: "high",
} as const;

function resolveModelThinkingFields(
  capability: ModelThinkingCapability,
  wireValues?: ThinkingLevelMap,
): Pick<Model<any>, "reasoning"> & { thinkingLevelMap?: Model<any>["thinkingLevelMap"] } {
  const thinkingLevelMap = toThinkingLevelMap(capability, wireValues);
  return {
    reasoning: capability.reasoning,
    ...(thinkingLevelMap
      ? { thinkingLevelMap: thinkingLevelMap as Model<any>["thinkingLevelMap"] }
      : {}),
  };
}

function resolveKnownModel(
  provider: "openai" | "anthropic" | "google",
  modelId: string,
  baseUrl: string,
): Model<any> | undefined {
  const known = getBuiltinModel(provider as any, modelId as any) as Model<any> | undefined;
  return known?.api ? ({ ...known, baseUrl } as Model<any>) : undefined;
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

function resolveKnownAnthropicModel(
  modelId: string,
  baseUrl: string,
  upstreamBaseUrl?: string,
): Model<any> | undefined {
  const known = findBuiltinAnthropicModel(modelId);
  if (!known?.api) return undefined;
  const endpointBaseUrl = upstreamBaseUrl?.trim() || baseUrl;
  return {
    ...known,
    baseUrl,
    id: resolveAnthropicWireModelId(modelId, endpointBaseUrl),
    name: modelId,
  } as Model<any>;
}

export function deriveAnthropicThinkingOverridesForCustomModel(modelId: string): {
  compat?: Model<"anthropic-messages">["compat"];
  thinkingLevelMap?: Model<"anthropic-messages">["thinkingLevelMap"];
} {
  if (!isAnthropicAdaptiveModelId(modelId)) return {};

  const supportsXHigh = anthropicModelSupportsXHigh(modelId);
  return {
    compat: { forceAdaptiveThinking: true },
    thinkingLevelMap: supportsXHigh ? { xhigh: "xhigh", max: "max" } : { max: "max" },
  };
}

function maybeAppendGeminiApiVersion(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    let pathname = url.pathname.replace(/\/+$/, "");
    const lowerPathname = pathname.toLowerCase();
    for (const suffix of [":streamgeneratecontent", ":generatecontent"]) {
      if (lowerPathname.endsWith(suffix)) {
        pathname = pathname.slice(0, -suffix.length);
        break;
      }
    }
    const modelsIndex = pathname.toLowerCase().lastIndexOf("/models");
    if (
      modelsIndex >= 0 &&
      (pathname.length === modelsIndex + "/models".length ||
        pathname.charAt(modelsIndex + "/models".length) === "/")
    ) {
      pathname = pathname.slice(0, modelsIndex);
    }
    if (!pathname || pathname === "/") {
      url.pathname = "/v1beta";
      return url.toString().replace(/\/+$/, "");
    }
    if (/\/v\d+(?:beta)?$/i.test(pathname)) {
      url.pathname = pathname;
      return url.toString().replace(/\/+$/, "");
    }
    url.pathname = `${pathname}/v1beta`;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return baseUrl;
  }
}

function maybeAppendCodexApiVersion(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (!/\/v1$/i.test(pathname)) {
      url.pathname = `${pathname}/v1`;
    } else {
      url.pathname = pathname;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return baseUrl;
  }
}

function supportsOpenAICompletionsImageInputModel(modelId: string) {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (normalizedModelId.includes("search-preview")) return false;
  return (
    normalizedModelId.startsWith("gpt-5") ||
    normalizedModelId.startsWith("chat-latest") ||
    normalizedModelId.startsWith("gpt-4o") ||
    normalizedModelId.startsWith("chatgpt-4o") ||
    normalizedModelId.startsWith("gpt-4.1") ||
    normalizedModelId.startsWith("gpt-4.5") ||
    normalizedModelId.startsWith("gpt-4-turbo") ||
    normalizedModelId.startsWith("o3") ||
    normalizedModelId.startsWith("o4") ||
    normalizedModelId.includes("vision") ||
    normalizedModelId.includes("qwen-vl") ||
    normalizedModelId.includes("qwen2-vl") ||
    normalizedModelId.includes("qwen2.5-vl") ||
    normalizedModelId.includes("qwen3-vl") ||
    normalizedModelId.includes("llava") ||
    normalizedModelId.includes("pixtral")
  );
}

function resolveCodexModelInput(api: CodexApi, modelId: string): Model<any>["input"] {
  if (api === "openai-responses" || supportsOpenAICompletionsImageInputModel(modelId)) {
    return ["text", "image"];
  }
  return ["text"];
}

function isOfficialOpenAIBaseUrl(baseUrl: string | undefined) {
  if (!baseUrl?.trim()) return false;
  try {
    const url = new URL(baseUrl);
    return url.hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function normalizeCompatBaseUrl(baseUrl: string | undefined) {
  return baseUrl?.trim().replace(/\/+$/, "").toLowerCase() ?? "";
}

function resolveCodexOpenAIResponsesCompat(params: {
  baseUrl: string;
  upstreamBaseUrl?: string;
}): Model<"openai-responses">["compat"] | undefined {
  const compatBaseUrl = normalizeCompatBaseUrl(params.upstreamBaseUrl ?? params.baseUrl);
  if (isOfficialOpenAIBaseUrl(compatBaseUrl)) return undefined;

  return {
    supportsDeveloperRole: false,
  };
}

function resolveCodexOpenAICompletionsOverrides(params: {
  baseUrl: string;
  upstreamBaseUrl?: string;
  modelId: string;
}):
  | {
      compat: OpenAICompletionsCompat;
      thinkingLevelMap?: Model<"openai-completions">["thinkingLevelMap"];
    }
  | undefined {
  const compatBaseUrl = normalizeCompatBaseUrl(params.upstreamBaseUrl ?? params.baseUrl);
  if (isOfficialOpenAIBaseUrl(compatBaseUrl)) return undefined;

  const normalizedModelId = params.modelId.trim().toLowerCase();
  const isZai = compatBaseUrl.includes("api.z.ai");
  const isXai = compatBaseUrl.includes("api.x.ai");
  const isOpenRouter = compatBaseUrl.includes("openrouter.ai");
  const isGroq = compatBaseUrl.includes("groq.com");
  const isChutes = compatBaseUrl.includes("chutes.ai");
  const isDeepSeek =
    compatBaseUrl.includes("deepseek.com") || normalizedModelId.includes("deepseek");
  if (isDeepSeek) {
    return resolveDeepSeekOpenAICompletionsOverrides();
  }
  const isKnownNonOpenAIModel =
    normalizedModelId.includes("qwen") ||
    normalizedModelId.includes("gpt-oss") ||
    normalizedModelId.includes("glm") ||
    normalizedModelId.includes("kimi") ||
    normalizedModelId.includes("minimax");
  const shouldUseCompatibleDefaults =
    isKnownNonOpenAIModel ||
    isZai ||
    isXai ||
    isOpenRouter ||
    isGroq ||
    isChutes ||
    compatBaseUrl.includes("cerebras.ai") ||
    compatBaseUrl.includes("opencode.ai") ||
    !isOfficialOpenAIBaseUrl(compatBaseUrl);

  if (!shouldUseCompatibleDefaults) return undefined;

  const compat: OpenAICompletionsCompat = {
    supportsStore: false,
    supportsDeveloperRole: false,
  };

  if (isXai || isZai) {
    compat.supportsReasoningEffort = false;
  }
  if (isChutes) {
    compat.maxTokensField = "max_tokens";
  }
  if (isZai) {
    compat.thinkingFormat = "zai";
  } else if (isOpenRouter) {
    compat.thinkingFormat = "openrouter";
  }
  return {
    compat,
    ...(isGroq && normalizedModelId === "qwen/qwen3-32b"
      ? {
          thinkingLevelMap: {
            minimal: "default",
            low: "default",
            medium: "default",
            high: "default",
            xhigh: "default",
          },
        }
      : {}),
  };
}

function normalizeCodexBaseUrl(baseUrl: string): {
  baseUrl: string;
  preferredApi?: CodexApi;
} {
  let normalized = baseUrl.trim().replace(/\/+$/, "");
  const lower = normalized.toLowerCase();
  let preferredApi: CodexApi | undefined;

  if (lower.endsWith(CODEX_CHAT_COMPLETIONS_SUFFIX)) {
    normalized = normalized.slice(0, -CODEX_CHAT_COMPLETIONS_SUFFIX.length);
    preferredApi = "openai-completions";
  } else if (lower.endsWith(CODEX_RESPONSES_SUFFIX)) {
    normalized = normalized.slice(0, -CODEX_RESPONSES_SUFFIX.length);
    preferredApi = "openai-responses";
  } else if (lower.endsWith(CODEX_RESPONSE_SUFFIX)) {
    normalized = normalized.slice(0, -CODEX_RESPONSE_SUFFIX.length);
    preferredApi = "openai-responses";
  }

  return {
    baseUrl: maybeAppendCodexApiVersion(normalized),
    preferredApi,
  };
}

function inferCodexApi(requestFormat?: CodexRequestFormat, preferredApi?: CodexApi): CodexApi {
  return requestFormat ?? preferredApi ?? "openai-responses";
}

export function createModelFromConfig(
  providerId: ProviderId,
  modelId: string,
  baseUrl: string,
  requestFormat?: CodexRequestFormat,
  modelConfig?: ProviderModelConfig,
  upstreamBaseUrl?: string,
): Model<any> {
  const defaults = getProviderModelDefaults(providerId, modelId);
  const configuredContextWindow = modelConfig?.contextWindow ?? defaults.contextWindow;
  const contextWindow =
    providerId === "claude_code"
      ? resolveAnthropicContextWindow(
          modelId,
          configuredContextWindow,
          upstreamBaseUrl?.trim() || baseUrl,
        )
      : configuredContextWindow;
  const maxTokens = modelConfig?.maxOutputToken ?? defaults.maxOutputToken;

  const configuredCost = modelConfig?.cost;
  const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const customModelCost = configuredCost ?? zeroCost;
  const thinking = resolveModelThinking(providerId, modelId);

  if (providerId === "deepseek") {
    return {
      id: modelId,
      name: modelId,
      api: DEEPSEEK_RESPONSES_API,
      provider: "deepseek",
      baseUrl: normalizeDeepSeekResponsesBaseUrl(baseUrl, {
        officialHost: isOfficialDeepSeekBaseUrl(upstreamBaseUrl?.trim() || baseUrl),
      }),
      ...resolveModelThinkingFields(thinking, DEEPSEEK_THINKING_LEVEL_MAP),
      input: ["text"],
      cost: customModelCost,
      contextWindow,
      maxTokens,
      compat: {
        supportsDeveloperRole: true,
        supportsLongCacheRetention: false,
        supportsStrictMode: false,
      },
    } as Model<any>;
  }

  if (providerId === "codex" || providerId === "xai") {
    const { baseUrl: normalizedBaseUrl, preferredApi } = normalizeCodexBaseUrl(baseUrl);
    const isXaiTarget = isXaiProviderTarget({
      providerId,
      baseUrl: upstreamBaseUrl?.trim() || baseUrl,
    });
    const isDeepSeekCodex = isDeepSeekCodexTarget({
      providerId,
      baseUrl: normalizedBaseUrl,
      upstreamBaseUrl,
      modelId,
    });
    const api = isXaiTarget
      ? "openai-responses"
      : isDeepSeekCodex
        ? "openai-completions"
        : inferCodexApi(requestFormat, preferredApi);
    const responsesCompat =
      api === "openai-responses"
        ? resolveCodexOpenAIResponsesCompat({
            baseUrl: normalizedBaseUrl,
            upstreamBaseUrl,
          })
        : undefined;
    const known = resolveKnownModel("openai", modelId, normalizedBaseUrl);
    if (known && known.api === api) {
      return applyDeepSeekModelDefaults(
        {
          ...known,
          contextWindow,
          maxTokens,
          ...(configuredCost ? { cost: configuredCost } : {}),
          ...resolveModelThinkingFields(
            thinking,
            isXaiTarget
              ? XAI_THINKING_LEVEL_MAP
              : (known.thinkingLevelMap as ThinkingLevelMap | undefined),
          ),
          ...(responsesCompat
            ? {
                compat: {
                  ...(known.compat ?? {}),
                  ...responsesCompat,
                },
              }
            : {}),
        },
        {
          providerId,
          baseUrl: normalizedBaseUrl,
          upstreamBaseUrl,
          modelId,
        },
      );
    }

    const custom: Model<any> = {
      id: modelId,
      name: modelId,
      api,
      provider: "openai",
      baseUrl: normalizedBaseUrl,

      ...resolveModelThinkingFields(thinking, isXaiTarget ? XAI_THINKING_LEVEL_MAP : undefined),
      input: resolveCodexModelInput(api, modelId),
      cost: customModelCost,
      contextWindow,
      maxTokens,
    };
    if (api === "openai-responses" && responsesCompat) {
      custom.compat = responsesCompat;
    } else if (api === "openai-completions") {
      const overrides = resolveCodexOpenAICompletionsOverrides({
        baseUrl: normalizedBaseUrl,
        upstreamBaseUrl,
        modelId,
      });
      if (overrides) {
        custom.compat = overrides.compat;
        if (overrides.thinkingLevelMap) {
          custom.thinkingLevelMap = toThinkingLevelMap(
            thinking,
            overrides.thinkingLevelMap as ThinkingLevelMap,
          ) as Model<any>["thinkingLevelMap"];
        }
      }
    }
    return applyDeepSeekModelDefaults(custom, {
      providerId,
      baseUrl: normalizedBaseUrl,
      upstreamBaseUrl,
      modelId,
    });
  }

  if (providerId === "gemini") {
    const normalizedBaseUrl = maybeAppendGeminiApiVersion(baseUrl);
    const known = resolveKnownModel("google", modelId, normalizedBaseUrl);
    if (known && known.api === "google-generative-ai") {
      return {
        ...known,
        contextWindow,
        maxTokens,
        ...(configuredCost ? { cost: configuredCost } : {}),
        ...resolveModelThinkingFields(
          thinking,
          known.thinkingLevelMap as ThinkingLevelMap | undefined,
        ),
      };
    }

    const custom: Model<"google-generative-ai"> = {
      id: modelId,
      name: modelId,
      api: "google-generative-ai",
      provider: "google",
      baseUrl: normalizedBaseUrl,
      ...resolveModelThinkingFields(thinking),
      input: ["text", "image"],
      cost: customModelCost,
      contextWindow,
      maxTokens,
    };
    return custom;
  }

  const known = resolveKnownAnthropicModel(modelId, baseUrl, upstreamBaseUrl);
  if (known) {
    return applyDeepSeekModelDefaults(
      {
        ...known,
        contextWindow,
        maxTokens,
        ...(configuredCost ? { cost: configuredCost } : {}),
        ...resolveModelThinkingFields(
          thinking,
          known.thinkingLevelMap as ThinkingLevelMap | undefined,
        ),
      },
      {
        providerId,
        baseUrl,
        upstreamBaseUrl,
        modelId,
      },
    );
  }

  const thinkingOverrides = deriveAnthropicThinkingOverridesForCustomModel(modelId);
  const custom: Model<"anthropic-messages"> = {
    id: resolveAnthropicWireModelId(modelId, upstreamBaseUrl?.trim() || baseUrl),
    name: modelId,
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl,
    ...resolveModelThinkingFields(
      thinking,
      thinkingOverrides.thinkingLevelMap as ThinkingLevelMap | undefined,
    ),
    input: ["text"],
    cost: customModelCost,
    contextWindow,
    maxTokens,
    ...(thinkingOverrides.compat ? { compat: thinkingOverrides.compat } : {}),
  };
  return applyDeepSeekModelDefaults(custom, {
    providerId,
    baseUrl,
    upstreamBaseUrl,
    modelId,
  });
}

export function getAvailableThinkingLevelsForModel(
  providerId: ProviderId,
  modelId: string,
  _baseUrl: string,
  _requestFormat?: CodexRequestFormat,
  _modelConfig?: ProviderModelConfig,
  _upstreamBaseUrl?: string,
): ModelThinkingLevel[] {
  if (!modelId.trim()) return [];
  return resolveModelThinking(providerId, modelId).levels as ModelThinkingLevel[];
}

export function isThinkingAlwaysOnForModel(
  providerId: ProviderId,
  modelId: string,
  _baseUrl: string,
  _requestFormat?: CodexRequestFormat,
  _modelConfig?: ProviderModelConfig,
  _upstreamBaseUrl?: string,
): boolean {
  if (!modelId.trim()) return false;
  return resolveModelThinking(providerId, modelId).alwaysOn;
}
