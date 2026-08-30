import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Section, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Selector } from "@astryxdesign/core/Selector";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { invoke, isBrowserRuntime, listen } from "@xagent/runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
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
} from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  browserSessionController,
  normalizeBrowserAddress,
} from "../../lib/browser/browserSessionController";
import type { AppSettings } from "../../lib/settings";
import type { SettingsSectionProps } from "./types";

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

const EMPTY_VAULT_STATUS: CloudSecretVaultStatus = { githubTokenConfigured: false };
const EMPTY_LAN_PC_STATUS: LanPcClientStatus = { paired: false };

type AccessSectionProps = SettingsSectionProps & { nativeMobile: boolean };

function updateAccess(
  setSettings: SettingsSectionProps["setSettings"],
  patch: Partial<AppSettings["access"]>,
) {
  setSettings((previous) => ({
    ...previous,
    access: { ...previous.access, ...patch },
  }));
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      variant="ghost"
      size="sm"
      label={label}
      tooltip={label}
      icon={<Icon icon={copied ? Check : Copy} size="sm" color="inherit" />}
      isDisabled={!value}
      onClick={() => {
        if (!value) return;
        void navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      }}
    />
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

function normalizeComparableLanUrl(value?: string | null) {
  if (!value?.trim()) return "";
  try {
    return normalizeLanControlUrl(value).replace(/\/$/, "");
  } catch {
    return "";
  }
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
    const next = await invoke<LanPcClientStatus>("lan_pc_status");
    setLanPcStatus(next);
    const authoritativeUrl = normalizeComparableLanUrl(next.baseUrl);
    if (next.paired && authoritativeUrl) {
      updateAccess(setSettings, { lanControlUrl: `${authoritativeUrl}/` });
    }
  }, [browser, nativeMobile, setSettings]);

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
        if (disposed) return unlisten();
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
  const pairedLanUrl = normalizeComparableLanUrl(lanPcStatus.baseUrl);
  const lanPcReady = lanPcStatus.paired && Boolean(pairedLanUrl);
  const localStatusPhase = localStatus.running
    ? "running"
    : localStatus.lastError
      ? "failed"
      : localStatus.enabled || settings.access.webUiEnabled
        ? "starting"
        : "stopped";
  const localStatusLabel =
    localStatusPhase === "running"
      ? t("settings.accessRunning")
      : localStatusPhase === "starting"
        ? t("settings.accessStarting")
        : localStatusPhase === "failed"
          ? t("settings.accessFailed")
          : t("settings.accessStopped");

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

  const cloudDetails = (
    <VStack gap={3}>
      <Grid columns={{ minWidth: 240, max: 2, repeat: "fit" }} gap={3} width="100%">
        <TextInput
          label={t("settings.accessGithubOwner")}
          value={settings.access.githubOwner}
          isDisabled={browser}
          onChange={(value) => updateAccess(setSettings, { githubOwner: value })}
          placeholder="github-user"
        />
        <TextInput
          label={t("settings.accessGithubRepository")}
          value={settings.access.githubRepository}
          isDisabled={browser}
          onChange={(value) => updateAccess(setSettings, { githubRepository: value })}
          placeholder="agent-temp"
        />
      </Grid>
      <Banner status="warning" title={t("settings.accessCloudPublicWarning")} collapsible={false} />
      <Text type="supporting" color="secondary">
        {t("settings.accessCloudEnvironmentHint")}
      </Text>
      <Section variant="muted" padding={3}>
        <VStack gap={3}>
          <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
            <HStack gap={2} vAlign="center">
              <Icon icon={Key} size="sm" color="secondary" />
              <Text type="label">{t("settings.accessSecureVault")}</Text>
            </HStack>
            <StatusDot
              variant={vaultStatus.githubTokenConfigured ? "success" : "neutral"}
              label={
                vaultStatus.githubTokenConfigured
                  ? t("settings.accessTokenConfigured")
                  : t("settings.accessTokenMissing")
              }
            />
          </HStack>
          <TextInput
            label={t("settings.accessGithubToken")}
            type="password"
            autoComplete="new-password"
            value={githubToken}
            onChange={setGithubToken}
            placeholder={t("settings.accessGithubToken")}
            isDisabled={browser}
          />
          <HStack gap={2} hAlign="end" wrap="wrap">
            {vaultStatus.githubTokenConfigured ? (
              <Button
                label={t("settings.accessRemoveToken")}
                variant="secondary"
                isDisabled={browser || busyAction !== ""}
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
              />
            ) : null}
            <Button
              label={t("settings.accessSaveToken")}
              variant="primary"
              isLoading={busyAction === "save-token"}
              isDisabled={
                browser ||
                !settings.access.githubOwner.trim() ||
                !githubToken.trim() ||
                busyAction !== ""
              }
              onClick={() =>
                void runAction("save-token", async () => {
                  setVaultStatus(
                    await invoke<CloudSecretVaultStatus>("cloud_secret_vault_set_github_token", {
                      username: settings.access.githubOwner,
                      token: githubToken,
                    }),
                  );
                  setGithubToken("");
                })
              }
            />
          </HStack>
          {vaultStatus.githubUsername ? (
            <Text type="supporting" color="secondary">
              {t("settings.accessTokenOwner").replace("{username}", vaultStatus.githubUsername)}
            </Text>
          ) : null}
          <Text type="supporting" color="secondary">
            {t("settings.accessVaultHint")}
          </Text>
        </VStack>
      </Section>
    </VStack>
  );

  return (
    <VStack width="100%" gap={3}>
      {browser ? (
        <Banner status="warning" title={t("settings.accessNativeOnly")} collapsible={false} />
      ) : null}

      {nativeMobile ? (
        <Section variant="section" padding={3}>
          <VStack gap={3}>
            <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
              <HStack gap={2} vAlign="center">
                <Icon icon={Wifi} size="md" color="secondary" />
                <VStack gap={0.5}>
                  <Heading level={4}>{t("settings.accessLanControl")}</Heading>
                  <Text type="supporting" color="secondary">
                    {t("settings.accessLanControlHint")}
                  </Text>
                </VStack>
              </HStack>
              <StatusDot
                variant={lanPcReady ? "success" : "neutral"}
                label={
                  lanPcReady
                    ? t("settings.accessComputerPaired")
                    : t("settings.accessComputerNotPaired")
                }
              />
            </HStack>
            <TextInput
              label={t("settings.accessComputerAddress")}
              {...({
                inputMode: "url",
                autoCapitalize: "none",
                autoCorrect: "off",
                spellCheck: false,
              } as const)}
              value={settings.access.lanControlUrl}
              placeholder="http://192.168.1.10:28367"
              onChange={(value) => updateAccess(setSettings, { lanControlUrl: value })}
              onBlur={() => {
                const value = settings.access.lanControlUrl.trim();
                if (!value) return;
                try {
                  updateAccess(setSettings, { lanControlUrl: normalizeLanControlUrl(value) });
                } catch {
                  // Keep the draft visible so it can be corrected.
                }
              }}
            />
            <Grid columns={{ minWidth: 220, max: 2, repeat: "fit" }} gap={3} width="100%">
              <TextInput
                label={t("settings.accessLanPairingCode")}
                type="password"
                {...({
                  inputMode: "numeric",
                  autoComplete: "one-time-code",
                  maxLength: 6,
                } as const)}
                value={lanPairingCode}
                placeholder="000000"
                onChange={(value) => setLanPairingCode(value.replace(/\D/g, "").slice(0, 6))}
              />
              <TextInput
                label={t("settings.accessLanDeviceName")}
                {...({ maxLength: 64 } as const)}
                value={lanDeviceName}
                onChange={setLanDeviceName}
              />
            </Grid>
            <HStack gap={2} wrap="wrap">
              <Button
                label={
                  busyAction === "lan-pair"
                    ? t("settings.accessConnecting")
                    : t("settings.accessPairComputer")
                }
                variant="primary"
                isLoading={busyAction === "lan-pair"}
                isDisabled={
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
              />
              {lanPcStatus.paired ? (
                <Button
                  label={t("settings.accessDisconnectComputer")}
                  variant="secondary"
                  isDisabled={busyAction !== ""}
                  onClick={() =>
                    void runAction("lan-disconnect", async () => {
                      setLanPcStatus(await invoke<LanPcClientStatus>("lan_pc_disconnect"));
                      updateAccess(setSettings, { preferLanPcExecution: false });
                    })
                  }
                />
              ) : null}
              {lanPcStatus.paired ? (
                <Button
                  label={t("settings.accessCheckComputer")}
                  variant="secondary"
                  isLoading={busyAction === "lan-refresh"}
                  isDisabled={busyAction !== "" || !pairedLanUrl}
                  onClick={() => void runAction("lan-refresh", refreshLanPcStatus)}
                />
              ) : null}
            </HStack>
            <Switch
              label={t("settings.accessPreferLanPc")}
              description={t("settings.accessPreferLanPcHint")}
              value={settings.access.preferLanPcExecution}
              labelIcon={MonitorSmartphone}
              labelPosition="start"
              labelSpacing="spread"
              width="100%"
              isDisabled={!lanPcReady}
              onChange={(value) => updateAccess(setSettings, { preferLanPcExecution: value })}
            />
            <Button
              label={
                busyAction === "lan-control"
                  ? t("settings.accessConnecting")
                  : t("settings.accessOpenComputer")
              }
              variant="primary"
              isLoading={busyAction === "lan-control"}
              isDisabled={!settings.access.lanControlUrl.trim() || busyAction !== ""}
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
            />
            <Text type="supporting" color="secondary">
              {t("settings.accessLanPairingHint")}
            </Text>
          </VStack>
        </Section>
      ) : (
        <Section variant="section" padding={3}>
          <VStack gap={3}>
            <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
              <HStack gap={2} vAlign="center">
                <Icon icon={MonitorSmartphone} size="md" color="secondary" />
                <VStack gap={0.5}>
                  <Heading level={4}>{t("settings.accessWebUi")}</Heading>
                  <Text type="supporting" color="secondary">
                    {t("settings.accessWebUiHint")}
                  </Text>
                </VStack>
              </HStack>
              <HStack gap={2} vAlign="center">
                <StatusDot
                  variant={
                    localStatusPhase === "running"
                      ? "success"
                      : localStatusPhase === "failed"
                        ? "error"
                        : localStatusPhase === "starting"
                          ? "warning"
                          : "neutral"
                  }
                  label={localStatusLabel}
                  isPulsing={localStatusPhase === "starting"}
                />
                <Switch
                  label={t("settings.accessWebUi")}
                  isLabelHidden
                  value={settings.access.webUiEnabled}
                  isDisabled={browser}
                  onChange={(value) => updateAccess(setSettings, { webUiEnabled: value })}
                />
              </HStack>
            </HStack>
            <Grid columns={{ minWidth: 220, max: 2, repeat: "fit" }} gap={3} width="100%">
              <Selector
                label={t("settings.accessScope")}
                value={settings.access.webUiScope}
                isDisabled={browser}
                width="100%"
                options={[
                  { value: "lan", label: t("settings.accessScopeLan") },
                  { value: "loopback", label: t("settings.accessScopeLoopback") },
                ]}
                onChange={(value) =>
                  updateAccess(setSettings, {
                    webUiScope: value === "loopback" ? "loopback" : "lan",
                  })
                }
              />
              <NumberInput
                label={t("settings.accessPort")}
                min={1}
                max={65_535}
                value={settings.access.webUiPort}
                isDisabled={browser}
                onChange={(value) =>
                  updateAccess(setSettings, {
                    webUiPort: Math.min(65_535, Math.max(1, value ?? 28_367)),
                  })
                }
              />
            </Grid>
            <HStack width="100%" gap={2} vAlign="center">
              <Icon icon={Globe} size="sm" color="secondary" />
              <StackItem size="fill">
                <Text type="code" color="secondary" maxLines={1}>
                  {endpoint}
                </Text>
              </StackItem>
              <CopyButton value={endpoint} label={t("workspaceEditor.context.copy")} />
              <IconButton
                label={t("projectTools.gitReview.refresh")}
                tooltip={t("projectTools.gitReview.refresh")}
                icon={<Icon icon={RefreshCw} size="sm" color="inherit" />}
                variant="ghost"
                size="sm"
                isLoading={busyAction === "refresh"}
                isDisabled={busyAction !== "" || browser}
                onClick={() => void runAction("refresh", refreshLocalStatus)}
              />
            </HStack>
            <List density="compact" hasDividers>
              <ListItem
                label={t("settings.accessAllowTerminal")}
                description={t("settings.accessAllowTerminalHint")}
                startContent={<Icon icon={Terminal} size="sm" color="secondary" />}
                endContent={
                  <Switch
                    label={t("settings.accessAllowTerminal")}
                    isLabelHidden
                    value={settings.access.allowTerminal}
                    isDisabled={browser}
                    onChange={(value) => updateAccess(setSettings, { allowTerminal: value })}
                  />
                }
              />
              <ListItem
                label={t("settings.accessAllowBrowserAutomation")}
                description={t("settings.accessAllowBrowserAutomationHint")}
                startContent={<Icon icon={Globe} size="sm" color="secondary" />}
                endContent={
                  <Switch
                    label={t("settings.accessAllowBrowserAutomation")}
                    isLabelHidden
                    value={settings.access.allowBrowserAutomation}
                    isDisabled={browser}
                    onChange={(value) =>
                      updateAccess(setSettings, { allowBrowserAutomation: value })
                    }
                  />
                }
              />
              <ListItem
                label={t("settings.accessAllowSsh")}
                description={t("settings.accessAllowSshHint")}
                startContent={<Icon icon={Server} size="sm" color="secondary" />}
                endContent={
                  <Switch
                    label={t("settings.accessAllowSsh")}
                    isLabelHidden
                    value={settings.access.allowSsh}
                    isDisabled={browser}
                    onChange={(value) => updateAccess(setSettings, { allowSsh: value })}
                  />
                }
              />
              <ListItem
                label={t("settings.accessAllowGit")}
                description={t("settings.accessAllowGitHint")}
                startContent={<Icon icon={GitBranch} size="sm" color="secondary" />}
                endContent={
                  <Switch
                    label={t("settings.accessAllowGit")}
                    isLabelHidden
                    value={settings.access.allowGit}
                    isDisabled={browser}
                    onChange={(value) => updateAccess(setSettings, { allowGit: value })}
                  />
                }
              />
              <ListItem
                label={t("settings.accessAllowFileWrite")}
                description={t("settings.accessAllowFileWriteHint")}
                startContent={<Icon icon={Shield} size="sm" color="secondary" />}
                endContent={
                  <Switch
                    label={t("settings.accessAllowFileWrite")}
                    isLabelHidden
                    value={settings.access.allowFileWrite}
                    isDisabled={browser}
                    onChange={(value) => updateAccess(setSettings, { allowFileWrite: value })}
                  />
                }
              />
            </List>
            <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
              <MetadataList orientation="horizontal">
                <MetadataListItem label={t("settings.accessPairing")}>
                  {t("settings.accessPairedDevices").replace(
                    "{count}",
                    String(localStatus.pairedDevices),
                  )}
                </MetadataListItem>
                {localStatus.pairingCode ? (
                  <MetadataListItem label={t("settings.accessLanPairingCode")}>
                    {localStatus.pairingCode}
                  </MetadataListItem>
                ) : null}
              </MetadataList>
              <Button
                label={t("settings.accessNewPairingCode")}
                variant="secondary"
                isLoading={busyAction === "pair"}
                isDisabled={!settings.access.webUiEnabled || busyAction !== "" || browser}
                onClick={() =>
                  void runAction("pair", async () => {
                    setLocalStatus(
                      await invoke<LocalAccessStatus>("local_access_rotate_pairing_code"),
                    );
                  })
                }
              />
            </HStack>
          </VStack>
        </Section>
      )}

      <Section variant="section" padding={3}>
        <VStack gap={3}>
          <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
            <HStack gap={2} vAlign="center">
              <Icon icon={Cloud} size="md" color="secondary" />
              <VStack gap={0.5}>
                <Heading level={4}>{t("settings.accessCloudExecution")}</Heading>
                <Text type="supporting" color="secondary">
                  {t("settings.accessCloudExecutionHint")}
                </Text>
              </VStack>
            </HStack>
            <Switch
              label={t("settings.accessCloudExecution")}
              isLabelHidden
              value={settings.access.cloudExecutionEnabled}
              isDisabled={browser}
              onChange={(value) => {
                updateAccess(setSettings, { cloudExecutionEnabled: value });
                if (nativeMobile && value) setCloudDetailsOpen(true);
              }}
            />
          </HStack>
          {nativeMobile ? (
            <Collapsible
              trigger={t("settings.accessCloudEnvironmentHint")}
              isOpen={cloudDetailsOpen}
              onOpenChange={setCloudDetailsOpen}
            >
              {cloudDetails}
            </Collapsible>
          ) : (
            cloudDetails
          )}
        </VStack>
      </Section>

      {actionError ? <Banner status="error" title={actionError} collapsible={false} /> : null}
    </VStack>
  );
}
