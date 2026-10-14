import { normalizeBrowserAddress } from "./browser/browserSessionController";

export type LocalAccessDevice = {
  deviceId: string;
  label: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
};

export type LocalAccessStatus = {
  enabled: boolean;
  running: boolean;
  bindAddress: string;
  port: number;
  urls: string[];
  tailscale?: TailscaleStatus | null;
  pairedDevices: number;
  devices: LocalAccessDevice[];
  pairingCode?: string | null;
  pairingCodeExpiresAt?: number | null;
  lastError?: string | null;
};

export type TailscaleStatus = {
  engine?: "embedded-rust";
  canAuthenticate?: boolean;
  canLogout?: boolean;
  state: string;
  addresses: string[];
  dnsName?: string | null;
  observedAt: number;
};

const TAILSCALE_STATES: Record<string, string> = {
  "login-required": "settings.tailscaleLoginRequired",
  "approval-required": "settings.tailscaleApprovalRequired",
  stopped: "settings.tailscaleStopped",
  starting: "settings.tailscaleStarting",
  running: "settings.tailscaleRunning",
  offline: "settings.tailscaleOffline",
  unknown: "settings.tailscaleUnknown",
};

/** The same embedded-node observation on desktop and mobile. */
export function tailscaleStatusText(
  status: TailscaleStatus | null | undefined,
  t: (key: string) => string,
) {
  const state = typeof status?.state === "string" ? status.state : "unknown";
  const key = Object.hasOwn(TAILSCALE_STATES, state)
    ? TAILSCALE_STATES[state]
    : TAILSCALE_STATES.unknown;
  const addresses =
    status?.state === "running" && Array.isArray(status.addresses)
      ? status.addresses
          .filter((address) => typeof address === "string" && address.length <= 64)
          .slice(0, 8)
      : [];
  const checked =
    status && Number.isFinite(status.observedAt) && status.observedAt > 0
      ? t("settings.tailscaleChecked").replace(
          "{time}",
          new Date(status.observedAt).toLocaleString(),
        )
      : "";
  return [t(key), ...addresses, checked].filter(Boolean).join(" · ");
}

export type LanPcClientStatus = {
  paired: boolean;
  baseUrl?: string | null;
  deviceId?: string | null;
  expiresAt?: number | null;
  workerRegistrationError?: string;
};

export type CloudSecretVaultStatus = {
  githubTokenConfigured: boolean;
  githubUsername?: string | null;
  githubOauthAccount?: import("./connectors/githubAuthorization").GitHubOAuthAccount | null;
};

// Both UIs must use the Rust pairing endpoint as the authoritative address.
export function normalizeLanControlUrl(value: string) {
  const raw = normalizeBrowserAddress(value);
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The computer address must use HTTP or HTTPS.");
  }
  if (url.username || url.password)
    throw new Error("The computer address must not contain credentials.");
  const explicitHttpDefault =
    url.protocol === "http:" && /:0*80$/.test(raw.split("://")[1]?.split(/[/?#]/)[0] ?? "");
  if (url.protocol === "http:" && !url.port && !explicitHttpDefault) url.port = "28367";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return explicitHttpDefault ? `http://${url.hostname}:80/` : url.toString();
}

export function normalizeComparableLanUrl(value?: string | null) {
  if (!value?.trim()) return "";
  try {
    return normalizeLanControlUrl(value).replace(/\/$/, "");
  } catch {
    return "";
  }
}
