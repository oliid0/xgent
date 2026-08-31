import { invoke, isTauriRuntime } from "@xgent/runtime";

export type RuntimePlatform = "windows" | "macos" | "linux" | "android" | "ios";

type RuntimePlatformResponse = {
  platform?: unknown;
};

let resolvedRuntimePlatform: RuntimePlatform | undefined;

export function normalizeRuntimePlatform(value: unknown): RuntimePlatform | undefined {
  if (
    value === "windows" ||
    value === "macos" ||
    value === "linux" ||
    value === "android" ||
    value === "ios"
  ) {
    return value;
  }
  return undefined;
}

export function inferRuntimePlatform(): RuntimePlatform {
  const touchPoints = typeof navigator !== "undefined" ? (navigator.maxTouchPoints ?? 0) : 0;
  const nav =
    typeof navigator !== "undefined"
      ? `${navigator.userAgent || ""} ${navigator.platform || ""}`
      : "";
  if (/Android/i.test(nav)) return "android";
  // iPadOS can request a desktop user agent and report MacIntel. Touch points
  // distinguish that shell from an actual macOS desktop before IPC resolves.
  if (/iPhone|iPad|iPod/i.test(nav) || (/Mac/i.test(nav) && touchPoints > 1)) return "ios";
  if (/\bWindows\b|Win32|Win64|WOW64/i.test(nav)) return "windows";
  if (/Mac/i.test(nav)) return "macos";
  return "linux";
}

export function runtimePlatformLabel(platform: RuntimePlatform) {
  if (platform === "windows") return "Windows";
  if (platform === "macos") return "macOS";
  if (platform === "android") return "Android";
  if (platform === "ios") return "iOS/iPadOS";
  return "Linux";
}

export async function resolveRuntimePlatform(): Promise<RuntimePlatform> {
  try {
    const response = await invoke<RuntimePlatformResponse>("app_runtime_platform");
    resolvedRuntimePlatform =
      normalizeRuntimePlatform(response?.platform) ?? inferRuntimePlatform();
  } catch {
    resolvedRuntimePlatform = inferRuntimePlatform();
  }
  return resolvedRuntimePlatform;
}

/**
 * Distinguishes an installed Android/iOS shell from the browser Web UI.
 * A mobile browser remains a remote view of the desktop host and therefore
 * retains the host's capabilities.
 */
export function isNativeMobileRuntime() {
  if (!isTauriRuntime()) return false;
  const platform = resolvedRuntimePlatform ?? inferRuntimePlatform();
  return platform === "android" || platform === "ios";
}
