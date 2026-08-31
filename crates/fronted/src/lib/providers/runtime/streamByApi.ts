import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { stream as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import {
  type GoogleOptions,
  stream as streamGoogle,
} from "@earendil-works/pi-ai/api/google-generative-ai";
import {
  type OpenAICompletionsOptions,
  stream as streamOpenAICompletions,
} from "@earendil-works/pi-ai/api/openai-completions";
import {
  type OpenAIResponsesOptions,
  stream as streamOpenAIResponses,
} from "@earendil-works/pi-ai/api/openai-responses";
import { wrapDeepSeekDsmlToolCallStream } from "../deepSeekDsmlToolCallStream";
import { DEEPSEEK_RESPONSES_API, streamDeepSeekResponses } from "../deepSeekNative";
import {
  attachDeepSeekProviderPayloadAdapter,
  isDeepSeekAnthropicTarget,
  normalizeDeepSeekAnthropicContext,
} from "../deepSeekProviderAdapter";
import { resolveMaxTokens } from "./common";
import {
  recoverOpenAICompletionsMissingFinishReason,
  rejectEmptyOpenAICompletionsResponse,
} from "./openAICompletionsStream";
import { withStreamRetry } from "./streamRetry";
import {
  clampOpenAIReasoningEffort,
  resolveAnthropicThinkingRuntime,
  resolveGeminiThinkingRuntime,
} from "./thinkingLevels";
import type { StreamOptionsEx, ToolChoice } from "./types";

function mapToolChoiceToOpenAI(
  toolChoice: ToolChoice | undefined,
): OpenAICompletionsOptions["toolChoice"] | undefined {
  if (!toolChoice) return undefined;
  if (toolChoice === "any") return "required";
  if (toolChoice === "auto" || toolChoice === "none") return toolChoice;
  return {
    type: "function",
    function: {
      name: toolChoice.name,
    },
  };
}

function mapToolChoiceToGoogle(
  toolChoice: ToolChoice | undefined,
): GoogleOptions["toolChoice"] | undefined {
  if (!toolChoice) return undefined;
  if (toolChoice === "auto" || toolChoice === "none" || toolChoice === "any") {
    return toolChoice;
  }
  return "auto";
}

function buildOpenAIBaseOptions(model: Model<Api>, options: StreamOptionsEx) {
  return {
    temperature: options.temperature,
    maxTokens: resolveMaxTokens(options.maxTokens, model.maxTokens),
    signal: options.signal,
    apiKey: options.apiKey,
    cacheRetention: options.cacheRetention,
    sessionId: options.sessionId,
    headers: options.headers,
    onPayload: options.onPayload,
    onResponse: options.onResponse,
    maxRetryDelayMs: options.maxRetryDelayMs,
    metadata: options.metadata,
  };
}

export function streamSimpleByApi(model: Model<Api>, context: Context, options: StreamOptionsEx) {
  switch (model.api) {
    case "anthropic-messages": {
      const deepSeekTarget = isDeepSeekAnthropicTarget({
        api: model.api,
        baseUrl: model.baseUrl,
        modelId: model.id,
      });
      const anthropicContext = deepSeekTarget
        ? normalizeDeepSeekAnthropicContext(context)
        : context;
      const effectiveOptions = attachDeepSeekProviderPayloadAdapter(options, {
        providerId: "claude_code",
        baseUrl: model.baseUrl,
        model,
      });

      const anthropicThinking = resolveAnthropicThinkingRuntime(model, effectiveOptions);

      const requestedToolChoice = effectiveOptions.toolChoice ?? "none";
      const anthropicToolChoice =
        anthropicThinking.thinkingEnabled &&
        requestedToolChoice !== "none" &&
        requestedToolChoice !== "auto"
          ? "auto"
          : requestedToolChoice;
      return withStreamRetry(
        () => {
          const source = streamAnthropic(model as Model<"anthropic-messages">, anthropicContext, {
            temperature: effectiveOptions.temperature,
            maxTokens: anthropicThinking.maxTokens,
            signal: effectiveOptions.signal,
            apiKey: effectiveOptions.apiKey,
            cacheRetention: effectiveOptions.cacheRetention,
            sessionId: effectiveOptions.sessionId,
            headers: effectiveOptions.headers,
            onPayload: effectiveOptions.onPayload,
            onResponse: effectiveOptions.onResponse,
            maxRetryDelayMs: effectiveOptions.maxRetryDelayMs,
            metadata: effectiveOptions.metadata,
            thinkingEnabled: anthropicThinking.thinkingEnabled,
            ...(anthropicThinking.effort ? { effort: anthropicThinking.effort } : {}),
            ...(anthropicThinking.thinkingBudgetTokens !== undefined
              ? { thinkingBudgetTokens: anthropicThinking.thinkingBudgetTokens }
              : {}),
            toolChoice: anthropicToolChoice,
          });
          return effectiveOptions.deepSeekDsmlToolCallRepair
            ? wrapDeepSeekDsmlToolCallStream(source)
            : source;
        },
        { signal: effectiveOptions.signal, ...effectiveOptions.streamRetry },
      );
    }
    case "openai-completions": {
      const effectiveOptions = attachDeepSeekProviderPayloadAdapter(options, {
        providerId: "codex",
        baseUrl: model.baseUrl,
        model,
      });

      const openAIOptions: OpenAICompletionsOptions = {
        ...buildOpenAIBaseOptions(model, effectiveOptions),
        reasoningEffort: clampOpenAIReasoningEffort(model, effectiveOptions.reasoning),
        toolChoice: context.tools?.length
          ? mapToolChoiceToOpenAI(effectiveOptions.toolChoice)
          : undefined,
      };
      return withStreamRetry(
        () => {
          const source = streamOpenAICompletions(
            model as Model<"openai-completions">,
            context,
            openAIOptions,
          );
          const compatible = effectiveOptions.recoverMissingFinishReason
            ? recoverOpenAICompletionsMissingFinishReason(source)
            : source;
          return rejectEmptyOpenAICompletionsResponse(compatible);
        },
        { signal: effectiveOptions.signal, ...effectiveOptions.streamRetry },
      );
    }
    case DEEPSEEK_RESPONSES_API:
      return withStreamRetry(() => streamDeepSeekResponses(model, context, options), {
        signal: options.signal,
        ...options.streamRetry,
      });
    case "openai-responses": {
      const openAIOptions: OpenAIResponsesOptions = {
        ...buildOpenAIBaseOptions(model, options),
        reasoningEffort: clampOpenAIReasoningEffort(model, options.reasoning),
      };
      return withStreamRetry(
        () => streamOpenAIResponses(model as Model<"openai-responses">, context, openAIOptions),
        {
          signal: options.signal,
          ...options.streamRetry,
        },
      );
    }
    case "google-generative-ai": {
      const googleOptions: GoogleOptions = {
        temperature: options.temperature,
        maxTokens: resolveMaxTokens(options.maxTokens, model.maxTokens),
        signal: options.signal,
        apiKey: options.apiKey,
        headers: options.headers,
        onPayload: options.onPayload,
        onResponse: options.onResponse,
        maxRetryDelayMs: options.maxRetryDelayMs,
        metadata: options.metadata,
        thinking: resolveGeminiThinkingRuntime(model, options.reasoning),
        toolChoice: mapToolChoiceToGoogle(options.toolChoice) ?? "none",
      };
      return withStreamRetry(
        () => streamGoogle(model as Model<"google-generative-ai">, context, googleOptions),
        {
          signal: options.signal,
          ...options.streamRetry,
        },
      );
    }
    default:
      throw new Error(`Unsupported model API: ${model.api}`);
  }
}
