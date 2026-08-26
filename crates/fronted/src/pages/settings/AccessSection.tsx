import { invoke, isBrowserRuntime, listen } from "@xagent/runtime";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Cloud,
  Copy,
  GitBranch,
  Globe,
  Key,
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
import {
  browserSessionController,
  normalizeBrowserAddress,
} from "../../lib/browser/browserSessionController";
import type { AppSettings } from "../../lib/settings";
import { AgentActivationSwitch } from "./shared";
import type { SettingsSectionProps } from "./types";
import { View as AstryxView, Inline as AstryxInline } from "@xagent/ui/components/ui/view";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import { Paragraph as AstryxParagraph } from "@xagent/ui/components/ui/view";
import { Heading as AstryxHeading } from "@xagent/ui/components/ui/view";
import { Label as AstryxLabel } from "@xagent/ui/components/ui/label";

type LocalAccessStatus = {
  enabled: boolean;
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
  githubTokenConfigured: boolean;
  githubUsername?: string | null;
};

type LanPcClientStatus = {
  paired: boolean;
  baseUrl?: string | null;
  deviceId?: string | null;
  expiresAt?: number | null;
};

const EMPTY_LOCAL_STATUS: LocalAccessStatus = {
  enabled: false,
  running: false,
  bindAddress: "",
  port: 28_367,
  urls: [],
  pairedDevices: 0,
};

const EMPTY_VAULT_STATUS: CloudSecretVaultStatus = {
  githubTokenConfigured: false,
};

const EMPTY_LAN_PC_STATUS: LanPcClientStatus = {
  paired: false,
};

type AccessSectionProps = SettingsSectionProps & {
  nativeMobile: boolean;
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
    <AstryxButton
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
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </AstryxButton>
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
    <AstryxView
      layout="flex"
      direction="horizontal"
      className="flex items-center justify-between gap-4 rounded-lg bg-muted/30 px-4 py-3"
    >
      <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          {icon}
          {title}
        </AstryxView>
        <AstryxParagraph className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {hint}
        </AstryxParagraph>
      </AstryxView>
      <AgentActivationSwitch
        checked={checked}
        title={title}
        disabled={disabled}
        onToggle={onToggle}
      />
    </AstryxView>
  );
}

function normalizeLanControlUrl(value: string) {
  const normalized = normalizeBrowserAddress(value);
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The computer address must use HTTP or HTTPS.");
  }
  if (url.protocol === "http:" && !url.port) url.port = "28367";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function AccessSection({ settings, setSettings, nativeMobile }: AccessSectionProps) {
  const { t } = useLocale();
  const browser = isBrowserRuntime();
  const [localStatus, setLocalStatus] = useState(EMPTY_LOCAL_STATUS);
  const [vaultStatus, setVaultStatus] = useState(EMPTY_VAULT_STATUS);
  const [lanPcStatus, setLanPcStatus] = useState(EMPTY_LAN_PC_STATUS);
  const [lanPairingCode, setLanPairingCode] = useState("");
  const [lanDeviceName, setLanDeviceName] = useState(() => {
    const platform = /iPad/i.test(navigator.userAgent)
      ? "iPad"
      : /iPhone/i.test(navigator.userAgent)
        ? "iPhone"
        : /Android/i.test(navigator.userAgent)
          ? "Android"
          : "Mobile";
    return `XAgent ${platform}`;
  });
  const [githubToken, setGithubToken] = useState("");
  const [cloudDetailsOpen, setCloudDetailsOpen] = useState(
    () => settings.access.cloudExecutionEnabled,
  );
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

  const refreshLanPcStatus = useCallback(async () => {
    if (browser || !nativeMobile) return;
    setLanPcStatus(await invoke<LanPcClientStatus>("lan_pc_status"));
  }, [browser, nativeMobile]);

  useEffect(() => {
    if (browser) return;
    void refreshVaultStatus();
    if (nativeMobile) void refreshLanPcStatus();
  }, [browser, nativeMobile, refreshLanPcStatus, refreshVaultStatus]);

  useEffect(() => {
    if (browser || nativeMobile) return;
    let disposed = false;
    let stopListening: (() => void) | undefined;
    let statusTimer: number | undefined;
    void listen<LocalAccessStatus>("local-access:status", (event) => {
      if (!disposed) setLocalStatus(event.payload);
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        stopListening = unlisten;
        return refreshLocalStatus();
      })
      .catch(() => refreshLocalStatus())
      .finally(() => {
        if (!disposed && settings.access.webUiEnabled) {
          statusTimer = window.setInterval(() => void refreshLocalStatus(), 2_000);
        }
      });
    return () => {
      disposed = true;
      if (statusTimer !== undefined) window.clearInterval(statusTimer);
      stopListening?.();
    };
  }, [browser, nativeMobile, refreshLocalStatus, settings.access.webUiEnabled]);

  const endpoint = useMemo(
    () => localStatus.urls[0] ?? `http://127.0.0.1:${settings.access.webUiPort}`,
    [localStatus.urls, settings.access.webUiPort],
  );
  const normalizedConfiguredLanUrl = useMemo(() => {
    try {
      return settings.access.lanControlUrl.trim()
        ? normalizeLanControlUrl(settings.access.lanControlUrl).replace(/\/$/, "")
        : "";
    } catch {
      return "";
    }
  }, [settings.access.lanControlUrl]);
  const pairedLanUrl = (lanPcStatus.baseUrl ?? "").replace(/\/$/, "");
  const lanPcReady =
    lanPcStatus.paired &&
    Boolean(normalizedConfiguredLanUrl) &&
    normalizedConfiguredLanUrl === pairedLanUrl;
  const localStatusPhase = localStatus.running
    ? "running"
    : localStatus.lastError
      ? "failed"
      : localStatus.enabled || settings.access.webUiEnabled
        ? "starting"
        : "stopped";

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
    <AstryxView
      layout="block"
      direction="horizontal"
      className="settings-access-section space-y-6"
      data-native-mobile={nativeMobile}
    >
      {nativeMobile ? (
        <AstryxView
          as="section"
          className="settings-access-card space-y-4 rounded-xl border border-border/60 bg-card p-5"
        >
          <AstryxView layout="flex" direction="horizontal" className="flex items-start gap-3">
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10"
            >
              <Wifi className="h-[18px] w-[18px] text-sky-500" />
            </AstryxView>
            <AstryxView layout="block" direction="horizontal" className="min-w-0">
              <AstryxView layout="block" direction="horizontal" className="text-sm font-semibold">
                {t("settings.accessLanControl")}
              </AstryxView>
              <AstryxParagraph className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t("settings.accessLanControlHint")}
              </AstryxParagraph>
            </AstryxView>
          </AstryxView>

          <AstryxLabel className="block space-y-1.5 text-xs font-medium text-muted-foreground">
            <AstryxInline>{t("settings.accessComputerAddress")}</AstryxInline>
            <Input
              value={settings.access.lanControlUrl}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="http://192.168.1.10:28367"
              onChange={(event) =>
                updateAccess(setSettings, { lanControlUrl: event.currentTarget.value })
              }
              onBlur={() => {
                const value = settings.access.lanControlUrl.trim();
                if (!value) return;
                try {
                  updateAccess(setSettings, { lanControlUrl: normalizeLanControlUrl(value) });
                } catch {
                  // Preserve the draft so the user can correct it.
                }
              }}
              className="h-11 font-mono text-[13px]"
            />
          </AstryxLabel>

          <AstryxView
            layout="grid"
            direction="horizontal"
            className="grid gap-2 sm:grid-cols-[1fr_8rem]"
          >
            <AstryxLabel className="block space-y-1.5 text-xs font-medium text-muted-foreground">
              <AstryxInline>{t("settings.accessLanPairingCode")}</AstryxInline>
              <Input
                value={lanPairingCode}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                onChange={(event) =>
                  setLanPairingCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))
                }
                className="h-11 font-mono text-center text-base tracking-[0.2em]"
              />
            </AstryxLabel>
            <AstryxLabel className="block space-y-1.5 text-xs font-medium text-muted-foreground">
              <AstryxInline>{t("settings.accessLanDeviceName")}</AstryxInline>
              <Input
                value={lanDeviceName}
                maxLength={64}
                onChange={(event) => setLanDeviceName(event.currentTarget.value)}
                className="h-11 text-[13px]"
              />
            </AstryxLabel>
          </AstryxView>

          <AstryxView layout="flex" direction="horizontal" className="flex gap-2">
            <AstryxButton
              type="button"
              disabled={
                !settings.access.lanControlUrl.trim() ||
                lanPairingCode.length !== 6 ||
                !lanDeviceName.trim() ||
                busyAction !== ""
              }
              onClick={() =>
                void runAction("lan-pair", async () => {
                  const url = normalizeLanControlUrl(settings.access.lanControlUrl);
                  updateAccess(setSettings, { lanControlUrl: url });
                  const next = await invoke<LanPcClientStatus>("lan_pc_pair", {
                    baseUrl: url,
                    code: lanPairingCode,
                    deviceName: lanDeviceName.trim(),
                  });
                  setLanPcStatus(next);
                  setLanPairingCode("");
                })
              }
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm font-medium transition-colors hover:bg-muted/50 disabled:opacity-40"
            >
              <Wifi className="h-4 w-4" />
              {busyAction === "lan-pair"
                ? t("settings.accessConnecting")
                : t("settings.accessPairComputer")}
            </AstryxButton>
            {lanPcStatus.paired ? (
              <AstryxButton
                type="button"
                disabled={busyAction !== ""}
                onClick={() =>
                  void runAction("lan-disconnect", async () => {
                    setLanPcStatus(await invoke<LanPcClientStatus>("lan_pc_disconnect"));
                    updateAccess(setSettings, { preferLanPcExecution: false });
                  })
                }
                className="h-10 rounded-xl border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-40"
              >
                {t("settings.accessDisconnectComputer")}
              </AstryxButton>
            ) : null}
          </AstryxView>

          <AstryxView
            layout="block"
            direction="horizontal"
            className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-xs ${
              lanPcReady
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-muted/40 text-muted-foreground"
            }`}
          >
            <AstryxInline>
              {lanPcReady
                ? t("settings.accessComputerPaired")
                : t("settings.accessComputerNotPaired")}
            </AstryxInline>
            {lanPcStatus.paired ? (
              <AstryxButton
                type="button"
                disabled={busyAction !== "" || !normalizedConfiguredLanUrl}
                onClick={() =>
                  void runAction("lan-refresh", async () => {
                    setLanPcStatus(
                      await invoke<LanPcClientStatus>("lan_pc_refresh", {
                        baseUrl: normalizeLanControlUrl(settings.access.lanControlUrl),
                      }),
                    );
                  })
                }
                className="flex h-7 items-center gap-1 rounded-lg px-2 font-medium hover:bg-background/70 disabled:opacity-40"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t("settings.accessCheckComputer")}
              </AstryxButton>
            ) : null}
          </AstryxView>

          <ToggleCard
            icon={<MonitorSmartphone className="h-3.5 w-3.5 text-muted-foreground" />}
            title={t("settings.accessPreferLanPc")}
            hint={t("settings.accessPreferLanPcHint")}
            checked={settings.access.preferLanPcExecution}
            disabled={!lanPcReady}
            onToggle={() =>
              updateAccess(setSettings, {
                preferLanPcExecution: !settings.access.preferLanPcExecution,
              })
            }
          />

          <AstryxButton
            type="button"
            disabled={!settings.access.lanControlUrl.trim() || busyAction !== ""}
            onClick={() =>
              void runAction("lan-control", async () => {
                const url = normalizeLanControlUrl(settings.access.lanControlUrl);
                updateAccess(setSettings, { lanControlUrl: url });
                await browserSessionController.ensureSession({
                  sessionId: "lan-control",
                  url,
                  visible: false,
                });
                browserSessionController.openPanel("lan-control");
              })
            }
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-transform active:scale-[0.99] disabled:opacity-40"
          >
            <MonitorSmartphone className="h-4 w-4" />
            {busyAction === "lan-control"
              ? t("settings.accessConnecting")
              : t("settings.accessOpenComputer")}
          </AstryxButton>

          <AstryxParagraph className="text-[11px] leading-relaxed text-muted-foreground">
            {t("settings.accessLanPairingHint")}
          </AstryxParagraph>
        </AstryxView>
      ) : (
        <>
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex items-center justify-between gap-4"
          >
            <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-3">
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10"
              >
                <MonitorSmartphone className="h-[18px] w-[18px] text-sky-500" />
              </AstryxView>
              <AstryxView layout="block" direction="horizontal">
                <AstryxHeading level={3} className="text-sm font-semibold">
                  {t("settings.accessTitle")}
                </AstryxHeading>
                <AstryxParagraph className="text-xs text-muted-foreground">
                  {t("settings.accessDesc")}
                </AstryxParagraph>
              </AstryxView>
            </AstryxView>
            <AstryxView
              layout="block"
              direction="horizontal"
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                localStatusPhase === "running"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : localStatusPhase === "failed"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted/50 text-muted-foreground"
              }`}
              title={localStatus.lastError ?? undefined}
            >
              {localStatusPhase === "running" ? (
                <Wifi className="h-3.5 w-3.5" />
              ) : (
                <WifiOff className="h-3.5 w-3.5" />
              )}
              {localStatusPhase === "running"
                ? t("settings.accessRunning")
                : localStatusPhase === "starting"
                  ? t("settings.accessStarting")
                  : localStatusPhase === "failed"
                    ? t("settings.accessFailed")
                    : t("settings.accessStopped")}
            </AstryxView>
          </AstryxView>

          {browser ? (
            <AstryxView
              layout="block"
              direction="horizontal"
              className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-700 dark:text-amber-300"
            >
              {t("settings.accessNativeOnly")}
            </AstryxView>
          ) : null}

          <AstryxView
            as="section"
            className="space-y-4 rounded-xl border border-border/60 bg-card p-5"
          >
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex items-center justify-between gap-4"
            >
              <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <AstryxView layout="block" direction="horizontal">
                  <AstryxView layout="block" direction="horizontal" className="text-sm font-medium">
                    {t("settings.accessWebUi")}
                  </AstryxView>
                  <AstryxParagraph className="text-xs text-muted-foreground">
                    {t("settings.accessWebUiHint")}
                  </AstryxParagraph>
                </AstryxView>
              </AstryxView>
              <AgentActivationSwitch
                checked={settings.access.webUiEnabled}
                title={t("settings.accessWebUi")}
                disabled={browser}
                onToggle={() =>
                  updateAccess(setSettings, { webUiEnabled: !settings.access.webUiEnabled })
                }
              />
            </AstryxView>

            <AstryxView
              layout="grid"
              direction="horizontal"
              className="grid gap-3 sm:grid-cols-[1fr_140px]"
            >
              <AstryxLabel className="space-y-1.5 text-xs font-medium text-muted-foreground">
                <AstryxInline>{t("settings.accessScope")}</AstryxInline>
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
              </AstryxLabel>
              <AstryxLabel className="space-y-1.5 text-xs font-medium text-muted-foreground">
                <AstryxInline>{t("settings.accessPort")}</AstryxInline>
                <Input
                  type="number"
                  min={1}
                  max={65_535}
                  value={settings.access.webUiPort}
                  disabled={browser}
                  onChange={(event) =>
                    updateAccess(setSettings, {
                      webUiPort: Math.min(
                        65_535,
                        Math.max(1, Number(event.currentTarget.value) || 28_367),
                      ),
                    })
                  }
                  className="font-mono text-[13px]"
                />
              </AstryxLabel>
            </AstryxView>

            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs"
            >
              <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <AstryxInline className="min-w-0 flex-1 truncate font-mono">{endpoint}</AstryxInline>
              <CopyButton value={endpoint} />
              <AstryxButton
                type="button"
                disabled={busyAction !== "" || browser}
                onClick={() => void runAction("refresh", refreshLocalStatus)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 disabled:opacity-40"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </AstryxButton>
            </AstryxView>

            <AstryxView layout="grid" direction="horizontal" className="grid gap-3 sm:grid-cols-2">
              <ToggleCard
                icon={<Terminal className="h-3.5 w-3.5 text-muted-foreground" />}
                title={t("settings.accessAllowTerminal")}
                hint={t("settings.accessAllowTerminalHint")}
                checked={settings.access.allowTerminal}
                disabled={browser}
                onToggle={() =>
                  updateAccess(setSettings, { allowTerminal: !settings.access.allowTerminal })
                }
              />
              <ToggleCard
                icon={<Globe className="h-3.5 w-3.5 text-muted-foreground" />}
                title={t("settings.accessAllowBrowserAutomation")}
                hint={t("settings.accessAllowBrowserAutomationHint")}
                checked={settings.access.allowBrowserAutomation}
                disabled={browser}
                onToggle={() =>
                  updateAccess(setSettings, {
                    allowBrowserAutomation: !settings.access.allowBrowserAutomation,
                  })
                }
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
                onToggle={() =>
                  updateAccess(setSettings, { allowFileWrite: !settings.access.allowFileWrite })
                }
              />
            </AstryxView>

            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-3 text-xs"
            >
              <AstryxView layout="block" direction="horizontal">
                <AstryxView layout="block" direction="horizontal" className="font-medium">
                  {t("settings.accessPairing")}
                </AstryxView>
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="mt-0.5 text-muted-foreground"
                >
                  {t("settings.accessPairedDevices").replace(
                    "{count}",
                    String(localStatus.pairedDevices),
                  )}
                </AstryxView>
              </AstryxView>
              <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-2">
                {localStatus.pairingCode ? (
                  <code className="rounded-md bg-muted px-3 py-2 text-sm font-semibold tracking-[0.2em]">
                    {localStatus.pairingCode}
                  </code>
                ) : null}
                <AstryxButton
                  type="button"
                  disabled={!settings.access.webUiEnabled || busyAction !== "" || browser}
                  onClick={() =>
                    void runAction("pair", async () => {
                      setLocalStatus(
                        await invoke<LocalAccessStatus>("local_access_rotate_pairing_code"),
                      );
                    })
                  }
                  className="rounded-lg border border-border px-3 py-2 font-medium hover:bg-muted/50 disabled:opacity-40"
                >
                  {t("settings.accessNewPairingCode")}
                </AstryxButton>
              </AstryxView>
            </AstryxView>
          </AstryxView>
        </>
      )}

      <AstryxView
        as="section"
        className="settings-access-card space-y-4 rounded-xl border border-border/60 bg-card p-5"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex items-center justify-between gap-4"
        >
          <AstryxButton
            type="button"
            disabled={!nativeMobile}
            onClick={() => setCloudDetailsOpen((open) => !open)}
            aria-expanded={!nativeMobile || cloudDetailsOpen}
            className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
          >
            <Cloud className="h-4 w-4 text-muted-foreground" />
            <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
              <AstryxView layout="block" direction="horizontal" className="text-sm font-medium">
                {t("settings.accessCloudExecution")}
              </AstryxView>
              <AstryxParagraph className="text-xs text-muted-foreground">
                {t("settings.accessCloudExecutionHint")}
              </AstryxParagraph>
            </AstryxView>
            {nativeMobile ? (
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  cloudDetailsOpen ? "rotate-180" : ""
                }`}
              />
            ) : null}
          </AstryxButton>
          <AgentActivationSwitch
            checked={settings.access.cloudExecutionEnabled}
            title={t("settings.accessCloudExecution")}
            disabled={browser}
            onToggle={() => {
              const enabled = !settings.access.cloudExecutionEnabled;
              updateAccess(setSettings, { cloudExecutionEnabled: enabled });
              if (nativeMobile && enabled) setCloudDetailsOpen(true);
            }}
          />
        </AstryxView>

        {!nativeMobile || cloudDetailsOpen ? (
          <AstryxView
            layout="block"
            direction="horizontal"
            className="settings-cloud-details space-y-4"
          >
            <AstryxView layout="grid" direction="horizontal" className="grid gap-3 sm:grid-cols-2">
              <AstryxLabel className="space-y-1.5 text-xs font-medium text-muted-foreground">
                <AstryxInline>{t("settings.accessGithubOwner")}</AstryxInline>
                <Input
                  value={settings.access.githubOwner}
                  disabled={browser}
                  onChange={(event) =>
                    updateAccess(setSettings, { githubOwner: event.currentTarget.value })
                  }
                  placeholder="github-user"
                />
              </AstryxLabel>
              <AstryxLabel className="space-y-1.5 text-xs font-medium text-muted-foreground">
                <AstryxInline>{t("settings.accessGithubRepository")}</AstryxInline>
                <Input
                  value={settings.access.githubRepository}
                  disabled={browser}
                  onChange={(event) =>
                    updateAccess(setSettings, { githubRepository: event.currentTarget.value })
                  }
                  placeholder="agent-temp"
                />
              </AstryxLabel>
            </AstryxView>

            <AstryxView
              layout="block"
              direction="horizontal"
              className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300"
            >
              {t("settings.accessCloudPublicWarning")}
            </AstryxView>

            <AstryxView
              layout="block"
              direction="horizontal"
              className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
            >
              {t("settings.accessCloudEnvironmentHint")}
            </AstryxView>

            <AstryxView
              layout="block"
              direction="horizontal"
              className="settings-cloud-vault rounded-lg border border-border/50 p-4"
            >
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="mb-3 flex items-center justify-between gap-3"
              >
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <Key className="h-4 w-4 text-emerald-500" />
                  {t("settings.accessSecureVault")}
                </AstryxView>
                <AstryxInline className="text-xs text-muted-foreground">
                  {vaultStatus.githubTokenConfigured
                    ? t("settings.accessTokenConfigured")
                    : t("settings.accessTokenMissing")}
                </AstryxInline>
              </AstryxView>
              <AstryxView
                layout="grid"
                direction="horizontal"
                className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={githubToken}
                  onChange={(event) => setGithubToken(event.currentTarget.value)}
                  placeholder={t("settings.accessGithubToken")}
                  disabled={browser}
                />
                <AstryxButton
                  type="button"
                  disabled={
                    browser ||
                    !settings.access.githubOwner.trim() ||
                    !githubToken.trim() ||
                    busyAction !== ""
                  }
                  onClick={() =>
                    void runAction("save-token", async () => {
                      setVaultStatus(
                        await invoke<CloudSecretVaultStatus>(
                          "cloud_secret_vault_set_github_token",
                          {
                            username: settings.access.githubOwner,
                            token: githubToken,
                          },
                        ),
                      );
                      setGithubToken("");
                    })
                  }
                  className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40"
                >
                  {t("settings.accessSaveToken")}
                </AstryxButton>
                {vaultStatus.githubTokenConfigured ? (
                  <AstryxButton
                    type="button"
                    disabled={browser || busyAction !== ""}
                    onClick={() =>
                      void runAction("remove-token", async () => {
                        setVaultStatus(
                          await invoke<CloudSecretVaultStatus>(
                            "cloud_secret_vault_remove_github_token",
                          ),
                        );
                        setGithubToken("");
                      })
                    }
                    className="rounded-lg border border-border px-4 py-2 text-xs font-medium hover:bg-muted/50 disabled:opacity-40"
                  >
                    {t("settings.accessRemoveToken")}
                  </AstryxButton>
                ) : null}
              </AstryxView>
              {vaultStatus.githubUsername ? (
                <AstryxParagraph className="mt-2 text-[11px] text-muted-foreground">
                  {t("settings.accessTokenOwner").replace("{username}", vaultStatus.githubUsername)}
                </AstryxParagraph>
              ) : null}
              <AstryxParagraph className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {t("settings.accessVaultHint")}
              </AstryxParagraph>
            </AstryxView>
          </AstryxView>
        ) : null}
      </AstryxView>

      {actionError ? (
        <AstryxView
          layout="block"
          direction="horizontal"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {actionError}
        </AstryxView>
      ) : null}
    </AstryxView>
  );
}
