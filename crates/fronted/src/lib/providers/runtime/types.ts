import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import type {
  CodexRequestFormat,
  CustomProvider,
  ProviderAuthMode,
  ProviderId,
  ProviderModelConfig,
  ReasoningLevel,
} from "../../settings";
import type { StreamRetryConfig } from "./streamRetry";

export type ModelOption = {
  value: string; // encodes customProviderId::model
  label: string; // model id
  providerId: string; // stable custom provider identity (for grouping)
  providerName: string; // provider display name
  providerType: ProviderId; // routes Claude Code, Codex, Gemini, etc.
  model: string;
};

export type ProviderRuntimeConfig = {
  baseUrl: string;
  isFullUrl: boolean;
  apiKey: string;
  authMode?: ProviderAuthMode;
  oauthAccountId?: string;
  customHeaders?: CustomProvider["customHeaders"];
  requestFormat?: CodexRequestFormat;
  reasoning?: ReasoningLevel;
  promptCachingEnabled?: boolean;
  promptCacheHintMode?: import("../../settings").PromptCacheHintMode;
  promptCacheRetention?: "short" | "long";
  nativeWebSearchEnabled?: boolean;
  useSystemProxy?: boolean;
  modelConfig?: ProviderModelConfig;
};

export type ToolChoice =
  | "auto"
  | "any"
  | "none"
  | {
      type: "tool";
      name: string;
    };

export type StreamOptionsEx = SimpleStreamOptions & {
  /** Custom fetch boundary used by native adapters for response capture. */
  fetch?: typeof globalThis.fetch;
  /** Provider-specific sampling fields preserved by the payload pipeline. */
  samplingParams?: Record<string, unknown>;
  /**
   * 注意：pi-ai 的 streamSimpleAnthropic() 在内部会通过 buildBaseOptions() 丢弃 toolChoice，
   * 所以这里我们自己调用 streamAnthropic() 并把 toolChoice 显式传下去。
   */
  toolChoice?: ToolChoice;
  /** DeepSeek-only wire override for callers that must explicitly disable thinking. */
  deepSeekThinking?: "disabled";
  /** Conversation workdir used to resolve provider-native local attachments. */
  workdir?: string;
  /** Escape hatch for the unified provider stream retry in streamByApi.ts. */
  streamRetry?: StreamRetryConfig;
};
