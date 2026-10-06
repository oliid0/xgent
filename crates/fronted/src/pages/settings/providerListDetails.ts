import type { ProviderUsageResult } from "../../lib/providers/usageQuery";
import type { CustomProvider } from "../../lib/settings";

/** Quota feedback supplements the connection details in both presentations. */
export function providerListDetails(
  provider: CustomProvider,
  result: ProviderUsageResult | null | undefined,
  t: (key: string) => string,
) {
  const plan = result?.data[0];
  const usage = result?.error
    ? result.error
    : plan
      ? [
          plan.planName || plan.extra,
          typeof plan.remaining === "number"
            ? `${t("settings.usage.remaining")}: ${plan.remaining.toLocaleString()}${plan.unit ? ` ${plan.unit}` : ""}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined;
  return {
    connection: `${provider.baseUrl || t("settings.noBaseUrl")} · ${provider.activeModels.length} ${t("settings.activeModels")}`,
    usage,
  };
}
