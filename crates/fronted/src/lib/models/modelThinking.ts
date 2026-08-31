import type { CatalogThinkingLevel } from "./catalog.generated";
import {
  type CatalogAppProviderId,
  findCatalogModel,
  findCatalogModelAcrossProviders,
} from "./modelCatalog";

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

export type ThinkingLevel = CatalogThinkingLevel;

export const THINKING_LEVEL_LADDER: readonly ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export type ModelThinkingCapability = {
  reasoning: boolean;

  levels: ThinkingLevel[];

  alwaysOn: boolean;

  fromCatalog: boolean;
};

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

const FALLBACK_LEVELS: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high"];

function fallbackCapability(providerId: CatalogAppProviderId, modelId: string) {
  if (providerId === "claude_code" && isAnthropicAdaptiveModelId(modelId)) {
    // Keep the adaptive generations aligned with the authoritative catalog:
    // these models start at low, while xhigh remains family-specific.
    const levels: ThinkingLevel[] = anthropicModelSupportsXHigh(modelId)
      ? ["low", "medium", "high", "xhigh", "max"]
      : ["low", "medium", "high", "max"];
    return { reasoning: true, levels, alwaysOn: false, fromCatalog: false };
  }
  return { reasoning: true, levels: [...FALLBACK_LEVELS], alwaysOn: false, fromCatalog: false };
}

export function resolveModelThinking(
  providerId: CatalogAppProviderId,
  modelId: string | undefined,
): ModelThinkingCapability {
  const trimmedId = modelId?.trim();
  if (!trimmedId) return { reasoning: false, levels: [], alwaysOn: false, fromCatalog: false };

  const entry =
    findCatalogModel(providerId, trimmedId) ?? findCatalogModelAcrossProviders(trimmedId);
  const capability = entry
    ? entry.thinking
      ? {
          reasoning: true,
          levels: [...entry.thinking.levels],
          alwaysOn: !entry.thinking.off,
          fromCatalog: true,
        }
      : { reasoning: false, levels: [], alwaysOn: false, fromCatalog: true }
    : fallbackCapability(providerId, trimmedId);

  if (providerId === "xai" && capability.reasoning) {
    return { ...capability, alwaysOn: true };
  }
  return capability;
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

export type ThinkingLevelMap = Partial<Record<"off" | ThinkingLevel, string | null>>;

const BASE_LEVELS: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high"];
const OPT_IN_LEVELS: readonly ThinkingLevel[] = ["xhigh", "max"];

export function toThinkingLevelMap(
  capability: ModelThinkingCapability,
  wireValues?: ThinkingLevelMap,
): ThinkingLevelMap | undefined {
  if (!capability.reasoning) return undefined;
  const wireOf = (level: "off" | ThinkingLevel) => {
    const wire = wireValues?.[level];
    return typeof wire === "string" ? wire : undefined;
  };
  const map: ThinkingLevelMap = {};
  if (capability.alwaysOn) {
    map.off = null;
  } else {
    const wire = wireOf("off");
    if (wire !== undefined) map.off = wire;
  }
  for (const level of BASE_LEVELS) {
    if (!capability.levels.includes(level)) {
      map[level] = null;
    } else {
      const wire = wireOf(level);
      if (wire !== undefined && wire !== level) map[level] = wire;
    }
  }
  for (const level of OPT_IN_LEVELS) {
    if (capability.levels.includes(level)) map[level] = wireOf(level) ?? level;
  }
  return map;
}

export function clampThinkingLevelToList(
  level: ThinkingLevel,
  levels: readonly ThinkingLevel[],
): ThinkingLevel | undefined {
  if (levels.length === 0) return undefined;
  if (levels.includes(level)) return level;
  const requestedIndex = THINKING_LEVEL_LADDER.indexOf(level);
  if (requestedIndex === -1) return levels[0];
  for (let i = requestedIndex + 1; i < THINKING_LEVEL_LADDER.length; i += 1) {
    const candidate = THINKING_LEVEL_LADDER[i];
    if (levels.includes(candidate)) return candidate;
  }
  for (let i = requestedIndex - 1; i >= 0; i -= 1) {
    const candidate = THINKING_LEVEL_LADDER[i];
    if (levels.includes(candidate)) return candidate;
  }
  return levels[0];
}
