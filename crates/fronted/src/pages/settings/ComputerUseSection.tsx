import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useConfirmDialog } from "../../components/astryx/useConfirmDialog";
import { useLocale } from "../../i18n";
import type { ComputerUsePermission } from "../../lib/computerUseSettings";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import { presentationControls } from "../../presentation/controls";
import { NativeSurface } from "../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";
import type { SettingsSectionProps } from "./types";
import { useComputerUseSettings } from "./useComputerUseSettings";

export function ComputerUseSection({
  settings,
  setSettings,
  onBack,
  nativeSettingsSurfaceId,
}: SettingsSectionProps & { onBack?: () => void }) {
  const { t } = useLocale();
  const { confirm, dialog } = useConfirmDialog();
  const {
    status,
    supported,
    busy,
    error,
    setError,
    driverPath,
    setDriverPath,
    driverResult,
    installProgress,
    selectedDriver,
    driver,
    run,
    requestPermission,
    checkDriver,
    installDriver,
    selectDriver,
    addDriver,
  } = useComputerUseSettings({ settings, setSettings }, confirm, t);
  const permissionEntries: Array<{
    id: ComputerUsePermission;
    label: string;
    description: string;
  }> = [
    {
      id: "accessibility",
      label: t("settings.cua.accessibility"),
      description: t("settings.cua.accessibilityDescription"),
    },
    {
      id: "screenCapture",
      label: t("settings.cua.screenCapture"),
      description: t("settings.cua.screenCaptureDescription"),
    },
  ];

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
          selectDriver,
          !busy,
        ),
        c.input(
          "computer-use-driver-path",
          t("settings.cua.driverPath"),
          driverPath,
          setDriverPath,
        ),
        {
          id: "computer-use-driver-description",
          kind: "Text",
          text: t("settings.cua.driverDescription"),
          secondary: true,
        },
        c.action(
          "computer-use-add-driver",
          t("settings.cua.addDriver"),
          addDriver,
          !!driverPath.trim() && !busy && supported === true,
        ),
        c.action(
          "computer-use-install-driver",
          t("settings.cua.installDriver"),
          installDriver,
          !busy && supported === true,
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
              ...(driver && !driver.enabled
                ? [
                    {
                      id: "computer-use-driver-disabled",
                      kind: "Banner" as const,
                      label: t("settings.cua.driverDisabled"),
                      status: "error" as const,
                    },
                  ]
                : []),
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
            ...(status?.enabled && status.permissionsRequired
              ? [
                  {
                    id: "computer-use-permission-hint",
                    kind: "Text" as const,
                    text: t("settings.cua.permissions"),
                    secondary: true,
                  },
                ]
              : []),
            ...(status?.permissions
              ? [
                  c.group(
                    "computer-use-permissions",
                    t("settings.cua.permissionsTitle"),
                    permissionEntries.map(({ id, label, description }) => ({
                      id: `computer-use-permission:${id}`,
                      kind: "VStack" as const,
                      variant: "computer-use-permission",
                      label,
                      text: description,
                      spacing: 8,
                      children: [
                        {
                          id: `computer-use-permission:${id}:status`,
                          kind: "Badge" as const,
                          label: t(
                            status.permissions?.[id]
                              ? "settings.cua.granted"
                              : "settings.cua.notGranted",
                          ),
                          status: status.permissions?.[id]
                            ? ("completed" as const)
                            : ("pending" as const),
                        },
                        c.action(
                          `computer-use-permission:${id}:request`,
                          t("settings.cua.requestPermission"),
                          () => requestPermission(id),
                          !busy && supported === true && !status.permissions?.[id],
                        ),
                      ],
                    })),
                  ),
                ]
              : []),
          ]
        : []),
      ...(busy
        ? [{ id: "computer-use-busy", kind: "Progress" as const, label: t("settings.cua.working") }]
        : []),
      ...(installProgress
        ? [
            {
              id: "computer-use-install-progress",
              kind: "Text" as const,
              text: installProgress,
              secondary: true,
            },
          ]
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
      <>
        <NativeSurface
          sessionSurface={nativeSettingsSurfaceId}
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
        {dialog}
      </>
    );
  }

  return (
    <>
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
            onChange={selectDriver}
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
            onClick={addDriver}
          />
          <Button
            label={t("settings.cua.installDriver")}
            variant="ghost"
            isDisabled={busy || supported !== true}
            onClick={() => void installDriver().catch(() => undefined)}
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
                onClick={() => void checkDriver().catch(() => undefined)}
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
                onChange={(enabled) => void run("cua_set_enabled", enabled).catch(() => undefined)}
              />
              <Text type="supporting">
                {status
                  ? `${t("settings.cua.installed")} · ${status.target} · ${status.version}`
                  : t("settings.cua.loading")}
              </Text>
              {status?.permissions ? (
                <VStack gap={3}>
                  <Heading level={4}>{t("settings.cua.permissionsTitle")}</Heading>
                  {permissionEntries.map(({ id, label, description }) => (
                    <VStack key={id} gap={1}>
                      <Text>
                        {label}:{" "}
                        {t(
                          status.permissions?.[id]
                            ? "settings.cua.granted"
                            : "settings.cua.notGranted",
                        )}
                      </Text>
                      <Text type="supporting" color="secondary">
                        {description}
                      </Text>
                      <Button
                        label={t("settings.cua.requestPermission")}
                        isDisabled={busy || Boolean(status.permissions?.[id])}
                        onClick={() => void requestPermission(id).catch(() => undefined)}
                      />
                    </VStack>
                  ))}
                </VStack>
              ) : null}
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
                      onClick={() => void run("cua_set_enabled", true).catch(() => undefined)}
                    />
                  ) : null}
                  <Button
                    label={t("settings.cua.refresh")}
                    isDisabled={busy}
                    onClick={() => void run("cua_status").catch(() => undefined)}
                  />
                </VStack>
              ) : null}
            </VStack>
          )}
          {busy ? <Text role="status">{t("settings.cua.working")}</Text> : null}
          {installProgress ? <Text role="status">{installProgress}</Text> : null}
          {error ? (
            <VStack gap={2}>
              <Text role="alert">{error}</Text>
              <Button
                label={t("settings.cua.refresh")}
                isDisabled={busy}
                onClick={() => void run("cua_status").catch(() => undefined)}
              />
            </VStack>
          ) : null}
        </VStack>
      </Section>
      {dialog}
    </>
  );
}
