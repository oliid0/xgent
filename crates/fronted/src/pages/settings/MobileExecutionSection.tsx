import { invoke, isBrowserRuntime } from "@xagent/runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, Terminal, X } from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  cancelMobileExecution,
  installMobileEnvironment,
  installMobileToolchains,
  mobileExecutionStatus,
  type MobileExecutionStatus,
} from "../../lib/mobileExecution";
import { normalizeRuntimePlatform, type RuntimePlatform } from "../../lib/runtimePlatform";
import type { AppSettings } from "../../lib/settings";
import { AgentActivationSwitch } from "./shared";
import type { SettingsSectionProps } from "./types";

function updateAccess(
  setSettings: SettingsSectionProps["setSettings"],
  patch: Partial<AppSettings["access"]>,
) {
  setSettings((previous) => ({
    ...previous,
    access: { ...previous.access, ...patch },
  }));
}

function formatBytes(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  const units = ["B", "KiB", "MiB", "GiB"];
  let amount = Math.max(0, value);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function createRunId() {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `mobile-install-${suffix}`.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
}

export function MobileExecutionSection({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();
  const browser = isBrowserRuntime();
  const [platform, setPlatform] = useState<RuntimePlatform>();
  const [status, setStatus] = useState<MobileExecutionStatus>();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<"status" | "environment" | "toolchains" | "cancel" | "">("");
  const [activeRunId, setActiveRunId] = useState("");
  const [error, setError] = useState("");

  const isNativeMobile = !browser && (platform === "android" || platform === "ios");
  const enabled =
    platform === "android" ? settings.access.androidProotEnabled : settings.access.iosAShellEnabled;

  const refresh = useCallback(async () => {
    if (!isNativeMobile) return;
    setBusy((current) => current || "status");
    setError("");
    try {
      const next = await mobileExecutionStatus();
      setStatus(next);
      setSelected((current) =>
        current.filter((id) =>
          next.toolchains.some(
            (toolchain) => toolchain.id === id && !toolchain.installed && toolchain.installable,
          ),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy((current) => (current === "status" ? "" : current));
    }
  }, [isNativeMobile]);

  useEffect(() => {
    let disposed = false;
    void invoke<{ platform?: unknown }>("app_runtime_platform")
      .then((response) => {
        if (!disposed) setPlatform(normalizeRuntimePlatform(response.platform));
      })
      .catch((cause) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pendingToolchains = useMemo(
    () =>
      status?.toolchains.filter((toolchain) => !toolchain.installed && toolchain.installable) ?? [],
    [status],
  );

  function toggleEnabled() {
    if (platform === "android") {
      updateAccess(setSettings, { androidProotEnabled: !settings.access.androidProotEnabled });
    } else if (platform === "ios") {
      updateAccess(setSettings, { iosAShellEnabled: !settings.access.iosAShellEnabled });
    }
  }

  async function installEnvironment() {
    setBusy("environment");
    setError("");
    try {
      await installMobileEnvironment();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  }

  async function installSelected() {
    if (selected.length === 0) return;
    const runId = createRunId();
    setActiveRunId(runId);
    setBusy("toolchains");
    setError("");
    try {
      const result = await installMobileToolchains(selected, runId);
      setStatus((current) => (current ? { ...current, toolchains: result.status } : current));
      if (!result.succeeded) {
        throw new Error(
          result.cancelled
            ? t("settings.mobileInstallCancelled")
            : result.stderr.trim() || `Package installation exited with code ${result.exitCode}`,
        );
      }
      setSelected([]);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActiveRunId("");
      setBusy("");
    }
  }

  async function cancelInstall() {
    if (!activeRunId) return;
    setBusy("cancel");
    try {
      await cancelMobileExecution(activeRunId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("toolchains");
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">{t("settings.accessMobileExecution")}</div>
            <p className="text-xs text-muted-foreground">
              {platform === "android"
                ? t("settings.accessAndroidProotHint")
                : platform === "ios"
                  ? t("settings.accessIosAShellHint")
                  : t("settings.mobileNativeOnly")}
            </p>
          </div>
        </div>
        {isNativeMobile ? (
          <AgentActivationSwitch
            checked={enabled}
            title={t("settings.mobileEnable")}
            onToggle={toggleEnabled}
          />
        ) : null}
      </div>

      {!isNativeMobile ? (
        <div className="rounded-lg bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("settings.mobileNativeOnly")}
        </div>
      ) : (
        <>
          <div className="grid gap-3 text-xs sm:grid-cols-3">
            <div className="rounded-lg bg-muted/30 px-3 py-2.5">
              <div className="text-muted-foreground">{t("settings.mobileBackend")}</div>
              <div className="mt-1 font-medium">{status?.backend ?? "—"}</div>
            </div>
            <div className="rounded-lg bg-muted/30 px-3 py-2.5">
              <div className="text-muted-foreground">{t("settings.mobileEnvironment")}</div>
              <div className="mt-1 font-medium">
                {status?.environmentVersion ??
                  (status?.installed
                    ? t("settings.mobileReady")
                    : t("settings.mobileNotInstalled"))}
              </div>
            </div>
            <div className="rounded-lg bg-muted/30 px-3 py-2.5">
              <div className="text-muted-foreground">{t("settings.mobileDiskUsage")}</div>
              <div className="mt-1 font-medium">{formatBytes(status?.diskUsageBytes)}</div>
            </div>
          </div>

          {status?.detail ? <p className="text-xs text-muted-foreground">{status.detail}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== ""}
              onClick={() => void refresh()}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted/50 disabled:opacity-40"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("settings.mobileRefresh")}
            </button>
            {platform === "android" && status && !status.installed ? (
              <button
                type="button"
                disabled={!status.available || busy !== ""}
                onClick={() => void installEnvironment()}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40"
              >
                {busy === "environment"
                  ? t("settings.mobileInstalling")
                  : t("settings.mobileInstallEnvironment")}
              </button>
            ) : null}
          </div>

          {status?.installed && status.toolchains.length > 0 ? (
            <div className="space-y-3">
              <div className="text-xs font-medium">{t("settings.mobileCapabilityPacks")}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {status.toolchains.map((toolchain) => {
                  const checked = toolchain.installed || selected.includes(toolchain.id);
                  return (
                    <label
                      key={toolchain.id}
                      className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2.5 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={toolchain.installed || !toolchain.installable || busy !== ""}
                        onChange={() =>
                          setSelected((current) =>
                            current.includes(toolchain.id)
                              ? current.filter((id) => id !== toolchain.id)
                              : [...current, toolchain.id],
                          )
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{toolchain.label}</span>
                        {toolchain.detail ? (
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                            {toolchain.detail}
                          </span>
                        ) : null}
                      </span>
                      {toolchain.installed ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : null}
                    </label>
                  );
                })}
              </div>
              {pendingToolchains.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={selected.length === 0 || busy !== ""}
                    onClick={() => void installSelected()}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40"
                  >
                    {busy === "toolchains" || busy === "cancel"
                      ? t("settings.mobileInstalling")
                      : t("settings.mobileInstallSelected")}
                  </button>
                  {activeRunId ? (
                    <button
                      type="button"
                      disabled={busy === "cancel"}
                      onClick={() => void cancelInstall()}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted/50 disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" />
                      {t("settings.mobileCancel")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </section>
  );
}
