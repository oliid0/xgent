import type { BackgroundExecutionLease } from "./types";

/** Capture native-issued execution authority once, outside model arguments. */
export function captureBackgroundLease(lease: BackgroundExecutionLease | undefined) {
  if (
    !lease ||
    !Number.isSafeInteger(lease.attempt) ||
    lease.attempt < 1 ||
    !Number.isSafeInteger(lease.generation) ||
    lease.generation < 1 ||
    typeof lease.token !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(lease.token)
  )
    throw new Error("Background execution requires a valid native attempt/generation lease");
  return Object.freeze({
    attempt: lease.attempt,
    generation: lease.generation,
    token: lease.token,
  });
}
