import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { invoke, isBrowserRuntime, openUrl } from "@xgent/runtime";
import { useEffect, useState } from "react";
import { useLocale } from "../../i18n";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import { updateMcp } from "../../lib/settings";
import { createMcpTools } from "../../lib/tools/mcpTools";
import { presentationControls } from "../../presentation/controls";
import { NativeSurface } from "../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";
import type { SettingsSectionProps } from "./types";

type Status = {
  enabled: boolean;
  installed: boolean;
  target: string;
  version: string | null;
  permissionsRequired: boolean;
};

export function ComputerUseSection({
  settings,
  setSettings,
  onBack,
}: SettingsSectionProps & { onBack?: () => void }) {
  const { t } = useLocale();
  const [status, setStatus] = useState<Status>();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [driverPath, setDriverPath] = useState("cua-driver");
  const [driverResult, setDriverResult] = useState("");
  const selectedDriver = settings.mcp.computerUseDriverId;
  const driver = settings.mcp.servers.find((server) => server.id === selectedDriver);

  async function checkDriver() {
    if (!driver) return;
    setBusy(true);
    setError("");
    setDriverResult("");
    try {
      const bundle = await createMcpTools({ servers: [driver], loadFailureMode: "throw" });
      if (!bundle.tools.length) throw new Error(t("settings.cua.driverEmpty"));
      setDriverResult(bundle.tools.map((tool) => tool.name).join(", "));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    if (isBrowserRuntime()) {
      setSupported(false);
      return;
    }
    void invoke<{ platform: string }>("app_runtime_platform")
      .then(async ({ platform }) => {
        if (disposed) return;
        if (!["windows", "linux", "macos"].includes(platform)) {
          setSupported(false);
          return;
        }
        setSupported(true);
        const next = await invoke<Status>("cua_status");
        if (!disposed) setStatus(next);
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause));
      });
    return () => {
      disposed = true;
    };
  }, []);

  async function run(command: "cua_status" | "cua_set_enabled", enabled?: boolean) {
    setBusy(true);
    setError("");
    try {
      setStatus(await invoke<Status>(command, enabled === undefined ? {} : { enabled }));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (isApplePresentationRuntime()) {
    const compact = isNativeMobileRuntime();
    const c = presentationControls();
    c.handlers.set("close", {
      enabled: !busy,
      accepts: (value) => value === null,
      run: () => onBack?.(),
    });
    const nodes: PresentationNode[] = [
      {
        id: "computer-use-description",
        kind: "Text",
        text: t("settings.cua.description"),
        secondary: true,
      },
      c.group("computer-use-driver", t("settings.cua.backend"), [
        c.select(
          "computer-use-backend",
          t("settings.cua.backend"),
          selectedDriver ?? "native",
          [
            { value: "native", label: t("settings.cua.native") },
            ...settings.mcp.servers.map((server) => ({
              value: server.id,
              label: server.description || server.id,
            })),
          ],
          (value) => {
            setDriverResult("");
            setSettings((previous) =>
              updateMcp(previous, {
                computerUseDriverId: value === "native" ? undefined : value,
              }),
            );
          },
        ),
        c.input(
          "computer-use-driver-path",
          t("settings.cua.driverPath"),
          driverPath,
          setDriverPath,
        ),
        c.action(
          "computer-use-add-driver",
          t("settings.cua.addDriver"),
          () =>
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
                    command: driverPath.trim(),
                    args: ["mcp"],
                    url: "",
                    timeoutMs: 60_000,
                  },
                ],
              }),
            ),
          !!driverPath.trim() && !busy && supported === true,
        ),
        c.action("computer-use-install-driver", t("settings.cua.installDriver"), () =>
          openUrl("https://cua.ai/docs/how-to-guides/driver/install"),
        ),
        ...(selectedDriver
          ? [
              {
                id: "computer-use-selected-driver",
                kind: "CodeBlock" as const,
                language: "shell",
                text: driver
                  ? `${driver.command || driver.url} ${(driver.args ?? []).join(" ")}`
                  : t("settings.cua.driverMissing"),
              },
              c.action(
                "computer-use-check-driver",
                t("settings.cua.checkDriver"),
                checkDriver,
                !busy && Boolean(driver?.enabled),
              ),
            ]
          : []),
        ...(driverResult
          ? [{ id: "computer-use-driver-result", kind: "Text" as const, text: driverResult }]
          : []),
      ]),
      ...(!selectedDriver
        ? [
            c.group("computer-use-native", t("settings.cua.native"), [
              c.toggle(
                "computer-use-enabled",
                t("settings.cua.enable"),
                status?.enabled ?? false,
                (enabled) => run("cua_set_enabled", enabled),
                !busy && Boolean(status) && supported === true,
              ),
              {
                id: "computer-use-status",
                kind: "Text" as const,
                secondary: true,
                text:
                  supported === false
                    ? t("settings.cua.unavailable")
                    : status
                      ? `${t("settings.cua.installed")} · ${status.target} · ${status.version ?? ""}`
                      : t("settings.cua.loading"),
              },
              c.action(
                "computer-use-refresh",
                t("settings.cua.refresh"),
                () => run("cua_status"),
                !busy && supported === true,
              ),
            ]),
          ]
        : []),
      ...(busy
        ? [{ id: "computer-use-busy", kind: "Progress" as const, label: t("settings.cua.working") }]
        : []),
      ...(error
        ? [
            {
              id: "computer-use-error",
              kind: "Banner" as const,
              label: error,
              status: "error" as const,
            },
          ]
        : []),
    ];
    return (
      <NativeSurface
        document={{
          mode: "sheet",
          title: t("settings.cua.title"),
          appearance: settings.theme,
          formFactor: compact ? "mobile" : "desktop",
          theme: createNativePresentationTheme(settings, compact, "workspaceTools"),
          nodes,
          dismissAction: busy ? undefined : "close",
        }}
        handlers={c.handlers}
        onError={(cause) => setError(cause instanceof Error ? cause.message : String(cause))}
      />
    );
  }

  return (
    <Section padding={4} width="100%">
      <VStack gap={3} width="100%">
        <Heading level={3}>{t("settings.cua.title")}</Heading>
        <Text type="supporting" color="secondary">
          {t("settings.cua.description")}
        </Text>
        <Selector
          width="100%"
          isDisabled={busy}
          label={t("settings.cua.backend")}
          value={selectedDriver ?? "native"}
          options={[
            { value: "native", label: t("settings.cua.native") },
            ...settings.mcp.servers.map((server) => ({
              value: server.id,
              label: server.description || server.id,
            })),
          ]}
          onChange={(value) => {
            setDriverResult("");
            setSettings((prev) =>
              updateMcp(prev, { computerUseDriverId: value === "native" ? undefined : value }),
            );
          }}
        />
        <Text type="supporting">{t("settings.cua.driverDescription")}</Text>
        <TextInput
          label={t("settings.cua.driverPath")}
          value={driverPath}
          onChange={setDriverPath}
        />
        <Button
          label={t("settings.cua.addDriver")}
          isDisabled={
            !driverPath.trim() || busy || supported !== true || status?.target === "android"
          }
          onClick={() =>
            setSettings((prev) =>
              updateMcp(prev, {
                computerUseDriverId: "cua-driver",
                servers: [
                  ...prev.mcp.servers.filter((server) => server.id !== "cua-driver"),
                  {
                    id: "cua-driver",
                    description: "CUA driver",
                    enabled: true,
                    transport: "stdio",
                    command: driverPath.trim(),
                    args: ["mcp"],
                    url: "",
                    timeoutMs: 60_000,
                  },
                ],
              }),
            )
          }
        />
        <Button
          label={t("settings.cua.installDriver")}
          variant="ghost"
          onClick={() => {
            void openUrl("https://cua.ai/docs/how-to-guides/driver/install").catch((cause) =>
              setError(String(cause)),
            );
          }}
        />
        {selectedDriver ? (
          <VStack gap={2}>
            <Text style={{ overflowWrap: "anywhere" }}>
              {driver
                ? `${driver.command || driver.url} ${(driver.args ?? []).join(" ")}`
                : t("settings.cua.driverMissing")}
            </Text>
            {driver && !driver.enabled ? (
              <Text role="alert">{t("settings.cua.driverDisabled")}</Text>
            ) : null}
            <Button
              label={t("settings.cua.checkDriver")}
              isDisabled={busy || !driver?.enabled}
              onClick={() => void checkDriver()}
            />
            {driverResult ? (
              <Text role="status" style={{ overflowWrap: "anywhere" }}>
                {driverResult}
              </Text>
            ) : null}
          </VStack>
        ) : supported === false ? (
          <Text>{t("settings.cua.unavailable")}</Text>
        ) : (
          <VStack gap={3}>
            <Switch
              label={t("settings.cua.enable")}
              value={status?.enabled ?? false}
              isDisabled={busy || !status}
              onChange={(enabled) => void run("cua_set_enabled", enabled)}
            />
            <Text type="supporting">
              {status
                ? `${t("settings.cua.installed")} · ${status.target} · ${status.version}`
                : t("settings.cua.loading")}
            </Text>
            {status?.permissionsRequired && status.enabled ? (
              <VStack gap={2}>
                <Text type="supporting">
                  {t(
                    status.target === "android"
                      ? "settings.cua.androidPermissions"
                      : "settings.cua.permissions",
                  )}
                </Text>
                {status.target === "android" ? (
                  <Button
                    label={t("settings.cua.openPermissions")}
                    isDisabled={busy}
                    onClick={() => void run("cua_set_enabled", true)}
                  />
                ) : null}
                <Button
                  label={t("settings.cua.refresh")}
                  isDisabled={busy}
                  onClick={() => void run("cua_status")}
                />
              </VStack>
            ) : null}
          </VStack>
        )}
        {busy ? <Text role="status">{t("settings.cua.working")}</Text> : null}
        {error ? (
          <VStack gap={2}>
            <Text role="alert">{error}</Text>
            <Button
              label={t("settings.cua.refresh")}
              isDisabled={busy}
              onClick={() => void run("cua_status")}
            />
          </VStack>
        ) : null}
      </VStack>
    </Section>
  );
}
