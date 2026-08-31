import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { clampThinkingLevel } from "@earendil-works/pi-ai";
import type { AnthropicEffort } from "@earendil-works/pi-ai/api/anthropic-messages";
import type { GoogleOptions } from "@earendil-works/pi-ai/api/google-generative-ai";
import { resolveMaxTokens } from "./common";
import type { StreamOptionsEx } from "./types";

type ReasoningInput = SimpleStreamOptions["reasoning"] | undefined;

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

export type { AnthropicEffort };
export type AnthropicThinkingMode = "disabled" | "adaptive" | "budget";
export type AnthropicThinkingRuntime = {
  thinkingEnabled: boolean;
  mode: AnthropicThinkingMode;
  maxTokens: number;
  effort?: AnthropicEffort;
  thinkingBudgetTokens?: number;
  display?: "summarized";
};

function anthropicCompat(model: Model<Api>) {
  return (model as Model<"anthropic-messages">).compat;
}

export function supportsAdaptiveAnthropicThinking(model: Model<Api>): boolean {
  return anthropicCompat(model)?.forceAdaptiveThinking ?? false;
}

const ANTHROPIC_THINKING_BUDGETS: Record<NonNullable<ReasoningInput>, number> = {
  minimal: 1_024,
  low: 2_048,
  medium: 8_192,
  high: 16_384,
  xhigh: 16_384,
  max: 32_768,
};

export function mapReasoningToAnthropicEffort(
  reasoning: ReasoningInput,
  model: Model<Api>,
): AnthropicEffort {
  const mapped = reasoning ? model.thinkingLevelMap?.[reasoning] : undefined;
  if (typeof mapped === "string") return mapped as AnthropicEffort;

  switch (reasoning) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "xhigh":
      return "xhigh";
    case "max":
      return "max";
    default:
      return "high";
  }
}

export function resolveAnthropicThinkingRuntime(
  model: Model<Api>,
  options: StreamOptionsEx,
): AnthropicThinkingRuntime {
  const maxTokens = resolveMaxTokens(options.maxTokens, model.maxTokens);
  if (!options.reasoning) {
    return { thinkingEnabled: false, mode: "disabled", maxTokens };
  }

  if (supportsAdaptiveAnthropicThinking(model)) {
    return {
      thinkingEnabled: true,
      mode: "adaptive",
      maxTokens,
      effort: mapReasoningToAnthropicEffort(options.reasoning, model),
      display: "summarized",
    };
  }

  let thinkingBudgetTokens = ANTHROPIC_THINKING_BUDGETS[options.reasoning];
  const adjustedMaxTokens = Math.min(maxTokens + thinkingBudgetTokens, model.maxTokens);
  if (adjustedMaxTokens <= thinkingBudgetTokens) {
    thinkingBudgetTokens = Math.max(0, adjustedMaxTokens - 1_024);
  }

  return {
    thinkingEnabled: true,
    mode: "budget",
    maxTokens: adjustedMaxTokens,
    thinkingBudgetTokens,
  };
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

export function clampOpenAIReasoningEffort(
  model: Model<Api>,
  reasoning: ReasoningInput,
): ReasoningInput {
  if (!reasoning) return undefined;
  const clamped = clampThinkingLevel(model, reasoning);
  return clamped === "off" ? undefined : clamped;
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

export type GeminiThinkingLevel = "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
type GeminiEffort = "minimal" | "low" | "medium" | "high";

function isGemini3ProModel(modelId: string) {
  return /gemini-3(?:\.\d+)?-pro/.test(modelId.toLowerCase());
}

function isGemini3FlashModel(modelId: string) {
  const id = modelId.toLowerCase();
  return (
    /gemini-3(?:\.\d+)?-flash/.test(id) ||
    id === "gemini-flash-latest" ||
    id === "gemini-flash-lite-latest"
  );
}

function isGemma4Model(modelId: string) {
  return /gemma-?4/.test(modelId.toLowerCase());
}

function usesGeminiThinkingLevelField(modelId: string) {
  return isGemini3ProModel(modelId) || isGemini3FlashModel(modelId) || isGemma4Model(modelId);
}

function mapGeminiThinkingLevel(modelId: string, effort: GeminiEffort): GeminiThinkingLevel {
  if (isGemini3ProModel(modelId)) {
    return effort === "minimal" || effort === "low" ? "LOW" : "HIGH";
  }
  if (isGemma4Model(modelId)) {
    return effort === "minimal" || effort === "low" ? "MINIMAL" : "HIGH";
  }
  switch (effort) {
    case "minimal":
      return "MINIMAL";
    case "low":
      return "LOW";
    case "medium":
      return "MEDIUM";
    default:
      return "HIGH";
  }
}

function mapGeminiThinkingBudget(modelId: string, effort: GeminiEffort) {
  const id = modelId.toLowerCase();
  if (id.includes("2.5-pro")) {
    return { minimal: 128, low: 2_048, medium: 8_192, high: 32_768 }[effort];
  }
  if (id.includes("2.5-flash-lite")) {
    return { minimal: 512, low: 2_048, medium: 8_192, high: 24_576 }[effort];
  }
  if (id.includes("2.5-flash")) {
    return { minimal: 128, low: 2_048, medium: 8_192, high: 24_576 }[effort];
  }
  return -1;
}

export function resolveGeminiThinkingRuntime(
  model: Model<Api>,
  reasoning: ReasoningInput,
): GoogleOptions["thinking"] {
  if (!reasoning) return { enabled: false };

  const clamped = clampThinkingLevel(model, reasoning);
  const effort: GeminiEffort =
    clamped === "minimal" || clamped === "low" || clamped === "medium" ? clamped : "high";

  if (usesGeminiThinkingLevelField(model.id)) {
    return { enabled: true, level: mapGeminiThinkingLevel(model.id, effort) };
  }
  return { enabled: true, budgetTokens: mapGeminiThinkingBudget(model.id, effort) };
}
