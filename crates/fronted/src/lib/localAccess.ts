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
  pairedDevices: number;
  devices: LocalAccessDevice[];
  pairingCode?: string | null;
  pairingCodeExpiresAt?: number | null;
  lastError?: string | null;
};

export type LanPcClientStatus = {
  paired: boolean;
  baseUrl?: string | null;
  deviceId?: string | null;
  expiresAt?: number | null;
};

export type CloudSecretVaultStatus = {
  githubTokenConfigured: boolean;
  githubUsername?: string | null;
};

// Both UIs must use the Rust pairing endpoint as the authoritative address.
export function normalizeLanControlUrl(value: string) {
  const url = new URL(normalizeBrowserAddress(value));
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The computer address must use HTTP or HTTPS.");
  }
  if (url.protocol === "http:" && !url.port) url.port = "28367";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function normalizeComparableLanUrl(value?: string | null) {
  if (!value?.trim()) return "";
  try {
    return normalizeLanControlUrl(value).replace(/\/$/, "");
  } catch {
    return "";
  }
}
