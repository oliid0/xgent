import { invokeNative } from "@xgent/runtime";
import type { TailscaleStatus } from "./localAccess";

export type TailscaleAuthMode = "auth-key" | "oauth";
export type TailscaleAuthInput = {
  mode: TailscaleAuthMode;
  credential: string;
  tags: string[];
};

export function tailscaleAuthInput(mode: TailscaleAuthMode, credential: string, tags: string) {
  const value = credential.trim();
  const prefix = mode === "oauth" ? "tskey-client-" : "tskey-auth-";
  const selectedTags = tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (
    !["auth-key", "oauth"].includes(mode) ||
    !value.startsWith(prefix) ||
    value.length <= prefix.length ||
    value.length > 4096 ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    selectedTags.length > 16 ||
    new Set(selectedTags).size !== selectedTags.length ||
    selectedTags.some((tag) => !/^tag:[A-Za-z][A-Za-z0-9-]{0,59}$/.test(tag))
  )
    throw new Error("tailscale-invalid-input");
  if (mode === "oauth" && !selectedTags.length) throw new Error("tailscale-tags-required");
  return { mode, credential: value, tags: selectedTags } satisfies TailscaleAuthInput;
}

export function tailscaleErrorMessage(error: unknown, t: (key: string) => string) {
  const code = error instanceof Error ? error.message : String(error);
  const keys: Record<string, string> = {
    "tailscale-invalid-input": "settings.tailscaleInvalidInput",
    "tailscale-tags-required": "settings.tailscaleTagsRequired",
    "tailscale-busy": "settings.tailscaleBusy",
    "tailscale-routes-unavailable": "settings.tailscaleUnknown",
    "tailscale-engine-unavailable": "settings.tailscaleUnknown",
    "tailscale-timed-out": "settings.tailscaleTimedOut",
    "tailscale-credential-file": "settings.tailscaleCredentialFile",
  };
  return t(keys[code] ?? "settings.tailscaleCommandFailed");
}

/** These actions always target this native installation, never a selected PC. */
export const tailscaleSetup = {
  status: () => invokeNative<TailscaleStatus>("tailscale_setup_status"),
  authenticate: (input: TailscaleAuthInput) =>
    invokeNative<TailscaleStatus>("tailscale_authenticate", { input }),
  logout: () => invokeNative<TailscaleStatus>("tailscale_logout"),
};
