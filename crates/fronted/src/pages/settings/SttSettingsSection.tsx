import { useState } from "react";
import { Check, Loader2, Mic } from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  normalizeSettings,
  STT_PROVIDER_IDS,
  type SttProviderId,
  type SttProviderSettings,
} from "../../lib/settings";
import { cn } from "../../lib/shared/utils";
import { desktopSttSettingsService } from "../../lib/stt/desktopSttSettingsService";
import type { SttSecretField } from "../../lib/stt/types";
import type { SettingsSectionProps } from "./types";

const PROVIDER_LABELS: Record<SttProviderId, string> = {
  aliyun_dashscope: "阿里云 DashScope",
  tencent_cloud: "腾讯云 ASR",
  volcengine_v2: "火山引擎 ASR v2",
  volcengine_seed_v3: "火山引擎 Seed ASR v3",
  baidu_cloud: "百度智能云 ASR",
};

type Field = {
  key: keyof SttProviderSettings;
  label: string;
  secret?: SttSecretField;
  placeholder?: string;
};

const PROVIDER_FIELDS: Record<SttProviderId, Field[]> = {
  aliyun_dashscope: [
    { key: "websocketUrl", label: "WebSocket URL" },
    { key: "model", label: "Model" },
    { key: "apiKey", label: "API Key", secret: "apiKey" },
  ],
  tencent_cloud: [
    { key: "appId", label: "AppId" },
    { key: "engineModelType", label: "Engine Model Type" },
    { key: "secretId", label: "SecretId", secret: "secretId" },
    { key: "secretKey", label: "SecretKey", secret: "secretKey" },
  ],
  volcengine_v2: [
    { key: "websocketUrl", label: "WebSocket URL" },
    { key: "appId", label: "App ID" },
    { key: "cluster", label: "Cluster" },
    { key: "accessToken", label: "Access Token", secret: "accessToken" },
  ],
  volcengine_seed_v3: [
    { key: "websocketUrl", label: "WebSocket URL" },
    { key: "appId", label: "App ID" },
    { key: "resourceId", label: "Resource ID" },
    { key: "accessToken", label: "Access Token", secret: "accessToken" },
  ],
  baidu_cloud: [
    { key: "websocketUrl", label: "WebSocket URL" },
    { key: "baiduAppId", label: "App ID" },
    { key: "devPid", label: "dev_pid" },
    { key: "baiduApiKey", label: "API Key", secret: "baiduApiKey" },
  ],
};

export function SttSettingsSection({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const providerId = settings.stt.provider;
  const provider = settings.stt.providers[providerId];

  const patchProvider = (patch: Partial<SttProviderSettings>) => {
    setTestResult(null);
    setSettings((prev) =>
      normalizeSettings({
        ...prev,
        stt: {
          ...prev.stt,
          providers: {
            ...prev.stt.providers,
            [providerId]: { ...prev.stt.providers[providerId], ...patch },
          },
        },
      }),
    );
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await desktopSttSettingsService.update(settings.stt);
      const result = await desktopSttSettingsService.test(providerId);
      const ok = result.result === "connected" || result.result === "connected_no_speech";
      setTestResult({
        ok,
        message: result.message || t(`settings.stt.test.${result.result}`),
      });
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-300">
            <Mic className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{t("settings.stt.title")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("settings.stt.desc")}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.stt.enabled}
            onClick={() =>
              setSettings((prev) =>
                normalizeSettings({ ...prev, stt: { ...prev.stt, enabled: !prev.stt.enabled } }),
              )
            }
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full transition-colors",
              settings.stt.enabled ? "bg-rose-500" : "bg-muted-foreground/25",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                settings.stt.enabled ? "translate-x-5" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card p-4">
        <label className="text-xs font-medium text-foreground">{t("settings.stt.provider")}</label>
        <select
          value={providerId}
          onChange={(event) => {
            const next = event.target.value as SttProviderId;
            if (!STT_PROVIDER_IDS.includes(next)) return;
            setTestResult(null);
            setSettings((prev) =>
              normalizeSettings({ ...prev, stt: { ...prev.stt, provider: next } }),
            );
          }}
          className="mt-2 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-rose-500/50"
        >
          {STT_PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {PROVIDER_LABELS[id]}
            </option>
          ))}
        </select>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {PROVIDER_FIELDS[providerId].map((field) => (
            <label key={field.key} className={field.key === "websocketUrl" ? "sm:col-span-2" : ""}>
              <span className="text-xs font-medium text-foreground">{field.label}</span>
              <input
                type={field.secret ? "password" : "text"}
                value={typeof provider[field.key] === "string" ? String(provider[field.key]) : ""}
                placeholder={
                  field.secret && provider.configured
                    ? t("settings.stt.secretSaved")
                    : field.placeholder
                }
                onChange={(event) => patchProvider({ [field.key]: event.target.value })}
                className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-rose-500/50"
              />
            </label>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={testing}
            onClick={() => void testConnection()}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-foreground px-3 text-xs font-medium text-background disabled:opacity-50"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {t("settings.stt.test")}
          </button>
          {testResult ? (
            <span
              className={cn("text-xs", testResult.ok ? "text-emerald-600" : "text-destructive")}
            >
              {testResult.message}
            </span>
          ) : null}
        </div>
      </section>
    </div>
  );
}
