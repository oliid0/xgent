import { useCallback, useEffect, useMemo, useState } from "react";
import type { UsageQueryConfig } from "../settings";

export type ProviderUsageData = {
  planName?: string;
  extra?: string;
  isValid?: boolean;
  invalidMessage?: string;
  total?: number;
  used?: number;
  remaining?: number;
  unit?: string;
};

export type ProviderUsageResult = {
  data: ProviderUsageData[];
  queriedAt?: number;
  error?: string;
  isStale: boolean;
};

export type UsageQueryProvider = {
  id: string;
  usageQuery?: UsageQueryConfig;
};

export type ProviderUsageViewState = {
  loading: boolean;
  result: ProviderUsageResult | null;
};

type QueryProviderUsage = (
  providerId: string,
  refresh: boolean,
) => Promise<ProviderUsageResult | null>;

export function useProviderUsageWithQuery(
  query: QueryProviderUsage,
  providers: readonly UsageQueryProvider[],
) {
  const [states, setStates] = useState<Record<string, ProviderUsageViewState>>({});
  const enabledIds = useMemo(
    () => providers.filter((provider) => provider.usageQuery?.enabled).map((provider) => provider.id),
    [providers],
  );

  const load = useCallback(
    async (providerId: string, refresh = false) => {
      setStates((current) => ({
        ...current,
        [providerId]: { loading: true, result: current[providerId]?.result ?? null },
      }));
      try {
        const result = await query(providerId, refresh);
        setStates((current) => ({ ...current, [providerId]: { loading: false, result } }));
        return result;
      } catch (error) {
        const result: ProviderUsageResult = {
          data: [],
          error: error instanceof Error ? error.message : String(error),
          isStale: false,
        };
        setStates((current) => ({ ...current, [providerId]: { loading: false, result } }));
        return result;
      }
    },
    [query],
  );

  useEffect(() => {
    for (const providerId of enabledIds) void load(providerId, false);
  }, [enabledIds.join("\n"), load]);

  return {
    states,
    getState: (providerId: string): ProviderUsageViewState =>
      states[providerId] ?? { loading: false, result: null },
    refresh: (providerId: string) => load(providerId, true),
    refreshAll: () => Promise.all(enabledIds.map((providerId) => load(providerId, true))),
  };
}
