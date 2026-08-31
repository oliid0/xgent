import type { Model } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

export const ANTHROPIC_STANDARD_CONTEXT_WINDOW = 200_000;
export const ANTHROPIC_LONG_CONTEXT_WINDOW = 1_000_000;

export function normalizeAnthropicModelIdCandidates(modelId: string): string[] {
  const candidates: string[] = [];
  const push = (value: string) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  push(modelId);
  const lower = modelId.toLowerCase();
  push(lower);
  const withoutAtVersion = lower.split("@")[0];
  push(withoutAtVersion);
  const withoutContextSuffix = withoutAtVersion.replace(/\[1m\]$/i, "");
  push(withoutContextSuffix);
  push(withoutContextSuffix.replace(/-20\d{6}$/, ""));
  return candidates;
}

export function findBuiltinAnthropicModel(
  modelId: string,
): Model<"anthropic-messages"> | undefined {
  const models = getBuiltinModels("anthropic");
  for (const candidate of normalizeAnthropicModelIdCandidates(modelId)) {
    const known = models.find((model) => model.id === candidate);
    if (known?.api) return known as Model<"anthropic-messages">;
  }
  return undefined;
}

export function getAnthropicCompat(
  model: Model<"anthropic-messages">,
): Model<"anthropic-messages">["compat"] | undefined {
  return model.compat;
}

export function hasAnthropicLongContextSuffix(modelId: string): boolean {
  return /\[1m\]$/i.test(modelId.trim());
}

function isClaudeFamilyVersionAtLeast(
  normalizedModelId: string,
  family: "opus" | "sonnet",
  minimumMinor: number,
) {
  const match = normalizedModelId.match(
    new RegExp(`(?:${family}[-.]4[-.](\\d{1,2})(?!\\d)|4[-.](\\d{1,2})(?!\\d)[-.]${family})`),
  );
  if (!match) return false;
  const minor = Number(match[1] ?? match[2]);
  return Number.isFinite(minor) && minor >= minimumMinor;
}

function isClaudeFamilyMajorVersionAtLeast(normalizedModelId: string, minimumMajor: number) {
  const match = normalizedModelId.match(
    /(?:(?:opus|sonnet|haiku|fable|mythos)[-.](\d{1,2})(?!\d)|(?<!\d[-.])(\d{1,2})[-.](?:opus|sonnet|haiku|fable|mythos))/,
  );
  if (!match) return false;
  const major = Number(match[1] ?? match[2]);
  return Number.isFinite(major) && major >= minimumMajor;
}

export function isAnthropicAdaptiveModelId(modelId: string): boolean {
  const normalizedModelId = modelId.trim().toLowerCase();
  return (
    normalizedModelId.includes("mythos-preview") ||
    isClaudeFamilyVersionAtLeast(normalizedModelId, "opus", 6) ||
    isClaudeFamilyVersionAtLeast(normalizedModelId, "sonnet", 6) ||
    isClaudeFamilyMajorVersionAtLeast(normalizedModelId, 5)
  );
}

export function anthropicModelSupportsXHigh(modelId: string): boolean {
  const normalizedModelId = modelId.trim().toLowerCase();
  return (
    isClaudeFamilyVersionAtLeast(normalizedModelId, "opus", 7) ||
    isClaudeFamilyMajorVersionAtLeast(normalizedModelId, 5)
  );
}

function getAnthropicEndpointHost(baseUrl: string | undefined): string | undefined {
  if (!baseUrl?.trim()) return undefined;
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function shouldSendAnthropicLongContextHeader(baseUrl: string | undefined): boolean {
  const host = getAnthropicEndpointHost(baseUrl);
  if (!host) return false;

  // These endpoints either have 1M GA semantics already or require a
  // provider-specific body/auth contract instead of an HTTP beta header.
  if (
    host === "api.anthropic.com" ||
    host.includes("aiplatform.googleapis.com") ||
    host.includes("vertexai.googleapis.com") ||
    host.endsWith(".deepseek.com") ||
    host === "deepseek.com" ||
    host.endsWith(".amazonaws.com")
  ) {
    return false;
  }

  return true;
}

export function resolveAnthropicWireModelId(modelId: string, baseUrl: string | undefined): string {
  if (hasAnthropicLongContextSuffix(modelId) && !shouldSendAnthropicLongContextHeader(baseUrl)) {
    return modelId.replace(/\[1m\]$/i, "");
  }
  return modelId;
}

function effectiveAnthropicContextWindow(
  known: Model<"anthropic-messages">,
  modelId: string,
  baseUrl?: string,
): number {
  if (getAnthropicCompat(known)?.forceAdaptiveThinking === true) return known.contextWindow;
  if (
    hasAnthropicLongContextSuffix(modelId) &&
    (baseUrl === undefined || shouldSendAnthropicLongContextHeader(baseUrl))
  ) {
    return ANTHROPIC_LONG_CONTEXT_WINDOW;
  }
  return Math.min(known.contextWindow, ANTHROPIC_STANDARD_CONTEXT_WINDOW);
}

export function resolveAnthropicContextWindow(
  modelId: string,
  configuredContextWindow: number,
  baseUrl?: string,
): number {
  const known = findBuiltinAnthropicModel(modelId);
  if (isAnthropicAdaptiveModelId(modelId)) {
    return Math.max(configuredContextWindow, known?.contextWindow ?? ANTHROPIC_LONG_CONTEXT_WINDOW);
  }
  if (hasAnthropicLongContextSuffix(modelId)) {
    if (baseUrl === undefined || shouldSendAnthropicLongContextHeader(baseUrl)) {
      return Math.max(configuredContextWindow, ANTHROPIC_LONG_CONTEXT_WINDOW);
    }
    return known
      ? effectiveAnthropicContextWindow(known, modelId, baseUrl)
      : Math.min(configuredContextWindow, ANTHROPIC_STANDARD_CONTEXT_WINDOW);
  }
  if (
    known &&
    baseUrl !== undefined &&
    shouldSendAnthropicLongContextHeader(baseUrl) &&
    configuredContextWindow > ANTHROPIC_STANDARD_CONTEXT_WINDOW
  ) {
    return configuredContextWindow;
  }
  return known ? effectiveAnthropicContextWindow(known, modelId, baseUrl) : configuredContextWindow;
}

export function resolveAnthropicKnownModelLimits(
  modelId: string | undefined,
  baseUrl?: string,
): { contextWindow: number; maxOutputToken: number } | undefined {
  const trimmedId = modelId?.trim();
  if (!trimmedId) return undefined;
  const known = findBuiltinAnthropicModel(trimmedId);
  if (!known) return undefined;
  return {
    contextWindow: resolveAnthropicContextWindow(trimmedId, known.contextWindow, baseUrl),
    maxOutputToken: known.maxTokens,
  };
}
