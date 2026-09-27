import { invoke } from "@xgent/runtime";

export type MobileStartupPhase = "starting" | "ready" | "degraded";

export type MobileStartupStatus = {
  phase: MobileStartupPhase;
  failures: string[];
  coreReady: boolean;
};

/** Completed native startup may be degraded without blocking independent features. */
export function mobileStartupFinished(status: MobileStartupStatus): boolean {
  return status.phase !== "starting";
}

export async function readMobileStartupStatus(): Promise<MobileStartupStatus> {
  const status = await invoke<MobileStartupStatus>("app_mobile_startup_status");
  if (
    !status ||
    !["starting", "ready", "degraded"].includes(status.phase) ||
    !Array.isArray(status.failures) ||
    typeof status.coreReady !== "boolean"
  ) {
    throw new Error("The native shell returned an invalid mobile startup status");
  }
  return status;
}
