import { invoke } from "@xgent/runtime";
import type { UsageQueryConfig } from "../settings";
import {
  type ProviderUsageResult,
  type UsageQueryProvider,
  useProviderUsageWithQuery,
} from "./usageQueryCore";

export * from "./usageQueryCore";

export async function queryProviderUsage(
  providerId: string,
  refresh: boolean,
): Promise<ProviderUsageResult | null> {
  return invoke<ProviderUsageResult>("provider_usage_query", { providerId, refresh });
}

export async function testProviderUsage(
  providerId: string,
  config: UsageQueryConfig,
): Promise<ProviderUsageResult | null> {
  return invoke<ProviderUsageResult>("provider_usage_test", {
    providerId,
    configJson: JSON.stringify(config),
  });
}

export function useProviderUsage(providers: readonly UsageQueryProvider[]) {
  return useProviderUsageWithQuery(queryProviderUsage, providers);
}
