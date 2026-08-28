import type { ProviderRetryPolicy } from "../../settings";
import type { StreamRetryConfig } from "./streamRetry";

export function resolveStreamRetryConfig(
  retryPolicy: ProviderRetryPolicy | undefined,
): Pick<StreamRetryConfig, "maxAttempts" | "disabled"> {
  if (!retryPolicy) return {};
  if (retryPolicy.mode === "off") return { disabled: true };
  return { maxAttempts: retryPolicy.maxRetries + 1 };
}
