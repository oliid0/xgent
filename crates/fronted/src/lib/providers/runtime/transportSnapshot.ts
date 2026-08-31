import { XGENT_UPSTREAM_ORIGIN_HEADER, XGENT_USE_SYSTEM_PROXY_HEADER } from "../proxy";

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
  const upstreamOrigin = byLowerName.get(XGENT_UPSTREAM_ORIGIN_HEADER)?.trim();
  return {
    ...(upstreamOrigin ? { upstreamOrigin } : {}),
    useSystemProxy: byLowerName.get(XGENT_USE_SYSTEM_PROXY_HEADER) === "1",
    fullUrl,
    headerNames: [...byLowerName.keys()].sort(),
  };
}
