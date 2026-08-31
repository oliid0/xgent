import type { CacheRetention } from "@earendil-works/pi-ai";
import type { PrefixShapeCacheControl } from "../../debug/prefixCacheShape";
import type { CodexRequestFormat, PromptCacheHintMode, ProviderId } from "../../settings";
import { describeAnthropicCacheShape } from "./anthropicCache";
import { describeCodexCacheShape } from "./codexPromptCache";
import type { StreamOptionsEx } from "./types";

const CODEX_REQUEST_FORMATS: readonly CodexRequestFormat[] = [
  "openai-completions",
  "openai-responses",
];

function toCodexRequestFormat(modelApi: string | undefined): CodexRequestFormat | undefined {
  return CODEX_REQUEST_FORMATS.find((format) => format === modelApi);
}

export function describeProviderCacheShape(params: {
  providerId: ProviderId;
  baseUrl: string;
  promptCacheHintMode?: PromptCacheHintMode;
  modelApi?: string;
  sessionId?: string;
  cacheRetention?: CacheRetention;
  headers?: StreamOptionsEx["headers"];
}): PrefixShapeCacheControl {
  if (params.providerId === "deepseek") {
    return {
      cacheRetention: "automatic",
      breakpointStrategy: "deepseek-prefix",
    };
  }
  if (params.providerId === "codex") {
    return describeCodexCacheShape(
      params.providerId,
      params.baseUrl,
      params.promptCacheHintMode,
      toCodexRequestFormat(params.modelApi),
      params.sessionId,
      params.cacheRetention,
      params.headers,
    );
  }
  return describeAnthropicCacheShape(params.providerId, params.baseUrl, params.cacheRetention);
}
