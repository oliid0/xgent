import {
  type CodexRequestFormat,
  type CustomProvider,
  normalizeCustomProvider,
  type ProviderId,
  type ProviderModelConfig,
  updateCustomProviders,
} from "../../lib/settings";
import type { CherryProviderImportItem } from "./CherryStudioImportModal";
import { createDraftModelConfig, fetchModelsFromApi, mergeFetchedModels } from "./providerUtils";

function discoveryTarget(provider: CustomProvider) {
  const normalized = normalizeCustomProvider(provider);
  return JSON.stringify([
    normalized.type,
    normalized.baseUrl,
    normalized.apiKey,
    normalized.isFullUrl,
    normalized.modelsUrl,
    normalized.authMode,
    normalized.oauthAccountId,
    normalized.customHeaders,
    normalized.useSystemProxy,
  ]);
}

import type { SetSettingsFn } from "./types";

export type CcsProviderImportItem = {
  sourceId: string;
  appType: string;
  providerType: ProviderId;
  name: string;
  baseUrl: string;
  isFullUrl: boolean;
  modelsUrl?: string;
  apiKey: string;
  requestFormat: CodexRequestFormat;
  models?: string[];
};

export type CcsProvidersResponse = {
  status: string;
  message: string;
  providers: CcsProviderImportItem[];
};

export function ccsImportIdentity(provider: Pick<CustomProvider, "type" | "name" | "baseUrl">) {
  const name = provider.name
    .replace(/[（(]ccswitch[）)]/i, "")
    .trim()
    .toLowerCase();
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/, "").toLowerCase();
  return `${provider.type}\n${name}\n${baseUrl}`;
}

export function providerFromCcs(
  item: CcsProviderImportItem,
  existingIds: Set<string>,
): CustomProvider {
  const baseId =
    `ccswitch-${item.sourceId}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "ccswitch-provider";
  let id = baseId;
  for (let index = 2; existingIds.has(id); index += 1) id = `${baseId}-${index}`;
  existingIds.add(id);

  const providerType = item.providerType;
  const models = (item.models ?? []).map((model) => createDraftModelConfig(providerType, model));
  return {
    id,
    name: `${item.name.replace(/[（(]ccswitch[）)]/i, "").trim()}（ccswitch）`,
    type: providerType,
    baseUrl: item.baseUrl,
    isFullUrl: item.isFullUrl,
    ...(item.providerType !== "gemini" && item.modelsUrl?.trim()
      ? { modelsUrl: item.modelsUrl.trim() }
      : {}),
    apiKey: item.apiKey,
    apiKeyConfigured: item.apiKey.trim().length > 0,
    models,
    activeModels: models.map((model) => model.id),
    requestFormat:
      providerType === "xai"
        ? "openai-responses"
        : providerType === "codex"
          ? item.requestFormat === "openai-completions"
            ? "openai-completions"
            : "openai-responses"
          : undefined,
    reasoning: "off",
    promptCachingEnabled:
      providerType !== "gemini" && providerType !== "xai" && providerType !== "deepseek",
    nativeWebSearchEnabled: true,
    useSystemProxy: false,
  };
}

export function ccsProviderCanSyncModels(item: CcsProviderImportItem) {
  return item.baseUrl.trim().length > 0 && item.apiKey.trim().length > 0;
}

export function ccsProviderIsTransferable(item: CcsProviderImportItem) {
  return ccsProviderCanSyncModels(item) || (item.models?.length ?? 0) > 0;
}

export function cherryProviderId(item: CherryProviderImportItem) {
  const baseId = `cherry-studio-${item.sourceId}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return baseId || "cherry-studio-provider";
}

function cherryProviderName(item: CherryProviderImportItem, allItems: CherryProviderImportItem[]) {
  const duplicateCount = allItems.filter(
    (candidate) =>
      candidate.name.trim().toLowerCase() === item.name.trim().toLowerCase() &&
      candidate.providerType === item.providerType &&
      candidate.baseUrl.trim().replace(/\/+$/, "").toLowerCase() ===
        item.baseUrl.trim().replace(/\/+$/, "").toLowerCase(),
  ).length;
  if (duplicateCount <= 1) return `${item.name.trim()}（Cherry Studio）`;
  const sourceId = item.sourceId.split("::", 1)[0].slice(0, 8);
  return `${item.name.trim()}（Cherry Studio · ${sourceId}）`;
}

// Re-syncing an existing provider must not silently revert an API key the
// user already configured in Xgent; like `name`, the existing key wins.
export function cherryEffectiveApiKey(item: CherryProviderImportItem, existing?: CustomProvider) {
  return existing?.apiKey?.trim() ? existing.apiKey : item.apiKey;
}

export function providerFromCherry(
  item: CherryProviderImportItem,
  allItems: CherryProviderImportItem[],
  existing?: CustomProvider,
): CustomProvider {
  const providerType = item.providerType;
  const models = existing?.models ?? [];
  const apiKey = cherryEffectiveApiKey(item, existing);
  return {
    ...(existing ?? {}),
    id: cherryProviderId(item),
    name: existing?.name ?? cherryProviderName(item, allItems),
    type: providerType,
    baseUrl: item.baseUrl,
    isFullUrl: existing?.isFullUrl ?? false,
    ...(existing?.modelsUrl ? { modelsUrl: existing.modelsUrl } : {}),
    apiKey,
    apiKeyConfigured: apiKey.trim().length > 0,
    models,
    activeModels: existing?.activeModels ?? [],
    requestFormat:
      providerType === "xai"
        ? "openai-responses"
        : providerType === "codex"
          ? item.requestFormat === "openai-completions"
            ? "openai-completions"
            : "openai-responses"
          : undefined,
    reasoning: existing?.reasoning ?? "off",
    promptCachingEnabled:
      providerType === "deepseek" || providerType === "xai" || providerType === "gemini"
        ? false
        : (existing?.promptCachingEnabled ?? true),
    nativeWebSearchEnabled: existing?.nativeWebSearchEnabled ?? true,
    useSystemProxy: existing?.useSystemProxy ?? false,
  };
}

export function isLikelyCherryChatModel(modelId: string) {
  const lower = modelId.toLowerCase();
  return ![
    "embedding",
    "rerank",
    "whisper",
    "realtime",
    "audio-preview",
    "audio-realtime",
    "image",
    "video",
    "banana",
    "dall-e",
    "imagen",
    "sora-",
    "veo-",
    "tts-",
  ].some((needle) => lower.includes(needle));
}

// sourceId alone can collide across ccswitch app_type buckets that map to the
// same provider tab (e.g. "claude" and "claude-code"), so key rows on both.
export function ccsItemKey(item: CcsProviderImportItem) {
  return `${item.appType}:${item.sourceId}`;
}

export function buildCcsImportedProviders(
  existingProviders: CustomProvider[],
  items: CcsProviderImportItem[],
) {
  const existingIds = new Set(existingProviders.map((provider) => provider.id));
  const existingIdentity = new Set(existingProviders.map(ccsImportIdentity));
  const imported: CustomProvider[] = [];

  for (const item of items) {
    if (!ccsProviderIsTransferable(item)) continue;
    const identity = ccsImportIdentity({
      type: item.providerType,
      name: item.name,
      baseUrl: item.baseUrl,
    });
    if (existingIdentity.has(identity)) continue;
    existingIdentity.add(identity);
    imported.push(providerFromCcs(item, existingIds));
  }

  return imported;
}

export async function syncCcsImportModels(
  transferable: CcsProviderImportItem[],
  setSettings: SetSettingsFn,
) {
  const syncable = transferable.filter(ccsProviderCanSyncModels);
  const modelResults = await Promise.all(
    syncable.map(async (item) => {
      const identity = ccsImportIdentity({
        type: item.providerType,
        name: item.name,
        baseUrl: item.baseUrl,
      });
      const target = discoveryTarget(providerFromCcs(item, new Set()));
      try {
        const models = await fetchModelsFromApi(item.providerType, item.baseUrl, item.apiKey, {
          useSystemProxy: true,
          isFullUrl: item.isFullUrl,
          modelsUrl: item.modelsUrl,
        });
        return { identity, models, target, fetched: true };
      } catch {
        return { identity, models: [] as ProviderModelConfig[], target, fetched: false };
      }
    }),
  );

  const resultsByIdentity = new Map(
    modelResults.map((result) => [result.identity, result] as const),
  );
  setSettings((prev) => {
    let changed = false;
    const providers = prev.customProviders.map((provider) => {
      const result = resultsByIdentity.get(ccsImportIdentity(provider));
      if (!result?.fetched || discoveryTarget(provider) !== result.target) return provider;
      const models = mergeFetchedModels(result.models, provider.models);
      const activeModels = models.map((model) => model.id);
      if (
        JSON.stringify(models) === JSON.stringify(provider.models) &&
        activeModels.length === provider.activeModels.length &&
        activeModels.every((model, index) => model === provider.activeModels[index])
      ) {
        return provider;
      }
      changed = true;
      return { ...provider, models, activeModels };
    });
    return changed ? updateCustomProviders(prev, providers) : prev;
  });

  const fetchedCount = modelResults.filter((result) => result.fetched).length;
  const failedCount = modelResults.length - fetchedCount;
  const totalModels = modelResults.reduce((total, result) => total + result.models.length, 0);
  return { fetchedCount, failedCount, totalModels };
}

export async function syncCherryImportModels(
  importable: CherryProviderImportItem[],
  existingById: Map<string, CustomProvider>,
  setSettings: SetSettingsFn,
) {
  const modelResults = await Promise.all(
    importable.map(async (item) => {
      const identity = cherryProviderId(item);
      const target = discoveryTarget(
        providerFromCherry(item, importable, existingById.get(identity)),
      );
      try {
        const fetchedModels = await fetchModelsFromApi(
          item.providerType,
          item.baseUrl,
          cherryEffectiveApiKey(item, existingById.get(identity)),
          {
            isFullUrl: existingById.get(identity)?.isFullUrl,
            modelsUrl: existingById.get(identity)?.modelsUrl,
          },
        );
        const models = fetchedModels.filter((model) => isLikelyCherryChatModel(model.id));
        return { identity, models, target, fetched: true, failed: false };
      } catch {
        return {
          identity,
          target,
          models: [] as ProviderModelConfig[],
          fetched: false,
          failed: true,
        };
      }
    }),
  );

  // Two selected items can normalize to the same provider id; merge their
  // results instead of letting the last one win.
  const resultsByIdentity = new Map<string, (typeof modelResults)[number]>();
  for (const result of modelResults) {
    const merged = resultsByIdentity.get(result.identity);
    if (!merged) {
      resultsByIdentity.set(result.identity, result);
      continue;
    }
    resultsByIdentity.set(result.identity, {
      identity: result.identity,
      target: result.target,
      models: mergeFetchedModels(result.models, merged.models),
      fetched: merged.fetched || result.fetched,
      failed: merged.failed || result.failed,
    });
  }

  setSettings((prev) => {
    let changed = false;
    const providers = prev.customProviders.map((provider) => {
      const result = resultsByIdentity.get(provider.id);
      if (!result?.fetched || discoveryTarget(provider) !== result.target) return provider;

      const models = mergeFetchedModels(result.models, provider.models);
      const activeModels = models.map((model) => model.id);
      if (
        JSON.stringify(models) === JSON.stringify(provider.models) &&
        activeModels.length === provider.activeModels.length &&
        activeModels.every((model, index) => model === provider.activeModels[index])
      ) {
        return provider;
      }
      changed = true;
      return { ...provider, models, activeModels };
    });
    return changed ? updateCustomProviders(prev, providers) : prev;
  });

  const fetchedCount = modelResults.filter((result) => result.fetched).length;
  const failedCount = modelResults.filter((result) => result.failed).length;
  const refreshedModelCount = modelResults.reduce(
    (total, result) => total + result.models.length,
    0,
  );
  return { fetchedCount, failedCount, totalModels: refreshedModelCount };
}
