import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { VStack } from "@astryxdesign/core/Layout";
import { ListItem } from "@astryxdesign/core/List";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import type { ReactNode } from "react";
import {
  Cloud,
  GitBranch,
  Globe,
  MonitorSmartphone,
  Server,
  Shield,
  Terminal,
  Trash2,
  Wifi,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  type CloudSecretVaultStatus,
  type LanPcClientStatus,
  type LocalAccessStatus,
  normalizeComparableLanUrl,
} from "../../lib/localAccess";
import type { AppSettings } from "../../lib/settings";
import { SecretTextInput } from "./SecretTextInput";
import { SettingsRow, SettingsRowGroup, SettingsStatus, SettingsValueSelector } from "./shared";

export type AccessSettingsActions = {
  saveToken: () => Promise<void>;
  removeToken: () => Promise<void>;
  pair: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshLan: () => Promise<void>;
  openComputer: () => Promise<void>;
  refreshLocal: () => Promise<void>;
  rotatePairingCode: () => Promise<void>;
  revokeDevice: (deviceId: string) => Promise<void>;
};

type Props = {
  access: AppSettings["access"];
  nativeMobile: boolean;
  browser: boolean;
  localStatus: LocalAccessStatus;
  vaultStatus: CloudSecretVaultStatus;
  lanPcStatus: LanPcClientStatus;
  lanPairingCode: string;
  lanDeviceName: string;
  githubToken: string;
  busyAction: string;
  actionError: string;
  endpoint: string;
  localStatusLabel: string;
  localStatusPhase: "running" | "starting" | "failed" | "stopped";
  setLanPairingCode: (value: string) => void;
  setLanDeviceName: (value: string) => void;
  setGithubToken: (value: string) => void;
  patchAccess: (patch: Partial<AppSettings["access"]>) => void;
  setCapabilityBlocked: (
    capability: AppSettings["access"]["blockedLocalCapabilities"][number],
    blocked: boolean,
  ) => void;
  normalizeAddress: () => void;
  actions: AccessSettingsActions;
  copyEndpoint: ReactNode;
};

/** Compact fields and service actions use the same controller as the wide form. */
export function CompactAccessSettingsForm(props: Props) {
  const { t, locale } = useLocale();
  const { access, actions, busyAction, browser, nativeMobile } = props;
  const locked = busyAction !== "";
  const lanReady =
    props.lanPcStatus.paired && Boolean(normalizeComparableLanUrl(props.lanPcStatus.baseUrl));
  const button = (id: string, label: string, run: () => Promise<void>, enabled = true) => (
    <Button
      key={id}
      label={t(label)}
      size="lg"
      width="100%"
      className="settings-wrapping-action"
      variant="secondary"
      isDisabled={browser || locked || !enabled}
      isLoading={busyAction === id}
      onClick={() => void run()}
    />
  );
  const field = (label: string, value: string, onChange: (value: string) => void) => (
    <ListItem
      label={
        <TextInput
          label={t(label)}
          value={value}
          onChange={onChange}
          size="lg"
          width="100%"
          isDisabled={browser}
        />
      }
    />
  );
  const actionGrid = (children: ReactNode) => (
    <Grid
      className="compact-access-actions"
      columns={{ minWidth: 160, max: 2, repeat: "fit" }}
      gap={2}
      width="100%"
    >
      {children}
    </Grid>
  );

  return (
    <VStack className="compact-access-form" width="100%" gap={4}>
      {browser ? (
        <Banner status="warning" title={t("settings.accessNativeOnly")} collapsible={false} />
      ) : null}
      {nativeMobile ? (
        <>
          <SettingsRowGroup title={t("settings.accessLanControl")}>
            <ListItem
              label={
                <SettingsStatus
                  variant={lanReady ? "success" : "neutral"}
                  label={t(
                    lanReady ? "settings.accessComputerPaired" : "settings.accessComputerNotPaired",
                  )}
                />
              }
            />
            <ListItem
              label={
                <TextInput
                  label={t("settings.accessComputerAddress")}
                  size="lg"
                  width="100%"
                  value={access.lanControlUrl}
                  onChange={(value) => props.patchAccess({ lanControlUrl: value })}
                  onBlur={props.normalizeAddress}
                  isDisabled={browser}
                  placeholder="http://192.168.1.2:28367"
                  {...({ inputMode: "url", autoComplete: "url" } as const)}
                />
              }
            />
            <ListItem
              label={
                <TextInput
                  label={t("settings.accessLanPairingCode")}
                  size="lg"
                  width="100%"
                  type="password"
                  {...({
                    inputMode: "numeric",
                    autoComplete: "one-time-code",
                    maxLength: 6,
                  } as const)}
                  value={props.lanPairingCode}
                  placeholder="000000"
                  isDisabled={browser}
                  onChange={(value) =>
                    props.setLanPairingCode(value.replace(/\D/g, "").slice(0, 6))
                  }
                />
              }
            />
            {field("settings.accessLanDeviceName", props.lanDeviceName, props.setLanDeviceName)}
            <SettingsRow
              label={t("settings.accessPreferLanPc")}
              icon={<MonitorSmartphone />}
              description={t("settings.accessPreferLanPcHint")}
            >
              <Switch
                label={t("settings.accessPreferLanPc")}
                isLabelHidden
                value={access.preferLanPcExecution}
                isDisabled={browser || !lanReady}
                onChange={(value) => props.patchAccess({ preferLanPcExecution: value })}
              />
            </SettingsRow>
          </SettingsRowGroup>
          <Text type="supporting" color="secondary" wordBreak="break-word">
            {t("settings.accessLanControlHint")}
          </Text>
          {actionGrid(
            <>
              {button(
                "lan-pair",
                "settings.accessPairComputer",
                actions.pair,
                Boolean(access.lanControlUrl.trim()) &&
                  props.lanPairingCode.length === 6 &&
                  Boolean(props.lanDeviceName.trim()),
              )}
              {props.lanPcStatus.paired
                ? button(
                    "lan-refresh",
                    "settings.accessCheckComputer",
                    actions.refreshLan,
                    Boolean(normalizeComparableLanUrl(props.lanPcStatus.baseUrl)),
                  )
                : null}
              {props.lanPcStatus.paired
                ? button("lan-disconnect", "settings.accessDisconnectComputer", actions.disconnect)
                : null}
              {button(
                "lan-control",
                "settings.accessOpenComputer",
                actions.openComputer,
                Boolean(access.lanControlUrl.trim()),
              )}
            </>,
          )}
          <Text type="supporting" color="secondary" wordBreak="break-word">
            {t("settings.accessLanPairingHint")}
          </Text>
        </>
      ) : (
        <>
          <SettingsRowGroup title={t("settings.accessWebUi")}>
            <SettingsRow
              label={t("settings.accessWebUi")}
              icon={<MonitorSmartphone />}
              description={t("settings.accessWebUiHint")}
            >
              <Switch
                label={t("settings.accessWebUi")}
                isLabelHidden
                value={access.webUiEnabled}
                isDisabled={browser}
                onChange={(value) => props.patchAccess({ webUiEnabled: value })}
              />
            </SettingsRow>
            <ListItem
              label={
                <SettingsStatus
                  variant={
                    props.localStatusPhase === "running"
                      ? "success"
                      : props.localStatusPhase === "failed"
                        ? "error"
                        : props.localStatusPhase === "starting"
                          ? "warning"
                          : "neutral"
                  }
                  label={props.localStatusLabel}
                  isPulsing={props.localStatusPhase === "starting"}
                />
              }
            />
            <SettingsRow label={t("settings.accessScope")} icon={<Wifi />} controlLayout="value">
              <SettingsValueSelector
                label={t("settings.accessScope")}
                isLabelHidden
                value={access.webUiScope}
                isDisabled={browser}
                options={[
                  { value: "lan", label: t("settings.accessScopeLan") },
                  { value: "loopback", label: t("settings.accessScopeLoopback") },
                ]}
                onChange={(value) =>
                  props.patchAccess({ webUiScope: value === "loopback" ? "loopback" : "lan" })
                }
              />
            </SettingsRow>
            <ListItem
              label={
                <NumberInput
                  label={t("settings.accessPort")}
                  size="lg"
                  width="100%"
                  value={access.webUiPort}
                  min={1}
                  max={65_535}
                  isDisabled={browser}
                  onChange={(value) =>
                    props.patchAccess({ webUiPort: Math.min(65_535, Math.max(1, value ?? 28_367)) })
                  }
                />
              }
            />
            <ListItem
              label={
                <Text type="body" wordBreak="break-word">
                  {props.endpoint}
                </Text>
              }
              startContent={<Icon icon={Globe} size="md" />}
            />
          </SettingsRowGroup>
          {actionGrid(
            <>
              {props.copyEndpoint}
              {button("refresh", "projectTools.gitReview.refresh", actions.refreshLocal)}
            </>,
          )}
          <SettingsRowGroup title={t("settings.accessPairing")}>
            <ListItem
              label={
                <Text type="body" wordBreak="break-word">
                  {t("settings.accessPairedDevices").replace(
                    "{count}",
                    String(props.localStatus.pairedDevices),
                  )}
                </Text>
              }
            />
            {props.localStatus.pairingCode ? (
              <ListItem
                label={
                  <VStack gap={1}>
                    <Text type="body" wordBreak="break-word">
                      {t("settings.accessLanPairingCode")}
                    </Text>
                    <Text type="body" color="secondary" wordBreak="break-word">
                      {props.localStatus.pairingCode}
                    </Text>
                  </VStack>
                }
              />
            ) : null}
            {props.localStatus.devices.map((device) => (
              <ListItem
                key={device.deviceId}
                label={
                  <Text type="body" wordBreak="break-word">
                    {device.label}
                  </Text>
                }
                description={
                  <Text type="supporting" color="secondary" wordBreak="break-word">
                    {t("settings.accessDeviceLastSeen").replace(
                      "{time}",
                      new Date(device.lastSeenAt).toLocaleString(locale),
                    )}
                  </Text>
                }
                endContent={
                  <IconButton
                    label={t("settings.accessRevokeDevice")}
                    tooltip={t("settings.accessRevokeDevice")}
                    icon={<Icon icon={Trash2} size="sm" color="inherit" />}
                    variant="ghost"
                    size="lg"
                    isDisabled={browser || locked}
                    onClick={() => void actions.revokeDevice(device.deviceId)}
                  />
                }
              />
            ))}
            {props.localStatus.devices.length === 0 ? (
              <ListItem
                label={
                  <Text type="supporting" color="secondary" wordBreak="break-word">
                    {t("settings.accessNoPairedDevices")}
                  </Text>
                }
              />
            ) : null}
          </SettingsRowGroup>
          {button(
            "pair",
            "settings.accessNewPairingCode",
            actions.rotatePairingCode,
            access.webUiEnabled,
          )}
          <SettingsRowGroup title={t("settings.accessDevicePermissions")}>
            {(
              [
                ["terminal", "Terminal", Terminal],
                ["browser_automation", "BrowserAutomation", Globe],
                ["ssh", "Ssh", Server],
                ["git", "Git", GitBranch],
                ["file_write", "FileWrite", Shield],
              ] as const
            ).map(([capability, key, glyph]) => (
              <SettingsRow
                key={capability}
                label={t(`settings.accessBlock${key}`)}
                description={t(`settings.accessBlock${key}Hint`)}
                icon={<Icon icon={glyph} size="md" />}
              >
                <Switch
                  label={t(`settings.accessBlock${key}`)}
                  isLabelHidden
                  value={access.blockedLocalCapabilities.includes(capability)}
                  isDisabled={browser}
                  onChange={(value) => props.setCapabilityBlocked(capability, value)}
                />
              </SettingsRow>
            ))}
          </SettingsRowGroup>
        </>
      )}
      <SettingsRowGroup title={t("settings.accessCloudExecution")}>
        <SettingsRow
          label={t("settings.accessCloudExecution")}
          description={t("settings.accessCloudExecutionHint")}
          icon={<Cloud />}
        >
          <Switch
            label={t("settings.accessCloudExecution")}
            isLabelHidden
            value={access.cloudExecutionEnabled}
            isDisabled={browser}
            onChange={(value) => props.patchAccess({ cloudExecutionEnabled: value })}
          />
        </SettingsRow>
        {field("settings.accessGithubOwner", access.githubOwner, (value) =>
          props.patchAccess({ githubOwner: value }),
        )}
        {field("settings.accessGithubRepository", access.githubRepository, (value) =>
          props.patchAccess({ githubRepository: value }),
        )}
      </SettingsRowGroup>
      <Text type="supporting" color="secondary" wordBreak="break-word">
        {t("settings.accessCloudEnvironmentHint")}
      </Text>
      <SettingsRowGroup title={t("settings.accessSecureVault")}>
        <ListItem
          label={
            <SettingsStatus
              variant={props.vaultStatus.githubTokenConfigured ? "success" : "neutral"}
              label={t(
                props.vaultStatus.githubTokenConfigured
                  ? "settings.accessTokenConfigured"
                  : "settings.accessTokenMissing",
              )}
            />
          }
        />
        <ListItem
          label={
            <SecretTextInput
              label={t("settings.accessGithubToken")}
              value={props.githubToken}
              compact
              onChange={props.setGithubToken}
              placeholder={t("settings.accessGithubToken")}
              isDisabled={browser}
            />
          }
        />
        {props.vaultStatus.githubUsername ? (
          <ListItem
            label={
              <Text type="supporting" color="secondary" wordBreak="break-word">
                {t("settings.accessTokenOwner").replace(
                  "{username}",
                  props.vaultStatus.githubUsername,
                )}
              </Text>
            }
          />
        ) : null}
      </SettingsRowGroup>
      {actionGrid(
        <>
          {button(
            "save-token",
            "settings.accessSaveToken",
            actions.saveToken,
            Boolean(access.githubOwner.trim()) && Boolean(props.githubToken.trim()),
          )}
          {props.vaultStatus.githubTokenConfigured
            ? button("remove-token", "settings.accessRemoveToken", actions.removeToken)
            : null}
        </>,
      )}
      <Text type="supporting" color="secondary" wordBreak="break-word">
        {t("settings.accessVaultHint")}
      </Text>
      {props.actionError ? (
        <Banner status="error" title={props.actionError} collapsible={false} />
      ) : null}
    </VStack>
  );
}
