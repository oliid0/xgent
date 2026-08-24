import type { CacheRetention, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type {
  CodexRequestFormat,
  ProviderAuthMode,
  ProviderId,
  ReasoningLevel,
} from "../../settings";
import { createUuid } from "../../shared/id";
import {
  ANTHROPIC_DEFAULT_REQUEST_HEADERS,
  CODEX_CONVERSATION_ID_HEADER,
  CODEX_SESSION_ID_HEADER,
  isAnthropicOAuthApiKey,
  mergeCustomHeaders,
} from "../customHeaders";
import {
  normalizeDeepSeekResponsesBaseUrl,
  normalizeDeepSeekResponsesEndpoint,
} from "../deepSeekNative";
import { type PreparedProxyRequest, prepareProxyRequest } from "../proxy";
import { normalizeSessionId } from "./common";
import type { ProviderRuntimeConfig } from "./types";

export { isValidCustomHeaderKey } from "../customHeaders";

export function buildAnthropicAuthHeaders(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey };
}

export function buildOpenAIAuthHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

/** Compatibility helper for callers that intentionally target dual-auth relays. */
export function buildDualAuthHeaders(apiKey: string): Record<string, string> {
  return { ...buildOpenAIAuthHeaders(apiKey), ...buildAnthropicAuthHeaders(apiKey) };
}

export function buildGeminiAuthHeaders(apiKey: string): Record<string, string> {
  return { "x-goog-api-key": apiKey };
}

function buildProviderAuthHeaders(providerId: ProviderId, apiKey: string): Record<string, string> {
  if (providerId === "gemini") return buildGeminiAuthHeaders(apiKey);
  if (providerId === "claude_code") return buildAnthropicAuthHeaders(apiKey);
  return buildOpenAIAuthHeaders(apiKey);
}

export function buildProviderRequestHeaders(
  providerId: ProviderId,
  apiKey: string,
  sessionId?: string,
  requestFormat?: CodexRequestFormat,
  authMode: ProviderAuthMode = "api-key",
): Record<string, string> {
  const authHeaders =
    authMode === "oauth-managed"
      ? {}
      : authMode === "oauth-token" && providerId !== "gemini"
        ? { Authorization: `Bearer ${apiKey}` }
        : buildProviderAuthHeaders(providerId, apiKey);

  if (providerId === "claude_code") {
    if (isAnthropicOAuthApiKey(apiKey)) return {};
    return { ...authHeaders, ...ANTHROPIC_DEFAULT_REQUEST_HEADERS };
  }

  if (providerId === "codex") {
    // Chat Completions is stateless. Codex session headers are only valid for
    // Responses requests and must never leak into the completions endpoint.
    if (requestFormat === "openai-completions") return authHeaders;
    const requestSessionId = normalizeSessionId(sessionId) ?? createUuid();
    return {
      ...authHeaders,
      [CODEX_SESSION_ID_HEADER]: requestSessionId,
      [CODEX_CONVERSATION_ID_HEADER]: requestSessionId,
    };
  }

  return authHeaders;
}

/** Build the provider URL, auth/custom headers and optional native proxy route. */
export async function prepareProviderRequest(
  providerId: ProviderId,
  runtime: ProviderRuntimeConfig,
  options?: { sessionId?: string },
): Promise<PreparedProxyRequest> {
  const upstreamBaseUrl =
    providerId === "deepseek"
      ? runtime.isFullUrl
        ? normalizeDeepSeekResponsesEndpoint(runtime.baseUrl)
        : normalizeDeepSeekResponsesBaseUrl(runtime.baseUrl)
      : runtime.baseUrl;
  return prepareProxyRequest(
    providerId,
    upstreamBaseUrl.trim(),
    mergeCustomHeaders(
      buildProviderRequestHeaders(
        providerId,
        runtime.apiKey,
        options?.sessionId,
        runtime.requestFormat,
        runtime.authMode,
      ),
      runtime.customHeaders,
    ),
    {
      useSystemProxy: runtime.useSystemProxy === true,
      oauthAccountId: runtime.authMode === "oauth-managed" ? runtime.oauthAccountId : undefined,
    },
  );
}

export function toSimpleStreamReasoning(
  reasoning: ReasoningLevel | undefined,
): SimpleStreamOptions["reasoning"] | undefined {
  return reasoning && reasoning !== "off" ? reasoning : undefined;
}

export function resolveProviderCacheRetention(
  providerId: ProviderId,
  promptCachingEnabled?: boolean,
  requestOverride?: CacheRetention,
  providerPreference?: CacheRetention,
): CacheRetention | undefined {
  if (providerId !== "claude_code" && providerId !== "codex") return undefined;
  if (providerId === "codex") {
    if (requestOverride) return requestOverride;
    return promptCachingEnabled === false ? "none" : "short";
  }
  if (promptCachingEnabled === false) return "none";
  if (requestOverride) return requestOverride;
  if (providerPreference === "long") return "long";
  return "short";
}

export function buildProviderRequestMetadata(
  providerId: ProviderId,
  sessionId?: string,
): Record<string, unknown> | undefined {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (providerId !== "claude_code" || !normalizedSessionId) return undefined;
  return { user_id: normalizedSessionId };
}
