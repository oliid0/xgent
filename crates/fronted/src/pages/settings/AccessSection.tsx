import { invoke, isBrowserRuntime } from "@xagent/runtime";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Cloud,
  Copy,
  GitBranch,
  Globe,
  Key,
  Lock,
  MonitorSmartphone,
  RefreshCw,
  Server,
  Shield,
  Terminal,
  Wifi,
  WifiOff,
} from "../../components/icons";
import { Input } from "../../components/ui/input";
import { useLocale } from "../../i18n";
import type { AppSettings } from "../../lib/settings";
import { inferRuntimePlatform, resolveRuntimePlatform } from "../../lib/runtimePlatform";
import { AgentActivationSwitch } from "./shared";
import { MobileExecutionSection } from "./MobileExecutionSection";
import type { SettingsSectionProps } from "./types";

type LocalAccessStatus = {
  running: boolean;
  bindAddress: string;
  port: number;
  urls: string[];
  pairedDevices: number;
  pairingCode?: string | null;
  pairingCodeExpiresAt?: number | null;
  lastError?: string | null;
};

type CloudSecretVaultStatus = {
  configured: boolean;
  unlocked: boolean;
  githubTokenConfigured: boolean;
};

const EMPTY_LOCAL_STATUS: LocalAccessStatus = {
  running: false,
  bindAddress: "",
  port: 28_367,
  urls: [],
  pairedDevices: 0,
};

const EMPTY_VAULT_STATUS: CloudSecretVaultStatus = {
  configured: false,
  unlocked: false,
  githubTokenConfigured: false,
};

function updateAccess(
  setSettings: SettingsSectionProps["setSettings"],
  patch: Partial<AppSettings["access"]>,
) {
  setSettings((previous) => ({
    ...previous,
    access: { ...previous.access, ...patch },
  }));
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      disabled={!value}
      onClick={() => {
        if (!value) return;
        void navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      }}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function ToggleCard({
  icon,
  title,
  hint,
  checked,
  disabled = false,
  onToggle,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/30 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {title}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <AgentActivationSwitch checked={checked} title={title} disabled={disabled} onToggle={onToggle} />
    </div>
  );
}

export function AccessSection({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();
  const browser = isBrowserRuntime();
  const [nativeMobile, setNativeMobile] = useState(() => {
    const platform = inferRuntimePlatform();
    return !browser && (platform === "android" || platform === "ios");
  });
  const [localStatus, setLocalStatus] = useState(EMPTY_LOCAL_STATUS);
  const [vaultStatus, setVaultStatus] = useState(EMPTY_VAULT_STATUS);
  const [vaultPassphrase, setVaultPassphrase] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const refreshLocalStatus = useCallback(async () => {
    if (nativeMobile) return;
    try {
      setLocalStatus(await invoke<LocalAccessStatus>("local_access_status"));
    } catch (error) {
      setLocalStatus((previous) => ({
        ...previous,
        running: false,
        lastError: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [nativeMobile]);

  const refreshVaultStatus = useCallback(async () => {
    if (browser) return;
    try {
      setVaultStatus(await invoke<CloudSecretVaultStatus>("cloud_secret_vault_status"));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, [browser]);

  useEffect(() => {
    if (browser) return;
    let cancelled = false;
    void resolveRuntimePlatform().then((platform) => {
      if (!cancelled) setNativeMobile(platform === "android" || platform === "ios");
    });
    return () => {
      cancelled = true;
    };
  }, [browser]);

  useEffect(() => {
    if (browser) return;
    if (!nativeMobile) void refreshLocalStatus();
    void refreshVaultStatus();
  }, [browser, nativeMobile, refreshLocalStatus, refreshVaultStatus, settings.access.webUiEnabled]);

  useEffect(() => {
    if (browser || nativeMobile || !settings.access.webUiEnabled) return;
    const timer = window.setInterval(() => void refreshLocalStatus(), 5_000);
    return () => window.clearInterval(timer);
  }, [browser, nativeMobile, refreshLocalStatus, settings.access.webUiEnabled]);

  const endpoint = useMemo(
    () => localStatus.urls[0] ?? `http://127.0.0.1:${settings.access.webUiPort}`,
    [localStatus.urls, settings.access.webUiPort],
  );

  async function runAction(name: string, action: () => Promise<void>) {
    setActionError("");
    setBusyAction(name);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="space-y-6">
      {nativeMobile ? (
        <MobileExecutionSection settings={settings} setSettings={setSettings} />
      ) : (
        <>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10">
            <MonitorSmartphone className="h-[18px] w-[18px] text-sky-500" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">{t("settings.accessTitle")}</h3>
            <p className="text-xs text-muted-foreground">{t("settings.accessDesc")}</p>
          </div>
        </div>
        <div
          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
            localStatus.running
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-muted/50 text-muted-foreground"
          }`}
          title={localStatus.lastError ?? undefined}
        >
          {localStatus.running ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {localStatus.running ? t("settings.accessRunning") : t("settings.accessStopped")}
        </div>
      </div>

      {browser ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          {t("settings.accessNativeOnly")}
        </div>
      ) : null}

      <section className="space-y-4 rounded-xl border border-border/60 bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">{t("settings.accessWebUi")}</div>
              <p className="text-xs text-muted-foreground">{t("settings.accessWebUiHint")}</p>
            </div>
          </div>
          <AgentActivationSwitch
            checked={settings.access.webUiEnabled}
            title={t("settings.accessWebUi")}
            disabled={browser}
            onToggle={() =>
              updateAccess(setSettings, { webUiEnabled: !settings.access.webUiEnabled })
            }
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            <span>{t("settings.accessScope")}</span>
            <select
              value={settings.access.webUiScope}
              disabled={browser}
              onChange={(event) =>
                updateAccess(setSettings, {
                  webUiScope: event.currentTarget.value === "loopback" ? "loopback" : "lan",
                })
              }
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="lan">{t("settings.accessScopeLan")}</option>
              <option value="loopback">{t("settings.accessScopeLoopback")}</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            <span>{t("settings.accessPort")}</span>
            <Input
              type="number"
              min={1}
              max={65_535}
              value={settings.access.webUiPort}
              disabled={browser}
              onChange={(event) =>
                updateAccess(setSettings, {
                  webUiPort: Math.min(65_535, Math.max(1, Number(event.currentTarget.value) || 28_367)),
                })
              }
              className="font-mono text-[13px]"
            />
          </label>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs">
          <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono">{endpoint}</span>
          <CopyButton value={endpoint} />
          <button
            type="button"
            disabled={busyAction !== "" || browser}
            onClick={() => void runAction("refresh", refreshLocalStatus)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 disabled:opacity-40"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleCard
            icon={<Terminal className="h-3.5 w-3.5 text-muted-foreground" />}
            title={t("settings.accessAllowTerminal")}
            hint={t("settings.accessAllowTerminalHint")}
            checked={settings.access.allowTerminal}
            disabled={browser}
            onToggle={() => updateAccess(setSettings, { allowTerminal: !settings.access.allowTerminal })}
          />
          <ToggleCard
            icon={<Server className="h-3.5 w-3.5 text-muted-foreground" />}
            title={t("settings.accessAllowSsh")}
            hint={t("settings.accessAllowSshHint")}
            checked={settings.access.allowSsh}
            disabled={browser}
            onToggle={() => updateAccess(setSettings, { allowSsh: !settings.access.allowSsh })}
          />
          <ToggleCard
            icon={<GitBranch className="h-3.5 w-3.5 text-muted-foreground" />}
            title={t("settings.accessAllowGit")}
            hint={t("settings.accessAllowGitHint")}
            checked={settings.access.allowGit}
            disabled={browser}
            onToggle={() => updateAccess(setSettings, { allowGit: !settings.access.allowGit })}
          />
          <ToggleCard
            icon={<Shield className="h-3.5 w-3.5 text-muted-foreground" />}
            title={t("settings.accessAllowFileWrite")}
            hint={t("settings.accessAllowFileWriteHint")}
            checked={settings.access.allowFileWrite}
            disabled={browser}
            onToggle={() => updateAccess(setSettings, { allowFileWrite: !settings.access.allowFileWrite })}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-3 text-xs">
          <div>
            <div className="font-medium">{t("settings.accessPairing")}</div>
            <div className="mt-0.5 text-muted-foreground">
              {t("settings.accessPairedDevices").replace("{count}", String(localStatus.pairedDevices))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {localStatus.pairingCode ? (
              <code className="rounded-md bg-muted px-3 py-2 text-sm font-semibold tracking-[0.2em]">
                {localStatus.pairingCode}
              </code>
            ) : null}
            <button
              type="button"
              disabled={!settings.access.webUiEnabled || busyAction !== "" || browser}
              onClick={() =>
                void runAction("pair", async () => {
                  setLocalStatus(await invoke<LocalAccessStatus>("local_access_rotate_pairing_code"));
                })
              }
              className="rounded-lg border border-border px-3 py-2 font-medium hover:bg-muted/50 disabled:opacity-40"
            >
              {t("settings.accessNewPairingCode")}
            </button>
          </div>
        </div>
      </section>
        </>
      )}

      <section className="space-y-4 rounded-xl border border-border/60 bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">{t("settings.accessCloudExecution")}</div>
              <p className="text-xs text-muted-foreground">{t("settings.accessCloudExecutionHint")}</p>
            </div>
          </div>
          <AgentActivationSwitch
            checked={settings.access.cloudExecutionEnabled}
            title={t("settings.accessCloudExecution")}
            disabled={browser}
            onToggle={() =>
              updateAccess(setSettings, {
                cloudExecutionEnabled: !settings.access.cloudExecutionEnabled,
              })
            }
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            <span>{t("settings.accessGithubOwner")}</span>
            <Input
              value={settings.access.githubOwner}
              disabled={browser}
              onChange={(event) => updateAccess(setSettings, { githubOwner: event.currentTarget.value })}
              placeholder="github-user"
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            <span>{t("settings.accessGithubRepository")}</span>
            <Input
              value={settings.access.githubRepository}
              disabled={browser}
              onChange={(event) =>
                updateAccess(setSettings, { githubRepository: event.currentTarget.value })
              }
              placeholder="agent-temp"
            />
          </label>
        </div>

        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          {t("settings.accessCloudPublicWarning")}
        </div>

        <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {t("settings.accessCloudEnvironmentHint")}
        </div>

        <div className="rounded-lg border border-border/50 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              {vaultStatus.unlocked ? <Key className="h-4 w-4 text-emerald-500" /> : <Lock className="h-4 w-4" />}
              {t("settings.accessSecureVault")}
            </div>
            <span className="text-xs text-muted-foreground">
              {vaultStatus.githubTokenConfigured
                ? t("settings.accessTokenConfigured")
                : t("settings.accessTokenMissing")}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              type="password"
              autoComplete="current-password"
              value={vaultPassphrase}
              onChange={(event) => setVaultPassphrase(event.currentTarget.value)}
              placeholder={t("settings.accessVaultPassphrase")}
              disabled={browser || vaultStatus.unlocked}
            />
            <button
              type="button"
              disabled={browser || busyAction !== ""}
              onClick={() =>
                void runAction(vaultStatus.unlocked ? "lock" : "unlock", async () => {
                  const next = vaultStatus.unlocked
                    ? await invoke<CloudSecretVaultStatus>("cloud_secret_vault_lock")
                    : await invoke<CloudSecretVaultStatus>("cloud_secret_vault_unlock", {
                        passphrase: vaultPassphrase,
                      });
                  setVaultStatus(next);
                  setVaultPassphrase("");
                  setGithubToken("");
                })
              }
              className="rounded-lg border border-border px-4 py-2 text-xs font-medium hover:bg-muted/50 disabled:opacity-40"
            >
              {vaultStatus.unlocked ? t("settings.accessLockVault") : t("settings.accessUnlockVault")}
            </button>
          </div>
          {vaultStatus.unlocked ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                type="password"
                autoComplete="off"
                value={githubToken}
                onChange={(event) => setGithubToken(event.currentTarget.value)}
                placeholder={t("settings.accessGithubToken")}
              />
              <button
                type="button"
                disabled={!githubToken.trim() || busyAction !== ""}
                onClick={() =>
                  void runAction("save-token", async () => {
                    setVaultStatus(
                      await invoke<CloudSecretVaultStatus>("cloud_secret_vault_set_github_token", {
                        token: githubToken,
                      }),
                    );
                    setGithubToken("");
                  })
                }
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40"
              >
                {t("settings.accessSaveToken")}
              </button>
            </div>
          ) : null}
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {t("settings.accessVaultHint")}
          </p>
        </div>
      </section>

      {!nativeMobile ? (
        <MobileExecutionSection settings={settings} setSettings={setSettings} />
      ) : null}

      {actionError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {actionError}
        </div>
      ) : null}
    </div>
  );
}
