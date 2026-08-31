import type { Api, Model, OpenAIResponsesCompat } from "@earendil-works/pi-ai";
import type { CodexRequestFormat, PromptCacheHintMode, ProviderId } from "../../settings";
import { isRecord, normalizeSessionId } from "./common";
import type { StreamOptionsEx } from "./types";

const OPENAI_PROMPT_CACHE_KEY_MAX_CHARS = 64;
const OPENROUTER_SESSION_ID_MAX_CHARS = 256;

function clampPromptCacheKey(value: string): string {
  return value.length > OPENAI_PROMPT_CACHE_KEY_MAX_CHARS
    ? value.slice(0, OPENAI_PROMPT_CACHE_KEY_MAX_CHARS)
    : value;
}

function clampOpenRouterSessionId(value: string): string {
  return value.length > OPENROUTER_SESSION_ID_MAX_CHARS
    ? value.slice(0, OPENROUTER_SESSION_ID_MAX_CHARS)
    : value;
}

const OPENAI_PROMPT_CACHE_PAYLOAD_KEYS = [
  "prompt_cache_key",
  "prompt_cache_retention",
  "prompt_cache_options",
] as const;

function parseHostname(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isOfficialOpenAIHostname(hostname: string | undefined): boolean {
  return hostname === "api.openai.com" || Boolean(hostname?.endsWith(".api.openai.com"));
}

export function resolvePromptCacheHintMode(
  configuredMode: PromptCacheHintMode | undefined,
  baseUrl: string,
  modelApi?: CodexRequestFormat,
): Exclude<PromptCacheHintMode, "auto"> {
  if (configuredMode && configuredMode !== "auto") return configuredMode;

  if (modelApi === "openai-responses") return "openai-key";
  const hostname = parseHostname(baseUrl);
  if (isOfficialOpenAIHostname(hostname)) {
    return "openai-key";
  }
  if (hostname === "openrouter.ai" || hostname?.endsWith(".openrouter.ai")) {
    return "openrouter-session";
  }
  // OpenAI-compatible relays commonly implement the same stable cache key even
  // when they do not expose a separate capability endpoint.  Users can still
  // disable it explicitly with promptCacheHintMode/cacheRetention = none.
  return "openai-key";
}

function isExplicitNoCacheOptions(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).mode === "explicit"
  );
}

function supportsExplicitNoCache(baseUrl: string, model: Model<Api> | undefined): boolean {
  if (!model || model.api !== "openai-responses") return false;
  if (!isOfficialOpenAIHostname(parseHostname(baseUrl))) return false;
  const compat = model.compat as
    | (OpenAIResponsesCompat & { supportsExplicitPromptCacheMode?: boolean })
    | undefined;
  return compat?.supportsExplicitPromptCacheMode === true;
}

function stripOpenAIPromptCacheFields(
  payload: Record<string, unknown>,
  preserveExplicitNoCache: boolean,
) {
  const keysToStrip = OPENAI_PROMPT_CACHE_PAYLOAD_KEYS.filter((key) => {
    if (payload[key] === undefined) return false;
    return !(
      key === "prompt_cache_options" &&
      preserveExplicitNoCache &&
      isExplicitNoCacheOptions(payload[key])
    );
  });
  if (keysToStrip.length === 0) return payload;
  const nextPayload = { ...payload };
  for (const key of keysToStrip) delete nextPayload[key];
  return nextPayload;
}

function findExistingSessionHeader(headers: StreamOptionsEx["headers"]): string | undefined {
  if (!headers) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "x-session-id") {
      return typeof value === "string" ? value : "";
    }
  }
  return undefined;
}

export function describeCodexCacheShape(
  providerId: ProviderId,
  baseUrl: string,
  configuredMode: PromptCacheHintMode | undefined,
  modelApi: CodexRequestFormat | undefined,
  sessionId: string | undefined,
  cacheRetention?: string,
  headers?: StreamOptionsEx["headers"],
): { cacheRetention?: string; ttl?: string; breakpointStrategy?: string; cacheKey?: string } {
  if (providerId !== "codex") {
    return { cacheRetention: cacheRetention ?? "", breakpointStrategy: "none" };
  }
  const mode =
    cacheRetention === "none"
      ? "none"
      : resolvePromptCacheHintMode(configuredMode, baseUrl, modelApi);
  const normalizedSessionId = normalizeSessionId(sessionId);

  const existingSessionHeader =
    mode === "openrouter-session" ? findExistingSessionHeader(headers) : undefined;

  return {
    cacheRetention: cacheRetention ?? "",
    breakpointStrategy: mode === "none" ? "none" : `codex-${mode}`,
    cacheKey:
      mode === "openai-key" && normalizedSessionId
        ? clampPromptCacheKey(normalizedSessionId)
        : mode === "openrouter-session"
          ? (existingSessionHeader ??
            (normalizedSessionId ? clampOpenRouterSessionId(normalizedSessionId) : ""))
          : "",
  };
}

export function attachCodexPromptCacheHint(
  providerId: ProviderId,
  baseUrl: string,
  configuredMode: PromptCacheHintMode | undefined,
  model: Model<Api> | undefined,
  options: StreamOptionsEx,
): StreamOptionsEx {
  if (providerId !== "codex") return options;
  const mode =
    options.cacheRetention === "none"
      ? "none"
      : resolvePromptCacheHintMode(configuredMode, baseUrl, model?.api as CodexRequestFormat);
  const sessionId = normalizeSessionId(options.sessionId);
  const effectiveCacheRetention = mode === "none" ? "none" : options.cacheRetention;

  const previousOnPayload = options.onPayload;
  return {
    ...options,

    cacheRetention: effectiveCacheRetention,
    headers:
      mode === "openrouter-session" &&
      sessionId &&
      findExistingSessionHeader(options.headers) === undefined
        ? { ...options.headers, "x-session-id": clampOpenRouterSessionId(sessionId) }
        : options.headers,
    onPayload: async (payload, model) => {
      let nextPayload = payload;
      if (previousOnPayload) {
        const overridden = await previousOnPayload(nextPayload, model);
        if (overridden !== undefined) {
          nextPayload = overridden;
        }
      }

      if (!isRecord(nextPayload)) return nextPayload;

      if (
        mode === "openai-key" &&
        sessionId &&
        (model.api === "openai-responses" || model.api === "openai-completions") &&
        typeof nextPayload.prompt_cache_key !== "string"
      ) {
        return {
          ...nextPayload,
          prompt_cache_key: clampPromptCacheKey(sessionId),
        };
      }

      return mode === "openai-key"
        ? nextPayload
        : stripOpenAIPromptCacheFields(
            nextPayload,
            effectiveCacheRetention === "none" && supportsExplicitNoCache(baseUrl, model),
          );
    },
  };
}
