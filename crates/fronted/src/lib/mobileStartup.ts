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
    status.failures.some((failure) => typeof failure !== "string") ||
    typeof status.coreReady !== "boolean"
  ) {
    throw new Error("The native shell returned an invalid mobile startup status");
  }
  return status;
}

/** Startup can recover after a timeout or IPC error; retired owners cannot publish. */
export function startMobileStartupPolling(
  onStatus: (status: MobileStartupStatus) => void,
  options: {
    read?: () => Promise<MobileStartupStatus>;
    clock?: {
      now: () => number;
      set: (run: () => void, delay: number) => number;
      clear: (timer: number) => void;
    };
  } = {},
) {
  const read = options.read ?? readMobileStartupStatus;
  const clock = options.clock ?? {
    now: () => Date.now(),
    set: (run: () => void, delay: number) => window.setTimeout(run, delay),
    clear: (timer: number) => window.clearTimeout(timer),
  };
  const deadline = clock.now() + 30_000;
  let cancelled = false,
    retryTimer: number | undefined,
    reported: string | undefined;
  const degraded = (failures: string[]) => {
    const fingerprint = JSON.stringify(failures);
    if (reported === fingerprint) return;
    reported = fingerprint;
    console.warn("Mobile service initialization has not finished", failures);
    onStatus({ phase: "degraded", failures, coreReady: false });
  };
  const poll = async () => {
    try {
      const status = await read();
      if (cancelled) return;
      if (mobileStartupFinished(status)) {
        if (status.failures.length > 0)
          console.warn("Mobile services started in degraded mode", status.failures);
        onStatus(status);
        return;
      }
      if (clock.now() >= deadline) {
        degraded(["Native service initialization did not finish within 30 seconds"]);
        retryTimer = clock.set(() => void poll(), 1_000);
      } else retryTimer = clock.set(() => void poll(), 100);
    } catch (error) {
      if (cancelled) return;
      if (clock.now() >= deadline) {
        degraded([error instanceof Error ? error.message : String(error)]);
        retryTimer = clock.set(() => void poll(), 1_000);
      } else retryTimer = clock.set(() => void poll(), 250);
    }
  };
  void poll();
  return () => {
    cancelled = true;
    if (retryTimer !== undefined) clock.clear(retryTimer);
  };
}
