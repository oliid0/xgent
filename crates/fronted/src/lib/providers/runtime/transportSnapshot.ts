import { XAGENT_UPSTREAM_ORIGIN_HEADER, XAGENT_USE_SYSTEM_PROXY_HEADER } from "../proxy";

/**
 * Sanitized transport metadata for one concrete outbound attempt.
 * Header values are deliberately never retained.
 */
export type TransportSnapshot = {
  upstreamOrigin?: string;
  useSystemProxy: boolean;
  fullUrl: boolean;
  headerNames: readonly string[];
};

export function captureTransportSnapshot(
  headers: Record<string, string | null> | undefined,
  fullUrl = false,
): TransportSnapshot {
  const byLowerName = new Map<string, string>();
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value === null) continue;
    byLowerName.set(name.toLowerCase(), value);
  }
  const upstreamOrigin = byLowerName.get(XAGENT_UPSTREAM_ORIGIN_HEADER)?.trim();
  return {
    ...(upstreamOrigin ? { upstreamOrigin } : {}),
    useSystemProxy: byLowerName.get(XAGENT_USE_SYSTEM_PROXY_HEADER) === "1",
    fullUrl,
    headerNames: [...byLowerName.keys()].sort(),
  };
}
