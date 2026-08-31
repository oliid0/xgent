import { invoke } from "@xgent/runtime";

import type { ProviderId } from "../settings";
import { readHeaderValue } from "./customHeaders";

export const XGENT_PROXY_TOKEN_HEADER = "x-xgent-proxy-token";
export const XGENT_UPSTREAM_ORIGIN_HEADER = "x-xgent-upstream-origin";
export const XGENT_UPSTREAM_URL_HEADER = "x-xgent-upstream-url";
export const XGENT_UPSTREAM_USER_AGENT_HEADER = "x-xgent-upstream-user-agent";
export const XGENT_UPSTREAM_CONTENT_TYPE_HEADER = "x-xgent-upstream-content-type";
export const XGENT_OAUTH_ACCOUNT_ID_HEADER = "x-xgent-oauth-account-id";
export const XGENT_PROVIDER_CONFIG_ID_HEADER = "x-xgent-provider-config-id";

export const XGENT_USE_SYSTEM_PROXY_HEADER = "x-xgent-use-system-proxy";

type ProxyServerInfo = {
  baseUrl: string;
  token: string;
};

export type PreparedProxyRequest = {
  baseUrl: string;
  headers: Record<string, string>;
};

export function buildUpstreamHeaderOverrideHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const userAgent = readHeaderValue(headers, "user-agent");
  const contentType = readHeaderValue(headers, "content-type");
  return {
    ...(userAgent !== undefined ? { [XGENT_UPSTREAM_USER_AGENT_HEADER]: userAgent } : {}),
    ...(contentType !== undefined ? { [XGENT_UPSTREAM_CONTENT_TYPE_HEADER]: contentType } : {}),
  };
}

let proxyServerInfoPromise: Promise<ProxyServerInfo> | null = null;

export function resolveProxyServerBaseUrl(
  rawBaseUrl: string,
  browserOrigin = typeof window !== "undefined" ? window.location?.origin : undefined,
): string {
  const trimmed = String(rawBaseUrl ?? "").trim();
  if (!trimmed) throw new Error("Local proxy base URL is empty");

  let parsed: URL;
  try {
    parsed = new URL(trimmed, browserOrigin);
  } catch (error) {
    throw new Error(
      `Local proxy base URL must be absolute: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!matchesHttpProtocol(parsed.protocol) || !parsed.host) {
    throw new Error("Local proxy base URL must start with http:// or https://");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeProxyServerInfo(info: ProxyServerInfo): ProxyServerInfo {
  const baseUrl = resolveProxyServerBaseUrl(info.baseUrl);
  const token = String(info.token ?? "").trim();

  if (!token) {
    throw new Error("Local proxy token is empty");
  }

  return {
    baseUrl,
    token,
  };
}

async function getProxyServerInfo(): Promise<ProxyServerInfo> {
  if (!proxyServerInfoPromise) {
    proxyServerInfoPromise = invoke<ProxyServerInfo>("proxy_get_server_info")
      .then(normalizeProxyServerInfo)
      .catch((error) => {
        proxyServerInfoPromise = null;
        throw new Error(
          `Failed to get local proxy info: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  return proxyServerInfoPromise;
}

function parseAbsoluteHttpUrl(rawUrl: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new Error(
      `${label} must be an absolute URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must start with http:// or https://`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} cannot include embedded username or password`);
  }
  return parsed;
}

function matchesHttpProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

export function buildProxyBaseUrl(
  providerId: ProviderId,
  upstreamBaseUrl: string,
  proxyServerBaseUrl: string,
  options?: { isFullUrl?: boolean },
): { baseUrl: string; upstreamOrigin: string; upstreamUrl?: string } {
  const normalizedUpstream = upstreamBaseUrl.trim();
  if (!normalizedUpstream) {
    throw new Error("Base URL cannot be empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedUpstream);
  } catch (error) {
    throw new Error(
      `Base URL must be an absolute URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error("Base URL cannot include embedded username or password");
  }
  if (parsed.hash) {
    throw new Error("Base URL cannot include a fragment");
  }
  if (!options?.isFullUrl && parsed.search) {
    throw new Error("Base URL cannot include query parameters or fragments");
  }

  const normalizedProxyServerBaseUrl = resolveProxyServerBaseUrl(proxyServerBaseUrl);
  if (options?.isFullUrl) {
    return {
      baseUrl: `${normalizedProxyServerBaseUrl}/proxy/${providerId}`,
      upstreamOrigin: parsed.origin,
      upstreamUrl: parsed.toString(),
    };
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");

  return {
    baseUrl: `${normalizedProxyServerBaseUrl}/proxy/${providerId}${pathname}`,
    upstreamOrigin: parsed.origin,
  };
}

export function buildImageProxyUrl(imageUrl: string, proxyServerBaseUrl: string): string {
  const normalizedImageUrl = imageUrl.trim();
  if (!normalizedImageUrl) {
    throw new Error("Image URL cannot be empty");
  }

  const parsed = parseAbsoluteHttpUrl(normalizedImageUrl, "Image URL");

  const normalizedProxyServerBaseUrl = resolveProxyServerBaseUrl(proxyServerBaseUrl);
  return `${normalizedProxyServerBaseUrl}/image-proxy?url=${encodeURIComponent(parsed.toString())}`;
}

export async function prepareImageProxyUrl(imageUrl: string): Promise<string> {
  const proxyServerInfo = await getProxyServerInfo();
  return buildImageProxyUrl(imageUrl, proxyServerInfo.baseUrl);
}

export type PreparedUpstreamProxyRequest = {
  url: string;
  headers: Record<string, string>;
};

const HUB_PROXY_ROUTE = "hub";

export async function prepareUpstreamProxyRequest(
  targetUrl: string,
): Promise<PreparedUpstreamProxyRequest> {
  const parsed = parseAbsoluteHttpUrl(targetUrl, "Upstream URL");

  if (parsed.pathname.startsWith("//")) {
    throw new Error("Upstream URL path must not begin with //");
  }

  const proxyServerInfo = await getProxyServerInfo();

  const pathname = parsed.pathname === "/" ? "" : parsed.pathname;
  return {
    url: `${proxyServerInfo.baseUrl}/proxy/${HUB_PROXY_ROUTE}${pathname}${parsed.search}`,
    headers: {
      [XGENT_UPSTREAM_ORIGIN_HEADER]: parsed.origin,
      [XGENT_PROXY_TOKEN_HEADER]: proxyServerInfo.token,
      [XGENT_USE_SYSTEM_PROXY_HEADER]: "1",
    },
  };
}

export async function prepareProxyRequest(
  providerId: ProviderId,
  upstreamBaseUrl: string,
  headers: Record<string, string>,
  options?: {
    useSystemProxy?: boolean;
    oauthAccountId?: string;
    providerConfigId?: string;
    isFullUrl?: boolean;
  },
): Promise<PreparedProxyRequest> {
  const proxyServerInfo = await getProxyServerInfo();
  const { baseUrl, upstreamOrigin, upstreamUrl } = buildProxyBaseUrl(
    providerId,
    upstreamBaseUrl,
    proxyServerInfo.baseUrl,
    { isFullUrl: options?.isFullUrl },
  );

  return {
    baseUrl,
    headers: {
      ...headers,
      ...buildUpstreamHeaderOverrideHeaders(headers),
      [XGENT_UPSTREAM_ORIGIN_HEADER]: upstreamOrigin,
      ...(upstreamUrl ? { [XGENT_UPSTREAM_URL_HEADER]: upstreamUrl } : {}),
      [XGENT_PROXY_TOKEN_HEADER]: proxyServerInfo.token,
      ...(options?.useSystemProxy ? { [XGENT_USE_SYSTEM_PROXY_HEADER]: "1" } : {}),
      ...(options?.oauthAccountId?.trim()
        ? { [XGENT_OAUTH_ACCOUNT_ID_HEADER]: options.oauthAccountId.trim() }
        : {}),
      ...(options?.providerConfigId?.trim()
        ? { [XGENT_PROVIDER_CONFIG_ID_HEADER]: options.providerConfigId.trim() }
        : {}),
    },
  };
}
