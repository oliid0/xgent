import { invoke, isBrowserRuntime, listen } from "@xgent/runtime";
import { useEffect, useState } from "react";
import type { ConfirmDialogOptions } from "../../components/astryx/useConfirmDialog";
import type { ComputerUsePermission, ComputerUseStatus } from "../../lib/computerUseSettings";
import { updateMcp } from "../../lib/settings";
import { createMcpTools } from "../../lib/tools/mcpTools";
import type { SettingsSectionProps } from "./types";

type DriverProbe = {
  installed: boolean;
  path: string | null;
  version: string | null;
  mcpCommand: string | null;
  mcpArgs: string[];
  error: string | null;
};

// Both clients use this operation lifecycle. Discovery, native permissions and
// external MCP probing keep their failures and may not replace a newer route.
export function useComputerUseSettings(
  { settings, setSettings }: SettingsSectionProps,
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>,
  t: (key: string) => string,
) {
  const [status, setStatus] = useState<ComputerUseStatus>();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [driverPath, setDriverPath] = useState("cua-driver");
  const [driverResult, setDriverResult] = useState<{ id: string; text: string } | null>(null);
  const [installProgress, setInstallProgress] = useState("");
  const selectedDriver = settings.mcp.computerUseDriverId;
  const driver = settings.mcp.servers.find((server) => server.id === selectedDriver);
  const operationScope = selectedDriver ?? "native";
  const [scope] = useState(() => ({
    active: true,
    current: operationScope,
    revision: 0,
    busy: false,
    unlisten: undefined as (() => void) | undefined,
  }));
  if (scope.current !== operationScope) {
    scope.current = operationScope;
    scope.revision++;
    scope.busy = false;
    scope.unlisten?.();
    scope.unlisten = undefined;
  }
  const busy = scope.busy && busyScope === operationScope;
  const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

  async function work(run: (current: () => boolean) => Promise<void>) {
    if (!scope.active || scope.busy || scope.current !== operationScope) return;
    const revision = ++scope.revision;
    const current = () =>
      scope.active && scope.current === operationScope && revision === scope.revision;
    scope.busy = true;
    setBusyScope(operationScope);
    setError("");
    try {
      await run(current);
    } catch (cause) {
      if (current()) {
        setError(message(cause));
        throw cause;
      }
    } finally {
      if (current()) {
        scope.busy = false;
        setBusyScope(null);
      }
    }
  }

  const run = (command: "cua_status" | "cua_set_enabled", enabled?: boolean) =>
    work(async (current) => {
      const next = await invoke<ComputerUseStatus>(
        command,
        enabled === undefined ? {} : { enabled },
      );
      if (current()) setStatus(next);
    });
  const requestPermission = (permission: ComputerUsePermission) =>
    work(async (current) => {
      const next = await invoke<ComputerUseStatus>("cua_request_permission", { permission });
      if (current()) setStatus(next);
    });
  const [latest] = useState(() => ({ run }));
  latest.run = run;
  const checkDriver = () =>
    work(async (current) => {
      if (!driver?.enabled)
        throw new Error(t(driver ? "settings.cua.driverDisabled" : "settings.cua.driverMissing"));
      setDriverResult(null);
      const bundle = await createMcpTools({ servers: [driver], loadFailureMode: "throw" });
      if (!bundle.tools.length) throw new Error(t("settings.cua.driverEmpty"));
      if (current())
        setDriverResult({
          id: operationScope,
          text: bundle.tools.map((tool) => tool.name).join(", "),
        });
    });

  const installDriver = () =>
    work(async (current) => {
      if (supported !== true) throw new Error(t("settings.cua.unavailable"));
      const preview = await invoke<{ display: string; sourceUrl: string }>(
        "cua_driver_install_command",
      );
      if (!current()) return;
      const approved = await confirm({
        title: t("settings.cua.installConfirmTitle"),
        description: t("settings.cua.installConfirmDescription"),
        detail: `${preview.display}\n${preview.sourceUrl}`,
        confirmLabel: t("settings.cua.installDriver"),
        cancelLabel: t("settings.cancel"),
        tone: "warning",
      });
      if (!approved || !current()) return;
      setInstallProgress("");
      const unlisten = await listen<{ stream: string; line: string }>(
        "cua_driver_install_progress",
        ({ payload }) => {
          if (current()) setInstallProgress(payload.line);
        },
      );
      if (!current()) {
        unlisten();
        return;
      }
      scope.unlisten = unlisten;
      try {
        const probe = await invoke<DriverProbe>("cua_driver_install");
        if (!current()) return;
        const command = probe.mcpCommand;
        if (!probe.installed || !probe.path || !command || probe.error)
          throw new Error(probe.error || t("settings.cua.installProbeFailed"));
        setDriverPath(probe.path);
        setSettings((previous) =>
          updateMcp(previous, {
            computerUseDriverId: "cua-driver",
            servers: [
              ...previous.mcp.servers.filter((server) => server.id !== "cua-driver"),
              {
                id: "cua-driver",
                description: "CUA driver",
                enabled: true,
                transport: "stdio",
                command,
                args: probe.mcpArgs,
                url: "",
                timeoutMs: 60_000,
              },
            ],
          }),
        );
        setDriverResult({
          id: "cua-driver",
          text: `${t("settings.cua.installComplete")} ${probe.version ?? ""}`.trim(),
        });
      } finally {
        // Teardown may already have retired this exact listener.
        if (scope.unlisten === unlisten) {
          unlisten();
          scope.unlisten = undefined;
        }
      }
    });

  function selectDriver(value: string) {
    setDriverResult(null);
    setError("");
    setInstallProgress("");
    setSettings((previous) =>
      updateMcp(previous, { computerUseDriverId: value === "native" ? undefined : value }),
    );
  }

  function addDriver() {
    const command = driverPath.trim();
    if (!scope.active || scope.busy || !command || supported !== true) return;
    setSettings((previous) =>
      updateMcp(previous, {
        computerUseDriverId: "cua-driver",
        servers: [
          ...previous.mcp.servers.filter((server) => server.id !== "cua-driver"),
          {
            id: "cua-driver",
            description: "CUA driver",
            enabled: true,
            transport: "stdio",
            command,
            args: ["mcp"],
            url: "",
            timeoutMs: 60_000,
          },
        ],
      }),
    );
  }

  useEffect(() => {
    scope.active = true;
    let disposed = false;
    if (isBrowserRuntime()) setSupported(false);
    else
      void invoke<{ platform: string }>("app_runtime_platform")
        .then(async ({ platform }) => {
          if (disposed) return;
          const available = ["windows", "linux", "macos"].includes(platform);
          setSupported(available);
          if (available) await latest.run("cua_status");
        })
        .catch((cause) => {
          if (!disposed) setError(message(cause));
        });
    return () => {
      disposed = true;
      scope.active = false;
      scope.revision++;
      scope.unlisten?.();
      scope.unlisten = undefined;
    };
  }, []);

  useEffect(() => {
    if (supported !== true || selectedDriver) return;
    const refresh = () => {
      if (document.visibilityState === "visible" && !scope.busy)
        void run("cua_status").catch(() => undefined);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [supported, selectedDriver]);

  return {
    status,
    supported,
    busy,
    error,
    setError,
    driverPath,
    setDriverPath,
    driverResult: driverResult?.id === operationScope ? driverResult.text : "",
    installProgress,
    selectedDriver,
    driver,
    run,
    requestPermission,
    checkDriver,
    installDriver,
    selectDriver,
    addDriver,
  };
}
