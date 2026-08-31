import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { isAnthropicOAuthApiKey } from "@/lib/providers/customHeaders";
import type { ProviderId } from "../../settings";
import {
  ANTHROPIC_STANDARD_CONTEXT_WINDOW,
  getAnthropicCompat,
  shouldSendAnthropicLongContextHeader,
} from "../anthropicModels";
import type { StreamOptionsEx } from "./types";

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

export const ANTHROPIC_CONTEXT_1M_BETA = "context-1m-2025-08-07";
const ANTHROPIC_INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";
const ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";

function buildAnthropicBetaHeaderValue(
  model: Model<"anthropic-messages">,
  context: Context | undefined,
): string {
  const compat = getAnthropicCompat(model);
  const betas: string[] = [];
  if (context?.tools?.length && compat?.supportsEagerToolInputStreaming === false) {
    betas.push(ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA);
  }
  if (compat?.forceAdaptiveThinking !== true) {
    betas.push(ANTHROPIC_INTERLEAVED_THINKING_BETA);
  }
  betas.push(ANTHROPIC_CONTEXT_1M_BETA);
  return betas.join(",");
}

export function attachAnthropicLongContextBeta(
  options: StreamOptionsEx,
  params: {
    providerId: ProviderId;
    baseUrl: string;
    model?: Model<Api>;
    context?: Context;
  },
): StreamOptionsEx {
  const model = params.model;
  if (params.providerId !== "claude_code") return options;
  if (model?.api !== "anthropic-messages") return options;
  if (!shouldSendAnthropicLongContextHeader(params.baseUrl)) return options;
  if ((model.contextWindow ?? 0) <= ANTHROPIC_STANDARD_CONTEXT_WINDOW) return options;
  if (isAnthropicOAuthApiKey(options.apiKey)) return options;

  const headers = { ...options.headers };
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "anthropic-beta") delete headers[key];
  }
  headers["anthropic-beta"] = buildAnthropicBetaHeaderValue(
    model as Model<"anthropic-messages">,
    params.context,
  );

  return {
    ...options,
    headers,
  };
}
