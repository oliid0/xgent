import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Section } from "@astryxdesign/core/Section";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { invoke, isBrowserRuntime } from "@xgent/runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, Terminal, Trash2 } from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  cancelMobileExecution,
  type ExternalMobileWorkspace,
  installMobileEnvironment,
  installMobileToolchains,
  listExternalMobileWorkspaces,
  type MobileExecutionStatus,
  mobileExecutionStatus,
  pickExternalMobileWorkspace,
  removeExternalMobileWorkspace,
} from "../../lib/mobileExecution";
import { normalizeRuntimePlatform, type RuntimePlatform } from "../../lib/runtimePlatform";
import type { AppSettings } from "../../lib/settings";
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
  const [externalWorkspaces, setExternalWorkspaces] = useState<ExternalMobileWorkspace[]>([]);
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
      const [next, mounted] = await Promise.all([
        mobileExecutionStatus(),
        listExternalMobileWorkspaces(),
      ]);
      setStatus(next);
      setExternalWorkspaces(mounted);
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
    if (!enabled && status && !status.installed) {
      void installEnvironment();
      return;
    }
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
      if (platform === "android") {
        updateAccess(setSettings, { androidProotEnabled: true });
      } else if (platform === "ios") {
        updateAccess(setSettings, { iosAShellEnabled: true });
      }
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

  async function chooseExternalWorkspace() {
    setBusy("environment");
    setError("");
    try {
      await pickExternalMobileWorkspace(true);
      setExternalWorkspaces(await listExternalMobileWorkspaces());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  }

  async function removeExternalWorkspace(id: string) {
    setBusy("environment");
    setError("");
    try {
      await removeExternalMobileWorkspace(id);
      setExternalWorkspaces(await listExternalMobileWorkspaces());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  }

  return (
    <Section padding={5} width="100%">
      <VStack gap={4}>
        <HStack gap={3} hAlign="between" vAlign="start">
          <Terminal />
          <StackItem size="fill">
            <VStack gap={1}>
              <Heading level={3}>{t("settings.accessMobileExecution")}</Heading>
              <Text type="supporting" color="secondary" wordBreak="break-word">
                {platform === "android"
                  ? t("settings.accessAndroidProotHint")
                  : platform === "ios"
                    ? t("settings.accessIosAShellHint")
                    : t("settings.mobileNativeOnly")}
              </Text>
            </VStack>
          </StackItem>
          {isNativeMobile ? (
            <Switch
              value={enabled}
              label={t("settings.mobileEnable")}
              isLabelHidden
              isDisabled={!status?.available || busy !== ""}
              disabledMessage={!status?.available ? t("settings.mobileNativeOnly") : undefined}
              onChange={toggleEnabled}
            />
          ) : null}
        </HStack>

        {!isNativeMobile ? (
          <Banner status="info" title={t("settings.mobileNativeOnly")} collapsible={false} />
        ) : (
          <VStack gap={4}>
            <MetadataList>
              <MetadataListItem label={t("settings.mobileBackend")}>
                <Text type="body">{status?.backend ?? "—"}</Text>
              </MetadataListItem>
              <MetadataListItem label={t("settings.mobileEnvironment")}>
                <Text type="body">
                  {status?.environmentVersion ??
                    (status?.installed
                      ? t("settings.mobileReady")
                      : t("settings.mobileNotInstalled"))}
                </Text>
              </MetadataListItem>
              <MetadataListItem label={t("settings.mobileDiskUsage")}>
                <Text type="body" hasTabularNumbers>
                  {formatBytes(status?.diskUsageBytes)}
                </Text>
              </MetadataListItem>
            </MetadataList>

            {status?.detail ? (
              <Text type="supporting" color="secondary">
                {status.detail}
              </Text>
            ) : null}

            <HStack gap={2} wrap="wrap">
              <Button
                type="button"
                label={t("settings.mobileRefresh")}
                variant="secondary"
                isLoading={busy === "status"}
                isDisabled={busy !== ""}
                onClick={() => void refresh()}
              />
              {status && !status.installed ? (
                <Button
                  type="button"
                  label={
                    busy === "environment"
                      ? t("settings.mobileInstalling")
                      : t("settings.mobileInstallEnvironment")
                  }
                  variant="primary"
                  isLoading={busy === "environment"}
                  isDisabled={!status.available || busy !== ""}
                  onClick={() => void installEnvironment()}
                />
              ) : null}
            </HStack>

            {status?.installed && status.toolchains.length > 0 ? (
              <VStack gap={3}>
                <Heading level={4}>{t("settings.mobileCapabilityPacks")}</Heading>
                <Grid columns={{ minWidth: 240, max: 2, repeat: "fit" }} gap={2} width="100%">
                  {status.toolchains.map((toolchain) => {
                    const checked = toolchain.installed || selected.includes(toolchain.id);
                    return (
                      <CheckboxInput
                        key={toolchain.id}
                        label={toolchain.label}
                        description={toolchain.detail || undefined}
                        value={checked}
                        isDisabled={toolchain.installed || !toolchain.installable || busy !== ""}
                        onChange={() =>
                          setSelected((current) =>
                            current.includes(toolchain.id)
                              ? current.filter((id) => id !== toolchain.id)
                              : [...current, toolchain.id],
                          )
                        }
                        size="sm"
                      />
                    );
                  })}
                </Grid>
                {pendingToolchains.length > 0 ? (
                  <HStack gap={2} wrap="wrap">
                    <Button
                      type="button"
                      label={
                        busy === "toolchains" || busy === "cancel"
                          ? t("settings.mobileInstalling")
                          : t("settings.mobileInstallSelected")
                      }
                      variant="primary"
                      isLoading={busy === "toolchains"}
                      isDisabled={selected.length === 0 || busy !== ""}
                      onClick={() => void installSelected()}
                    />
                    {activeRunId ? (
                      <Button
                        type="button"
                        label={t("settings.mobileCancel")}
                        variant="secondary"
                        isLoading={busy === "cancel"}
                        isDisabled={busy === "cancel"}
                        onClick={() => void cancelInstall()}
                      />
                    ) : null}
                  </HStack>
                ) : null}
              </VStack>
            ) : null}

            {status?.capabilities.userSelectedWorkspaces ? (
              <VStack gap={3}>
                <HStack gap={3} hAlign="between" vAlign="center">
                  <StackItem size="fill">
                    <VStack gap={1}>
                      <Heading level={4}>{t("settings.mobileExternalWorkspaces")}</Heading>
                      <Text type="supporting" color="secondary">
                        {t("settings.mobileExternalWorkspacesHint")}
                      </Text>
                    </VStack>
                  </StackItem>
                  <Button
                    type="button"
                    label={t("settings.mobileMountFolder")}
                    variant="secondary"
                    isDisabled={busy !== ""}
                    onClick={() => void chooseExternalWorkspace()}
                  />
                </HStack>
                {externalWorkspaces.length > 0 ? (
                  <List density="balanced" hasDividers>
                    {externalWorkspaces.map((workspace) => (
                      <ListItem
                        key={workspace.id}
                        label={workspace.name}
                        startContent={<FolderOpen />}
                        description={
                          <VStack gap={0.5}>
                            <Text type="code" color="secondary" maxLines={1}>
                              {workspace.path}
                            </Text>
                            {workspace.detail ? (
                              <Text type="supporting" color="secondary" maxLines={2}>
                                {workspace.detail}
                              </Text>
                            ) : null}
                          </VStack>
                        }
                        endContent={
                          <HStack gap={2} vAlign="center">
                            <StatusDot
                              label={
                                workspace.active
                                  ? t("settings.mobileReady")
                                  : t("settings.mobileNotInstalled")
                              }
                              variant={workspace.active ? "success" : "warning"}
                            />
                            <Token
                              label={
                                workspace.writable
                                  ? t("settings.mobileReadWrite")
                                  : t("settings.mobileReadOnly")
                              }
                              color="gray"
                              size="sm"
                            />
                            <IconButton
                              label={t("settings.delete")}
                              tooltip={t("settings.delete")}
                              icon={<Trash2 />}
                              variant="destructive"
                              size="sm"
                              isDisabled={busy !== ""}
                              onClick={() => void removeExternalWorkspace(workspace.id)}
                            />
                          </HStack>
                        }
                      />
                    ))}
                  </List>
                ) : (
                  <EmptyState
                    icon={<FolderOpen />}
                    title={t("settings.mobileNoExternalWorkspaces")}
                    isCompact
                  />
                )}
              </VStack>
            ) : null}
          </VStack>
        )}

        {error ? <Banner status="error" title={error} collapsible={false} /> : null}
      </VStack>
    </Section>
  );
}
