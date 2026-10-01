import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { StatusDot } from "@astryxdesign/core/StatusDot";
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
  listenMobileEnvironmentInstallProgress,
  listenMobileExecutionOutput,
  type MobileEnvironmentInstallProgress,
  type MobileExecutionStatus,
  mobileEnvironmentInstallLabel,
  mobileExecutionStatus,
  pickExternalMobileWorkspace,
  removeExternalMobileWorkspace,
  setMobileAlpineMirror,
} from "../../lib/mobileExecution";
import { normalizeRuntimePlatform, type RuntimePlatform } from "../../lib/runtimePlatform";
import type { SettingsSectionProps } from "./types";

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

export function MobileExecutionSection(_props: SettingsSectionProps) {
  const { t } = useLocale();
  const browser = isBrowserRuntime();
  const [platform, setPlatform] = useState<RuntimePlatform>();
  const [status, setStatus] = useState<MobileExecutionStatus>();
  const [selected, setSelected] = useState<string[]>([]);
  const [externalWorkspaces, setExternalWorkspaces] = useState<ExternalMobileWorkspace[]>([]);
  const [busy, setBusy] = useState<
    "status" | "environment" | "toolchains" | "cancel" | "mirror" | ""
  >("");
  const [activeRunId, setActiveRunId] = useState("");
  const [toolchainOutput, setToolchainOutput] = useState("");
  const [error, setError] = useState("");
  const [installProgress, setInstallProgress] = useState<MobileEnvironmentInstallProgress | null>(
    null,
  );

  const isNativeMobile = !browser && (platform === "android" || platform === "ios");

  const refresh = useCallback(async () => {
    if (!isNativeMobile) return;
    setBusy((current) => current || "status");
    setError("");
    try {
      const [next, mounted] = await Promise.all([
        mobileExecutionStatus(),
        listExternalMobileWorkspaces().catch((cause) => {
          // A revoked folder grant must not hide the independent Shell installer.
          setError(cause instanceof Error ? cause.message : String(cause));
          return [];
        }),
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

  async function installEnvironment() {
    setBusy("environment");
    setError("");
    setInstallProgress({ phase: "preparing" });
    const stopProgress = await listenMobileEnvironmentInstallProgress(setInstallProgress).catch(
      () => undefined,
    );
    try {
      const result = await installMobileEnvironment();
      if (!result.installed) throw new Error(result.detail || t("settings.mobileNotInstalled"));
      await refresh();
    } catch (cause) {
      await refresh();
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      stopProgress?.();
      setInstallProgress(null);
      setBusy("");
    }
  }

  async function chooseAlpineMirror(id: string) {
    setBusy("mirror");
    setError("");
    try {
      setStatus(await setMobileAlpineMirror(id));
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
    setToolchainOutput("");
    let stopOutput: (() => Promise<void>) | undefined;
    try {
      const decoder = { stdout: new TextDecoder(), stderr: new TextDecoder() };
      stopOutput = await listenMobileExecutionOutput((event) => {
        if (event.runId !== runId || (event.stream !== "stdout" && event.stream !== "stderr")) {
          return;
        }
        try {
          const bytes = Uint8Array.from(atob(event.data), (char) => char.charCodeAt(0));
          const chunk = decoder[event.stream].decode(bytes, { stream: true });
          setToolchainOutput((current) => (current + chunk).slice(-8_192));
        } catch {
          // The final install response remains authoritative if a chunk is malformed.
        }
      });
    } catch {
      // Live output is optional; package installation still reports its final result.
    }
    try {
      const result = await installMobileToolchains(selected, runId);
      const completedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      if (completedOutput) setToolchainOutput(completedOutput.slice(-8_192));
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
      await stopOutput?.().catch(() => undefined);
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
    <Section padding={5} width="100%" className="mobile-execution-section">
      <VStack gap={4}>
        <HStack gap={3} hAlign="between" vAlign="start" wrap="wrap">
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
            <HStack gap={1} vAlign="center">
              <StatusDot
                label={
                  status?.installed ? t("settings.mobileReady") : t("settings.mobileNotInstalled")
                }
                variant={status?.installed ? "success" : "neutral"}
              />
              <Text type="supporting" color="secondary" aria-hidden="true">
                {status?.installed ? t("settings.mobileReady") : t("settings.mobileNotInstalled")}
              </Text>
            </HStack>
          ) : null}
        </HStack>

        {error ? <Banner status="error" title={error} collapsible={false} /> : null}

        {!isNativeMobile ? (
          <Banner status="info" title={t("settings.mobileNativeOnly")} collapsible={false} />
        ) : (
          <VStack gap={4}>
            <HStack gap={2} wrap="wrap">
              {!status?.installed ? (
                <Button
                  type="button"
                  label={
                    busy === "environment"
                      ? t("settings.mobileInstalling")
                      : t("settings.mobileInstallEnvironment")
                  }
                  variant="primary"
                  isLoading={busy === "environment"}
                  isDisabled={busy !== ""}
                  onClick={() => void installEnvironment()}
                />
              ) : null}
              <Button
                type="button"
                label={t("settings.mobileRefresh")}
                variant="secondary"
                isLoading={busy === "status"}
                isDisabled={busy !== ""}
                onClick={() => void refresh()}
              />
            </HStack>

            {busy === "environment" ? (
              <ProgressBar
                label={mobileEnvironmentInstallLabel(installProgress, t)}
                value={installProgress?.percent ?? 0}
                isIndeterminate={typeof installProgress?.percent !== "number"}
                hasValueLabel={typeof installProgress?.percent === "number"}
              />
            ) : null}

            {status?.installed && status.toolchains.length > 0 ? (
              <VStack gap={3}>
                <Heading level={4}>{t("settings.mobileCapabilityPacks")}</Heading>
                {pendingToolchains.length > 0 ? (
                  <HStack gap={2} wrap="wrap" className="mobile-execution-install-bar">
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
                {activeRunId || toolchainOutput ? (
                  <VStack gap={2}>
                    {activeRunId ? (
                      <ProgressBar label={t("settings.mobileInstalling")} isIndeterminate />
                    ) : null}
                    {toolchainOutput ? (
                      <VStack gap={1}>
                        <Text type="supporting" color="secondary">
                          {t("settings.mobileInstallOutput")}
                        </Text>
                        <Text
                          type="code"
                          color="secondary"
                          wordBreak="break-word"
                          className="mobile-execution-install-output"
                          aria-live="off"
                        >
                          {toolchainOutput}
                        </Text>
                      </VStack>
                    ) : null}
                  </VStack>
                ) : null}
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
              </VStack>
            ) : null}

            {platform === "android" && status?.alpineMirrors?.length ? (
              <Selector
                label={t("settings.mobileAlpineMirror")}
                description={t("settings.mobileAlpineMirrorHint")}
                options={status.alpineMirrors.map((mirror) => ({
                  value: mirror.id,
                  label: mirror.name,
                }))}
                value={status.selectedAlpineMirror ?? "official"}
                onChange={(id) => void chooseAlpineMirror(id)}
                isDisabled={busy !== ""}
                presentation="adaptive"
                width="100%"
              />
            ) : null}

            <Text type="supporting" color="secondary" wordBreak="break-word">
              {t("settings.mobileWithoutShell")}
            </Text>
            <Text type="supporting" color="secondary" wordBreak="break-word">
              {t(platform === "ios" ? "settings.mobileIosSource" : "settings.mobileAndroidSource")}
            </Text>
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

            {status?.capabilities.userSelectedWorkspaces ? (
              <VStack gap={3}>
                <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
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
                        className="settings-control-row"
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
                          <HStack gap={2} vAlign="center" wrap="wrap">
                            <HStack gap={1} vAlign="center">
                              <StatusDot
                                label={
                                  workspace.active
                                    ? t("settings.mobileReady")
                                    : t("settings.native.unavailable")
                                }
                                variant={workspace.active ? "success" : "warning"}
                              />
                              <Text type="supporting" color="secondary" aria-hidden="true">
                                {workspace.active
                                  ? t("settings.mobileReady")
                                  : t("settings.native.unavailable")}
                              </Text>
                            </HStack>
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
      </VStack>
    </Section>
  );
}
