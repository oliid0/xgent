import { type CatalogModelEntry, type CatalogProviderId, MODEL_CATALOG } from "./catalog.generated";

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

export { MODEL_CATALOG, MODEL_CATALOG_SNAPSHOT_DATE } from "./catalog.generated";
export type { CatalogModelEntry, CatalogProviderId };

export type CatalogAppProviderId = "claude_code" | "codex" | "gemini" | "xai" | "deepseek";

export type ModelLimits = { contextWindow: number; maxOutputToken: number };

export const CATALOG_PROVIDER_BY_APP_PROVIDER: Record<CatalogAppProviderId, CatalogProviderId> = {
  claude_code: "anthropic",
  codex: "openai",
  gemini: "google",
  xai: "xai",
  deepseek: "deepseek",
};

export const PROVIDER_FALLBACK_LIMITS: Record<CatalogAppProviderId, ModelLimits> = {
  claude_code: { contextWindow: 200_000, maxOutputToken: 32_000 },
  codex: { contextWindow: 400_000, maxOutputToken: 142_000 },
  gemini: { contextWindow: 1_048_576, maxOutputToken: 65_536 },
  xai: { contextWindow: 400_000, maxOutputToken: 142_000 },
  deepseek: { contextWindow: 128_000, maxOutputToken: 32_000 },
};

export const MAX_OUTPUT_TOKEN_CAP = 32_000;

export function normalizeModelLimits(limits: ModelLimits): ModelLimits {
  if (limits.contextWindow <= 0 || limits.maxOutputToken < limits.contextWindow) return limits;
  return {
    contextWindow: limits.contextWindow,
    maxOutputToken: Math.min(
      MAX_OUTPUT_TOKEN_CAP,
      Math.max(1, Math.floor(limits.contextWindow / 4)),
    ),
  };
}

export function normalizeModelIdCandidates(modelId: string): string[] {
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

  const lastSegment = withoutContextSuffix.split("/").pop() ?? "";
  if (lastSegment !== withoutContextSuffix) {
    push(lastSegment);
    push(lastSegment.replace(/-20\d{6}$/, ""));
  }
  return candidates;
}

const catalogIndexByProvider = new Map<CatalogProviderId, Map<string, CatalogModelEntry>>();

function getCatalogIndex(catalogProvider: CatalogProviderId): Map<string, CatalogModelEntry> {
  let index = catalogIndexByProvider.get(catalogProvider);
  if (!index) {
    index = new Map();
    for (const entry of MODEL_CATALOG[catalogProvider]) {
      index.set(entry.id, entry);

      const lower = entry.id.toLowerCase();
      if (!index.has(lower)) index.set(lower, entry);
    }
    catalogIndexByProvider.set(catalogProvider, index);
  }
  return index;
}

export function findCatalogModel(
  providerId: CatalogAppProviderId,
  modelId: string | undefined,
): CatalogModelEntry | undefined {
  const trimmedId = modelId?.trim();
  if (!trimmedId) return undefined;
  const index = getCatalogIndex(CATALOG_PROVIDER_BY_APP_PROVIDER[providerId]);
  for (const candidate of normalizeModelIdCandidates(trimmedId)) {
    const entry = index.get(candidate);
    if (entry) return entry;
  }
  return undefined;
}

const CATALOG_PROVIDER_IDS = Object.keys(MODEL_CATALOG) as CatalogProviderId[];

export function findCatalogModelAcrossProviders(
  modelId: string | undefined,
): CatalogModelEntry | undefined {
  const trimmedId = modelId?.trim();
  if (!trimmedId) return undefined;
  for (const candidate of normalizeModelIdCandidates(trimmedId)) {
    for (const catalogProvider of CATALOG_PROVIDER_IDS) {
      const entry = getCatalogIndex(catalogProvider).get(candidate);
      if (entry) return entry;
    }
  }
  return undefined;
}

export function resolveModelLimitsAcrossProviders(
  modelId: string | undefined,
): ModelLimits | undefined {
  const entry = findCatalogModelAcrossProviders(modelId);
  if (!entry) return undefined;
  return { contextWindow: entry.contextWindow, maxOutputToken: entry.maxOutputToken };
}

export function resolveModelLimits(
  providerId: CatalogAppProviderId,
  modelId: string | undefined,
): ModelLimits | undefined {
  const entry = findCatalogModel(providerId, modelId);
  if (!entry) return undefined;

  return { contextWindow: entry.contextWindow, maxOutputToken: entry.maxOutputToken };
}

export function getProviderFallbackLimits(providerId: CatalogAppProviderId): ModelLimits {
  const fallback = PROVIDER_FALLBACK_LIMITS[providerId];
  return { contextWindow: fallback.contextWindow, maxOutputToken: fallback.maxOutputToken };
}

export function extractProviderDeclaredLimits(
  obj: Record<string, unknown>,
): ModelLimits | undefined {
  const asPositiveInt = (value: unknown): number | undefined => {
    const numeric =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : undefined;
  };
  const topProvider =
    obj.top_provider && typeof obj.top_provider === "object"
      ? (obj.top_provider as Record<string, unknown>)
      : undefined;

  const contextWindow =
    asPositiveInt(obj.context_length) ?? asPositiveInt(topProvider?.context_length);
  if (!contextWindow) return undefined;

  const maxOutputToken =
    asPositiveInt(topProvider?.max_completion_tokens) ??
    asPositiveInt(obj.max_completion_tokens) ??
    normalizeModelLimits({ contextWindow, maxOutputToken: contextWindow }).maxOutputToken;

  return normalizeModelLimits({ contextWindow, maxOutputToken });
}
