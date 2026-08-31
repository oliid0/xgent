import { isBrowserRuntime } from "@xgent/runtime";
import { mergeCustomHeaders } from "../../lib/providers/customHeaders";
import { sortModelsByActiveStateAndVendor } from "../../lib/providers/modelVendor";
import { prepareProxyRequest, XGENT_UPSTREAM_URL_HEADER } from "../../lib/providers/proxy";
import {
  type CustomProvider,
  createProviderModelConfig,
  normalizeProviderModelConfigs,
  type ProviderAuthMode,
  type ProviderId,
  type ProviderModelConfig,
} from "../../lib/settings";
import { normalizeBaseUrl } from "../../lib/settings/normalize";

const CODEX_MODELS_SUFFIXES = ["/chat/completions", "/responses", "/response"];
const GEMINI_GENERATE_SUFFIXES = [":streamGenerateContent", ":generateContent"];
const ANTHROPIC_API_VERSION = "2023-06-01";

// Re-export the shared runtime predicate for the provider dialog.
export { isBrowserRuntime };

function deriveModelsBaseUrlFromFullUrl(baseUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    return normalizeBaseUrl(baseUrl);
  }
  parsed.search = "";
  parsed.hash = "";

  const path = parsed.pathname.replace(/\/+$/, "");
  const versionIndex = path.toLowerCase().indexOf("/v1/");
  if (versionIndex >= 0) {
    parsed.pathname = path.slice(0, versionIndex + "/v1".length);
  } else {
    const separatorIndex = path.lastIndexOf("/");
    parsed.pathname = separatorIndex > 0 ? path.slice(0, separatorIndex) : "/";
  }
  return normalizeBaseUrl(parsed.toString());
}

export function normalizeProviderModelsBaseUrl(
  type: ProviderId,
  baseUrl: string,
  isFullUrl = false,
) {
  if (isFullUrl) return deriveModelsBaseUrlFromFullUrl(baseUrl);
  let normalizedUrl = normalizeBaseUrl(baseUrl);

  if (type !== "codex" && type !== "xai" && type !== "deepseek" && type !== "gemini") {
    return normalizedUrl;
  }

  const lower = normalizedUrl.toLowerCase();

  if (type === "codex" || type === "xai" || type === "deepseek") {
    for (const suffix of CODEX_MODELS_SUFFIXES) {
      if (lower.endsWith(suffix)) {
        normalizedUrl = normalizedUrl.slice(0, -suffix.length);
        break;
      }
    }
  } else {
    for (const suffix of GEMINI_GENERATE_SUFFIXES) {
      if (lower.endsWith(suffix.toLowerCase())) {
        normalizedUrl = normalizedUrl.slice(0, -suffix.length);
        break;
      }
    }
    const modelsIndex = normalizedUrl.toLowerCase().lastIndexOf("/models");
    if (modelsIndex >= 0) {
      const afterModels = normalizedUrl.slice(modelsIndex + "/models".length);
      if (!afterModels || afterModels.startsWith("/")) {
        normalizedUrl = normalizedUrl.slice(0, modelsIndex);
      }
    }
  }

  return normalizeBaseUrl(normalizedUrl);
}

export type ProviderModelsAttemptKind = "default" | "official";

export type ProviderModelsAttempt = {
  kind: ProviderModelsAttemptKind;
  headers: Record<string, string>;
};

export type ProviderModelsFailure = {
  status: number | null;
  message: string;
};

function buildVersionedModelsUrl(baseUrl: string, versionPath: string) {
  const apiRoot = normalizeBaseUrl(baseUrl)
    .replace(/\/models$/i, "")
    .replace(/\/v\d+(?:beta)?$/i, "");
  return `${apiRoot}/${versionPath}/models`;
}

export function buildProviderModelsUrl(
  type: ProviderId,
  baseUrl: string,
  kind: ProviderModelsAttemptKind,
) {
  const versionPath = kind === "official" && type === "gemini" ? "v1beta" : "v1";
  return buildVersionedModelsUrl(baseUrl, versionPath);
}

type ProviderModelsAuthOptions = {
  authMode?: ProviderAuthMode;
  oauthAccountId?: string;
  providerConfigId?: string;
  customHeaders?: CustomProvider["customHeaders"];
  isFullUrl?: boolean;
  modelsUrl?: string;
};

function buildDefaultModelsHeaders(
  _type: ProviderId,
  apiKey: string,
  authMode: ProviderAuthMode,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(authMode === "oauth-managed" ? {} : { Authorization: `Bearer ${apiKey}` }),
  };
}

function buildOfficialModelsHeaders(
  type: ProviderId,
  apiKey: string,
  authMode: ProviderAuthMode,
): Record<string, string> {
  if (type === "gemini") {
    return {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    };
  }
  if (type === "claude_code") {
    return {
      "Content-Type": "application/json",
      ...(authMode === "oauth-token"
        ? { Authorization: `Bearer ${apiKey}` }
        : { "x-api-key": apiKey }),
      "anthropic-version": ANTHROPIC_API_VERSION,
    };
  }
  if (authMode === "oauth-managed") {
    return { "Content-Type": "application/json" };
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function providerModelsAttemptSignature(
  type: ProviderId,
  baseUrl: string,
  attempt: ProviderModelsAttempt,
) {
  const url = buildProviderModelsUrl(type, baseUrl, attempt.kind);
  const headers = Object.entries(attempt.headers).sort(([a], [b]) => a.localeCompare(b));
  return `${url}||${JSON.stringify(headers)}`;
}

export function buildProviderModelsAttempts(
  type: ProviderId,
  baseUrl: string,
  apiKey: string,
  options?: ProviderModelsAuthOptions,
): ProviderModelsAttempt[] {
  const authMode = options?.authMode ?? "api-key";
  const candidates: ProviderModelsAttempt[] = [
    {
      kind: "default",
      headers: mergeCustomHeaders(
        buildDefaultModelsHeaders(type, apiKey, authMode),
        options?.customHeaders,
      ),
    },
    {
      kind: "official",
      headers: mergeCustomHeaders(
        buildOfficialModelsHeaders(type, apiKey, authMode),
        options?.customHeaders,
      ),
    },
  ];

  const attempts: ProviderModelsAttempt[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const signature = providerModelsAttemptSignature(type, baseUrl, candidate);
    if (seen.has(signature)) continue;
    seen.add(signature);
    attempts.push(candidate);
  }
  return attempts;
}

function isMissingEndpointStatus(status: number | null) {
  return status === 404 || status === 405;
}

export function pickProviderModelsFailure(
  failures: ProviderModelsFailure[],
): ProviderModelsFailure | null {
  for (let index = failures.length - 1; index >= 0; index -= 1) {
    if (!isMissingEndpointStatus(failures[index].status)) return failures[index];
  }
  return failures.length > 0 ? failures[failures.length - 1] : null;
}

function extractModelListItems(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  const payload = data as { data?: unknown; models?: unknown; result?: unknown } | null;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.models)) return payload.models;
  for (const nested of [payload?.data, payload?.result]) {
    if (!nested || typeof nested !== "object") continue;
    const nestedPayload = nested as { data?: unknown; models?: unknown };
    if (Array.isArray(nestedPayload.data)) return nestedPayload.data;
    if (Array.isArray(nestedPayload.models)) return nestedPayload.models;
  }
  return null;
}

type ModelPageCursor = { parameter: "pageToken" | "after_id"; value: string };

function readModelPageCursor(data: unknown, providerType: ProviderId): ModelPageCursor | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  if (providerType === "gemini") {
    const value = payload.nextPageToken ?? payload.next_page_token;
    return typeof value === "string" && value.trim()
      ? { parameter: "pageToken", value: value.trim() }
      : null;
  }
  if (providerType === "claude_code" && payload.has_more === true) {
    const value = payload.last_id ?? payload.lastId;
    return typeof value === "string" && value.trim()
      ? { parameter: "after_id", value: value.trim() }
      : null;
  }
  return null;
}

function withModelPageCursor(url: string, cursor: ModelPageCursor) {
  const parsed = new URL(url);
  parsed.searchParams.set(cursor.parameter, cursor.value);
  return parsed.toString();
}

async function readFetchError(response: Response, fallback: string) {
  const raw = (await response.text()).trim();
  if (!raw) {
    return fallback;
  }

  try {
    const payload = JSON.parse(raw) as { error?: unknown; message?: unknown };
    const errorText =
      typeof payload.error === "string"
        ? payload.error.trim()
        : typeof payload.message === "string"
          ? payload.message.trim()
          : "";
    return errorText || raw;
  } catch {
    return raw;
  }
}

export function normalizeFetchedModels(
  items: unknown,
  providerType: ProviderId,
): ProviderModelConfig[] {
  if (providerType === "gemini") {
    return normalizeGeminiFetchedModels(items);
  }
  return normalizeApiFetchedModels(items, providerType);
}

function normalizeApiFetchedModels(
  items: unknown,
  providerType: ProviderId,
): ProviderModelConfig[] {
  const models = normalizeProviderModelConfigs(items, providerType);
  if (providerType !== "claude_code") return models;

  return models.map((model) => {
    const defaults = createProviderModelConfig(providerType, model.id);
    const roundsToOneMillion =
      model.contextWindow < 1_000_000 && Math.round(model.contextWindow / 1_000) === 1_000;
    return defaults.contextWindow === 1_000_000 && roundsToOneMillion
      ? { ...model, contextWindow: defaults.contextWindow }
      : model;
  });
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.floor(numeric);
}

function normalizeGeminiModelId(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
}

function normalizeGeminiFetchedModels(items: unknown): ProviderModelConfig[] {
  if (!Array.isArray(items)) return [];

  const out: ProviderModelConfig[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const obj = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const supportedMethods = Array.isArray(obj.supportedGenerationMethods)
      ? obj.supportedGenerationMethods.filter((value): value is string => typeof value === "string")
      : [];
    if (supportedMethods.length > 0 && !supportedMethods.includes("generateContent")) {
      continue;
    }

    const id = normalizeGeminiModelId(obj.name ?? obj.id ?? obj.model);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const draft = createProviderModelConfig("gemini", id);
    const ownedBy =
      (typeof obj.ownedBy === "string" ? obj.ownedBy.trim() : "") ||
      (typeof obj.owned_by === "string" ? obj.owned_by.trim() : "");
    const contextWindow = normalizePositiveInteger(obj.inputTokenLimit);
    const maxOutputToken = normalizePositiveInteger(obj.outputTokenLimit);
    out.push({
      id,
      ...(ownedBy ? { ownedBy } : {}),
      contextWindow: contextWindow ?? draft.contextWindow,
      maxOutputToken: maxOutputToken ?? draft.maxOutputToken,
      limitsSource: contextWindow && maxOutputToken ? "provider" : draft.limitsSource,
    });
  }

  return out;
}

export function mergeFetchedModels(
  fetched: ProviderModelConfig[],
  existing: ProviderModelConfig[],
): ProviderModelConfig[] {
  const merged: ProviderModelConfig[] = [];
  const existingById = new Map(existing.map((model) => [model.id, model]));
  const seen = new Set<string>();

  for (const model of fetched) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    const existingModel = existingById.get(model.id);
    const shouldNormalizeOneMillion =
      existingModel !== undefined &&
      model.contextWindow === 1_000_000 &&
      existingModel.contextWindow < 1_000_000 &&
      Math.round(existingModel.contextWindow / 1_000) === 1_000;
    const shouldAdoptFreshProviderLimits =
      existingModel !== undefined &&
      model.limitsSource === "provider" &&
      existingModel.limitsSource !== "user";
    merged.push(
      existingModel
        ? {
            ...existingModel,
            ...(shouldNormalizeOneMillion ? { contextWindow: model.contextWindow } : {}),
            ...(shouldAdoptFreshProviderLimits
              ? {
                  contextWindow: model.contextWindow,
                  maxOutputToken: model.maxOutputToken,
                  limitsSource: "provider" as const,
                }
              : {}),
            ...(model.ownedBy ? { ownedBy: model.ownedBy } : {}),
          }
        : model,
    );
  }

  for (const model of existing) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    merged.push(model);
  }

  return merged;
}

export function sortModelsBySelection(
  models: ProviderModelConfig[],
  activeModels: ReadonlySet<string>,
): ProviderModelConfig[] {
  return sortModelsByActiveStateAndVendor(models, activeModels);
}

export function createDraftModelConfig(
  providerType: ProviderId,
  modelId: string,
): ProviderModelConfig {
  return createProviderModelConfig(providerType, modelId);
}

export function buildProviderModelsFetchKey(
  baseUrl: string,
  apiKey: string,
  useSystemProxy: boolean,
  authMode: ProviderAuthMode = "api-key",
  customHeaders?: CustomProvider["customHeaders"],
  oauthAccountId?: string,
  isFullUrl = false,
  modelsUrl?: string,
): string {
  const headerKey = (customHeaders ?? [])
    .map((header) => `${header.key.trim().toLowerCase()}:${header.value}`)
    .sort()
    .join("|");
  return `${baseUrl.trim()}||${apiKey.trim()}||${useSystemProxy ? "proxy" : "direct"}||${authMode}||${oauthAccountId?.trim() ?? ""}||${isFullUrl ? "full" : "base"}||${modelsUrl?.trim() ?? ""}||${headerKey}`;
}

export async function fetchModelsFromApi(
  type: ProviderId,
  baseUrl: string,
  apiKey: string,
  options?: ProviderModelsAuthOptions & { useSystemProxy?: boolean },
): Promise<ProviderModelConfig[]> {
  const normalizedUrl = normalizeProviderModelsBaseUrl(type, baseUrl, options?.isFullUrl === true);
  const exactModelsUrl = options?.modelsUrl?.trim();
  const normalizedApiKey = apiKey.trim();
  const attempts = buildProviderModelsAttempts(type, normalizedUrl, normalizedApiKey, options);
  const failures: ProviderModelsFailure[] = [];
  let emptyResult: ProviderModelConfig[] | null = null;

  for (const attempt of attempts) {
    const proxyRequest = await prepareProxyRequest(
      type,
      exactModelsUrl || normalizedUrl,
      attempt.headers,
      {
        useSystemProxy: options?.useSystemProxy === true,
        oauthAccountId: options?.authMode === "oauth-managed" ? options.oauthAccountId : undefined,
        providerConfigId: options?.providerConfigId,
        isFullUrl: Boolean(exactModelsUrl),
      },
    );
    const modelsUrl = exactModelsUrl
      ? proxyRequest.baseUrl
      : buildProviderModelsUrl(type, proxyRequest.baseUrl, attempt.kind);
    let requestUrl = modelsUrl;
    let requestHeaders = proxyRequest.headers;
    let attemptFailed = false;
    const allItems: unknown[] = [];
    const seenCursors = new Set<string>();

    for (let page = 0; page < 100; page += 1) {
      let response: Response;
      try {
        response = await fetch(requestUrl, { headers: requestHeaders });
      } catch (error) {
        failures.push({
          status: null,
          message: error instanceof Error ? error.message : String(error),
        });
        attemptFailed = true;
        break;
      }

      if (!response.ok) {
        failures.push({
          status: response.status,
          message: await readFetchError(response, `HTTP ${response.status} ${response.statusText}`),
        });
        attemptFailed = true;
        break;
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        failures.push({ status: null, message: "Model list response is not valid JSON" });
        attemptFailed = true;
        break;
      }

      const items = extractModelListItems(data);
      if (items === null) {
        emptyResult ??= [];
        break;
      }
      allItems.push(...items);

      const cursor = readModelPageCursor(data, type);
      if (!cursor || seenCursors.has(cursor.value)) break;
      seenCursors.add(cursor.value);
      if (exactModelsUrl) {
        requestHeaders = {
          ...requestHeaders,
          [XGENT_UPSTREAM_URL_HEADER]: withModelPageCursor(exactModelsUrl, cursor),
        };
      } else {
        requestUrl = withModelPageCursor(modelsUrl, cursor);
      }
    }

    if (attemptFailed) continue;
    const models = normalizeFetchedModels(allItems, type);
    if (models.length > 0) return models;
    emptyResult = models;
  }

  if (emptyResult !== null) return emptyResult;

  const failure = pickProviderModelsFailure(failures);
  throw new Error(failure?.message ?? "Failed to fetch model list");
}
