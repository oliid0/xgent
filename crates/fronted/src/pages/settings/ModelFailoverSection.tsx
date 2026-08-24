import { ChevronDown, ChevronUp, Waypoints } from "../../components/icons";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { useLocale } from "../../i18n";
import type {
  ModelFailoverProviderSettings,
  ProviderId,
} from "../../lib/settings";
import type { SettingsSectionProps } from "./types";

const PROVIDER_TYPES: readonly ProviderId[] = [
  "claude_code",
  "codex",
  "gemini",
  "xai",
  "deepseek",
];

const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude_code: "Anthropic",
  codex: "OpenAI",
  gemini: "Gemini",
  xai: "Grok",
  deepseek: "DeepSeek",
};

export function ModelFailoverSection({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();

  const updateProvider = (
    providerType: ProviderId,
    patch: Partial<ModelFailoverProviderSettings>,
  ) => {
    setSettings((previous) => ({
      ...previous,
      modelFailover: {
        ...previous.modelFailover,
        [providerType]: { ...previous.modelFailover[providerType], ...patch },
      },
    }));
  };

  const toggleQueueProvider = (providerType: ProviderId, providerId: string) => {
    const current = settings.modelFailover[providerType];
    updateProvider(providerType, {
      queue: current.queue.includes(providerId)
        ? current.queue.filter((id) => id !== providerId)
        : [...current.queue, providerId],
    });
  };

  const moveQueueProvider = (providerType: ProviderId, providerId: string, offset: -1 | 1) => {
    const current = settings.modelFailover[providerType];
    const index = current.queue.indexOf(providerId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= current.queue.length) return;
    const queue = current.queue.slice();
    [queue[index], queue[target]] = [queue[target], queue[index]];
    updateProvider(providerType, { queue });
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-300">
            <Waypoints className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">{t("settings.failover.title")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("settings.failover.desc")}
            </p>
          </div>
        </div>
      </section>

      {PROVIDER_TYPES.map((providerType) => {
        const config = settings.modelFailover[providerType];
        const providers = settings.customProviders.filter(
          (provider) => provider.type === providerType,
        );
        const queueProviders = config.queue
          .map((id) => providers.find((provider) => provider.id === id))
          .filter((provider): provider is (typeof providers)[number] => Boolean(provider));
        const unqueuedProviders = providers.filter(
          (provider) => !config.queue.includes(provider.id),
        );

        return (
          <section
            key={providerType}
            className="rounded-2xl border border-border/60 bg-card p-4"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">{PROVIDER_LABELS[providerType]}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("settings.failover.vendorDesc")}
                </p>
              </div>
              <Switch
                checked={config.enabled}
                onCheckedChange={(enabled) => updateProvider(providerType, { enabled })}
                aria-label={`${PROVIDER_LABELS[providerType]} ${t("settings.failover.enabled")}`}
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="space-y-1.5 text-xs text-muted-foreground">
                <span>{t("settings.failover.maxSwitches")}</span>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={config.maxSwitches}
                  onChange={(event) =>
                    updateProvider(providerType, {
                      maxSwitches: Math.min(10, Math.max(1, Number(event.target.value) || 1)),
                    })
                  }
                />
              </label>
              <label className="space-y-1.5 text-xs text-muted-foreground">
                <span>{t("settings.failover.failureThreshold")}</span>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={config.failureThreshold}
                  onChange={(event) =>
                    updateProvider(providerType, {
                      failureThreshold: Math.min(
                        10,
                        Math.max(1, Number(event.target.value) || 1),
                      ),
                    })
                  }
                />
              </label>
              <label className="space-y-1.5 text-xs text-muted-foreground">
                <span>{t("settings.failover.cooldown")}</span>
                <Input
                  type="number"
                  min={5}
                  max={3600}
                  value={config.cooldownSeconds}
                  onChange={(event) =>
                    updateProvider(providerType, {
                      cooldownSeconds: Math.min(
                        3600,
                        Math.max(5, Number(event.target.value) || 5),
                      ),
                    })
                  }
                />
              </label>
            </div>

            <div className="mt-4 space-y-2">
              <div className="text-xs font-medium text-foreground">
                {t("settings.failover.queue")}
              </div>
              {providers.length < 2 ? (
                <p className="rounded-xl bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                  {t("settings.failover.needProviders")}
                </p>
              ) : (
                <>
                  {queueProviders.map((provider, index) => (
                    <div
                      key={provider.id}
                      className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/25 px-3 py-2"
                    >
                      <span className="w-5 text-center text-xs font-semibold text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{provider.name}</span>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveQueueProvider(providerType, provider.id, -1)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                        aria-label={t("settings.failover.moveUp")}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={index === queueProviders.length - 1}
                        onClick={() => moveQueueProvider(providerType, provider.id, 1)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                        aria-label={t("settings.failover.moveDown")}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleQueueProvider(providerType, provider.id)}
                        className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        {t("settings.failover.remove")}
                      </button>
                    </div>
                  ))}
                  {unqueuedProviders.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {unqueuedProviders.map((provider) => (
                        <button
                          key={provider.id}
                          type="button"
                          onClick={() => toggleQueueProvider(providerType, provider.id)}
                          className="rounded-lg border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          + {provider.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
