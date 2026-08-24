import { useState } from "react";
import { Loader2, RefreshCw, Wallet } from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  type ProviderUsageResult,
  testProviderUsage,
  useProviderUsage,
} from "../../lib/providers/usageQuery";
import {
  type CustomProvider,
  getDefaultUsageQueryConfig,
  normalizeUsageQueryConfig,
  type UsageQueryConfig,
  type UsageQueryMode,
  updateCustomProviders,
} from "../../lib/settings";
import { cn } from "../../lib/shared/utils";
import type { SettingsSectionProps } from "./types";

const MODES: UsageQueryMode[] = ["coding-plan", "balance", "general", "newapi", "custom"];

function formatAmount(value: number | undefined, unit?: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}${unit ? ` ${unit}` : ""}`;
}

function UsageResultView({ result }: { result: ProviderUsageResult | null }) {
  if (!result) return null;
  if (result.error) return <p className="mt-3 text-xs text-destructive">{result.error}</p>;
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {result.data.map((item, index) => (
        <div
          key={`${item.planName ?? "usage"}-${index}`}
          className="rounded-xl bg-muted/45 p-3 text-xs"
        >
          <div className="font-medium text-foreground">
            {item.planName || item.extra || "Usage"}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
            <span>Remaining: {formatAmount(item.remaining, item.unit)}</span>
            <span>Used: {formatAmount(item.used, item.unit)}</span>
            <span>Total: {formatAmount(item.total, item.unit)}</span>
          </div>
          {item.isValid === false ? (
            <p className="mt-1 text-destructive">{item.invalidMessage || "Invalid account"}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function ProviderUsageSection({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();
  const usage = useProviderUsage(settings.customProviders);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ProviderUsageResult | null>>({});

  const patchProvider = (providerId: string, patch: Partial<UsageQueryConfig>) => {
    setSettings((prev) =>
      updateCustomProviders(
        prev,
        prev.customProviders.map((provider) =>
          provider.id === providerId
            ? {
                ...provider,
                usageQuery: normalizeUsageQueryConfig({
                  ...(provider.usageQuery ?? getDefaultUsageQueryConfig()),
                  ...patch,
                }),
              }
            : provider,
        ),
      ),
    );
  };

  const runTest = async (provider: CustomProvider) => {
    setTestingId(provider.id);
    try {
      const result = await testProviderUsage(
        provider.id,
        provider.usageQuery ?? getDefaultUsageQueryConfig(),
      );
      setTestResults((current) => ({ ...current, [provider.id]: result }));
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [provider.id]: {
          data: [],
          error: error instanceof Error ? error.message : String(error),
          isStale: false,
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
            <Wallet className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">{t("settings.usage.title")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("settings.usage.desc")}
            </p>
          </div>
        </div>
      </section>

      {settings.customProviders.map((provider) => {
        const config = provider.usageQuery ?? getDefaultUsageQueryConfig();
        const liveState = usage.getState(provider.id);
        const shownResult = testResults[provider.id] ?? liveState.result;
        return (
          <details
            key={provider.id}
            className="group rounded-2xl border border-border/60 bg-card"
            open={config.enabled}
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{provider.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {provider.baseUrl || provider.type} · {t(`settings.usage.mode.${config.mode}`)}
                </div>
              </div>
              {liveState.loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : null}
              <button
                type="button"
                role="switch"
                aria-checked={config.enabled}
                onClick={(event) => {
                  event.preventDefault();
                  patchProvider(provider.id, { enabled: !config.enabled });
                }}
                className={cn(
                  "relative h-6 w-11 rounded-full transition-colors",
                  config.enabled ? "bg-emerald-500" : "bg-muted-foreground/25",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                    config.enabled ? "translate-x-5" : "translate-x-0.5",
                  )}
                />
              </button>
            </summary>

            <div className="border-t border-border/50 px-4 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="text-xs font-medium">{t("settings.usage.mode")}</span>
                  <select
                    value={config.mode}
                    onChange={(event) =>
                      patchProvider(provider.id, { mode: event.target.value as UsageQueryMode })
                    }
                    className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                  >
                    {MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`settings.usage.mode.${mode}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="text-xs font-medium">{t("settings.usage.timeout")}</span>
                  <input
                    type="number"
                    min={2}
                    max={30}
                    value={config.timeoutSecs ?? 10}
                    onChange={(event) =>
                      patchProvider(provider.id, { timeoutSecs: Number(event.target.value) })
                    }
                    className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                  />
                </label>
                <label className="sm:col-span-2">
                  <span className="text-xs font-medium">{t("settings.usage.baseUrl")}</span>
                  <input
                    value={config.baseUrl}
                    onChange={(event) =>
                      patchProvider(provider.id, { baseUrl: event.target.value })
                    }
                    placeholder={provider.baseUrl}
                    className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                  />
                </label>
                <label>
                  <span className="text-xs font-medium">API Key</span>
                  <input
                    type="password"
                    value={config.apiKey}
                    onChange={(event) => patchProvider(provider.id, { apiKey: event.target.value })}
                    placeholder={
                      config.apiKeyConfigured
                        ? t("settings.usage.secretSaved")
                        : t("settings.usage.providerCredential")
                    }
                    className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                  />
                </label>
                {config.mode === "newapi" ? (
                  <>
                    <label>
                      <span className="text-xs font-medium">Access Token</span>
                      <input
                        type="password"
                        value={config.accessToken}
                        onChange={(event) =>
                          patchProvider(provider.id, { accessToken: event.target.value })
                        }
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                      />
                    </label>
                    <label>
                      <span className="text-xs font-medium">User ID</span>
                      <input
                        value={config.userId}
                        onChange={(event) =>
                          patchProvider(provider.id, { userId: event.target.value })
                        }
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                      />
                    </label>
                  </>
                ) : null}
                {config.mode === "coding-plan" ? (
                  <>
                    <label>
                      <span className="text-xs font-medium">Plan Provider</span>
                      <input
                        value={config.codingPlanProvider}
                        onChange={(event) =>
                          patchProvider(provider.id, { codingPlanProvider: event.target.value })
                        }
                        placeholder="auto / zhipu_team / zenmux"
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                      />
                    </label>
                    <label>
                      <span className="text-xs font-medium">Organization ID</span>
                      <input
                        value={config.teamOrganizationId}
                        onChange={(event) =>
                          patchProvider(provider.id, { teamOrganizationId: event.target.value })
                        }
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                      />
                    </label>
                    <label>
                      <span className="text-xs font-medium">Project ID</span>
                      <input
                        value={config.teamProjectId}
                        onChange={(event) =>
                          patchProvider(provider.id, { teamProjectId: event.target.value })
                        }
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                      />
                    </label>
                    <label>
                      <span className="text-xs font-medium">Access Key ID</span>
                      <input
                        value={config.accessKeyId}
                        onChange={(event) =>
                          patchProvider(provider.id, { accessKeyId: event.target.value })
                        }
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                      />
                    </label>
                    <label>
                      <span className="text-xs font-medium">Secret Access Key</span>
                      <input
                        type="password"
                        value={config.secretAccessKey}
                        onChange={(event) =>
                          patchProvider(provider.id, { secretAccessKey: event.target.value })
                        }
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                      />
                    </label>
                  </>
                ) : null}
                {config.mode === "general" ||
                config.mode === "newapi" ||
                config.mode === "custom" ? (
                  <label className="sm:col-span-2">
                    <span className="text-xs font-medium">{t("settings.usage.script")}</span>
                    <textarea
                      value={config.script}
                      onChange={(event) =>
                        patchProvider(provider.id, { script: event.target.value })
                      }
                      rows={8}
                      placeholder={
                        config.mode === "custom"
                          ? t("settings.usage.scriptRequired")
                          : t("settings.usage.scriptPreset")
                      }
                      className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs"
                    />
                  </label>
                ) : null}
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={testingId === provider.id}
                  onClick={() => void runTest(provider)}
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-foreground px-3 text-xs font-medium text-background disabled:opacity-50"
                >
                  {testingId === provider.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {t("settings.usage.test")}
                </button>
                {config.enabled ? (
                  <button
                    type="button"
                    onClick={() => void usage.refresh(provider.id)}
                    className="h-9 rounded-xl border border-border px-3 text-xs"
                  >
                    {t("settings.usage.refresh")}
                  </button>
                ) : null}
              </div>
              <UsageResultView result={shownResult} />
            </div>
          </details>
        );
      })}
    </div>
  );
}
