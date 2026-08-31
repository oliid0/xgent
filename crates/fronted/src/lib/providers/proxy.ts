import { invoke } from "@xagent/runtime";

import type { ProviderId } from "../settings";
import { readHeaderValue } from "./customHeaders";

export const XAGENT_PROXY_TOKEN_HEADER = "x-xagent-proxy-token";
export const XAGENT_UPSTREAM_ORIGIN_HEADER = "x-xagent-upstream-origin";
export const XAGENT_UPSTREAM_URL_HEADER = "x-xagent-upstream-url";
export const XAGENT_UPSTREAM_USER_AGENT_HEADER = "x-xagent-upstream-user-agent";
export const XAGENT_UPSTREAM_CONTENT_TYPE_HEADER = "x-xagent-upstream-content-type";
export const XAGENT_OAUTH_ACCOUNT_ID_HEADER = "x-xagent-oauth-account-id";
export const XAGENT_PROVIDER_CONFIG_ID_HEADER = "x-xagent-provider-config-id";
// 布尔标记头：声明该请求经系统代理出网。代理地址/凭据只存于桌面 Rust 侧，
// 由本地反代按此头选择带代理的 client（x-xagent-* 头不会转发给上游）。
export const XAGENT_USE_SYSTEM_PROXY_HEADER = "x-xagent-use-system-proxy";

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
    ...(userAgent !== undefined ? { [XAGENT_UPSTREAM_USER_AGENT_HEADER]: userAgent } : {}),
    ...(contentType !== undefined ? { [XAGENT_UPSTREAM_CONTENT_TYPE_HEADER]: contentType } : {}),
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

/** 各代理入口共用的 URL 安全校验：绝对地址 + http(s) + 禁内嵌凭据。 */
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

/** 本地反代的路径段仅用于区分链路（Rust 侧不校验取值），hub = 商店类出网。 */
const HUB_PROXY_ROUTE = "hub";

/**
 * 把任意完整上游 URL 改写为经本地反代的请求：路径与查询原样保留，
 * origin 移入 upstream-origin 头。恒带 use-system-proxy —— 反代按应用代理
 * 配置出网（未启用=直连，配置异常 502 fail fast，绝不静默降级为直连）。
 */
export async function prepareUpstreamProxyRequest(
  targetUrl: string,
): Promise<PreparedUpstreamProxyRequest> {
  const parsed = parseAbsoluteHttpUrl(targetUrl, "Upstream URL");
  // “//” 开头的 pathname 会被 Rust 侧 Url::join 当作 scheme-relative 引用
  // 改写上游主机，必须拒绝（Rust build_target_url 另有同款后盾）。
  if (parsed.pathname.startsWith("//")) {
    throw new Error("Upstream URL path must not begin with //");
  }

  const proxyServerInfo = await getProxyServerInfo();
  // 根路径映射为空串：/proxy/hub/ 不匹配任何反代路由（{*rest} 要求非空），
  // /proxy/hub 才会被 build_target_url 还原成上游的 “/”。
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname;
  return {
    url: `${proxyServerInfo.baseUrl}/proxy/${HUB_PROXY_ROUTE}${pathname}${parsed.search}`,
    headers: {
      [XAGENT_UPSTREAM_ORIGIN_HEADER]: parsed.origin,
      [XAGENT_PROXY_TOKEN_HEADER]: proxyServerInfo.token,
      [XAGENT_USE_SYSTEM_PROXY_HEADER]: "1",
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
      [XAGENT_UPSTREAM_ORIGIN_HEADER]: upstreamOrigin,
      ...(upstreamUrl ? { [XAGENT_UPSTREAM_URL_HEADER]: upstreamUrl } : {}),
      [XAGENT_PROXY_TOKEN_HEADER]: proxyServerInfo.token,
      ...(options?.useSystemProxy ? { [XAGENT_USE_SYSTEM_PROXY_HEADER]: "1" } : {}),
      ...(options?.oauthAccountId?.trim()
        ? { [XAGENT_OAUTH_ACCOUNT_ID_HEADER]: options.oauthAccountId.trim() }
        : {}),
      ...(options?.providerConfigId?.trim()
        ? { [XAGENT_PROVIDER_CONFIG_ID_HEADER]: options.providerConfigId.trim() }
        : {}),
    },
  };
}
