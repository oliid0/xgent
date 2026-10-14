import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Fragment, useMemo, useState } from "react";
import {
  Activity,
  Calendar,
  Camera,
  Check,
  ChevronRight,
  Cloud,
  ContactRound,
  Heart,
  House,
  ImageIcon,
  ListChecks,
  Mic,
  RefreshCw,
  Shield,
  WifiOff,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import { mobileContactRows } from "../../lib/connectors/connectorDataView";
import { mobileConnectorCatalog } from "../../lib/connectors/mobileConnectorCatalog";
import { useMobileContacts } from "../../lib/connectors/useMobileContacts";
import { useMobileHome } from "../../lib/connectors/useMobileHome";
import type { MobileAssistantPermission, MobilePermissionStates } from "../../lib/mobileAssistant";
import { type ToolPolicy, updateSystem } from "../../lib/settings";
import {
  PERSONAL_CAPABILITIES,
  personalPolicy,
  personalPolicyKey,
} from "../../lib/tools/mobileAssistantPolicy";
import { ConnectorDataList } from "./ConnectorDataList";
import { MobileHomeSection } from "./MobileHomeSection";
import { MobileScheduleSection } from "./MobileScheduleSection";
import type { SettingsSectionProps } from "./types";
import { useMobileAssistantAccess } from "./useMobileAssistantAccess";

type PermissionDescriptor = {
  id: MobileAssistantPermission;
  labelKey: string;
  descriptionKey: string;
  icon: typeof Mic;
};

const PERMISSIONS: PermissionDescriptor[] = [
  {
    id: "home",
    labelKey: "settings.mobileAssistant.home",
    descriptionKey: "settings.mobileAssistant.homeDescription",
    icon: Shield,
  },
  {
    id: "notifications",
    labelKey: "settings.mobileAssistant.notifications",
    descriptionKey: "settings.mobileAssistant.notificationsDescription",
    icon: Shield,
  },
  {
    id: "contacts",
    labelKey: "settings.mobileAssistant.contacts",
    descriptionKey: "settings.mobileAssistant.contactsDescription",
    icon: Shield,
  },
  {
    id: "bluetooth",
    labelKey: "settings.mobileAssistant.bluetooth",
    descriptionKey: "settings.mobileAssistant.bluetoothDescription",
    icon: Shield,
  },
  {
    id: "microphone",
    labelKey: "settings.mobileAssistant.microphone",
    descriptionKey: "settings.mobileAssistant.microphoneDescription",
    icon: Mic,
  },
  {
    id: "camera",
    labelKey: "settings.mobileAssistant.camera",
    descriptionKey: "settings.mobileAssistant.cameraDescription",
    icon: Camera,
  },
  {
    id: "calendar",
    labelKey: "settings.mobileAssistant.calendar",
    descriptionKey: "settings.mobileAssistant.calendarDescription",
    icon: Calendar,
  },
  {
    id: "reminders",
    labelKey: "settings.mobileAssistant.reminders",
    descriptionKey: "settings.mobileAssistant.remindersDescription",
    icon: Check,
  },
  {
    id: "photos",
    labelKey: "settings.mobileAssistant.photos",
    descriptionKey: "settings.mobileAssistant.photosDescription",
    icon: ImageIcon,
  },
  {
    id: "location",
    labelKey: "settings.mobileAssistant.location",
    descriptionKey: "settings.mobileAssistant.locationDescription",
    icon: WifiOff,
  },
  {
    id: "health",
    labelKey: "settings.mobileAssistant.health",
    descriptionKey: "settings.mobileAssistant.healthDescription",
    icon: Activity,
  },
];

function PermissionStateBadge({
  state,
}: {
  state: MobilePermissionStates[MobileAssistantPermission];
}) {
  const { t } = useLocale();
  const label =
    state === "granted"
      ? t("settings.mobileAssistant.granted")
      : state === "denied"
        ? t("settings.mobileAssistant.denied")
        : state === "requested"
          ? t("settings.mobileAssistant.requested")
          : t("settings.mobileAssistant.notRequested");
  return (
    <HStack gap={2} vAlign="center">
      <StatusDot
        label={label}
        variant={state === "granted" ? "success" : state === "denied" ? "error" : "neutral"}
      />
      <Text type="supporting" color="secondary" wordBreak="break-word">
        {label}
      </Text>
    </HStack>
  );
}

export function MobileAssistantSection({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();
  const [connectorTab, setConnectorTab] = useState("available");
  const [connectorQuery, setConnectorQuery] = useState("");
  const [openConnector, setOpenConnector] = useState<string | null>(null);
  const contacts = useMobileContacts(true);
  const { status, permissions, busy, error, refresh, request } = useMobileAssistantAccess(
    t("settings.mobileAssistant.unavailable"),
  );
  const home = useMobileHome(status?.homeAvailable === true && status.backend === "ios-native");
  const connectors = mobileConnectorCatalog(
    status,
    permissions,
    settings.system.toolPolicies,
  ).filter(
    (connector) =>
      (connectorTab === "connected") === (connector.permissionState === "granted") &&
      t(`settings.mobileAssistant.${connector.id}`)
        .toLocaleLowerCase()
        .includes(connectorQuery.trim().toLocaleLowerCase()),
  );

  const permissionRows = useMemo(
    () =>
      PERMISSIONS.filter((permission) => status?.permissionAliases?.[permission.id] !== undefined),
    [status],
  );

  return (
    <VStack gap={5} className="autonomy-settings">
      {status?.homeAvailable && status.backend === "ios-native" ? (
        <MobileHomeSection home={home} disabled={busy !== ""} />
      ) : null}
      {status?.permissionAliases.calendar && status.permissionAliases.reminders ? (
        <MobileScheduleSection disabled={busy !== ""} />
      ) : null}
      {status?.permissionAliases.contacts ? (
        <Section padding={4} width="100%">
          <VStack gap={3}>
            <Heading level={3}>{t("settings.connectors.searchContacts")}</Heading>
            <TextInput
              label={t("settings.connectors.contactQuery")}
              size="lg"
              value={contacts.query}
              onChange={contacts.setQuery}
              isDisabled={contacts.busy}
              width="100%"
            />
            <Button
              label={t("settings.connectors.search")}
              onClick={() => void contacts.search()}
              isLoading={contacts.busy}
              isDisabled={contacts.busy || busy !== ""}
              size="lg"
            />
            {contacts.error ? (
              <Banner status="error" title={contacts.error} collapsible={false} />
            ) : null}
            {contacts.data ? (
              <>
                <Text type="supporting" color="secondary">
                  {t(
                    contacts.data.accessLimited || contacts.data.truncated
                      ? "settings.connectors.partialContacts"
                      : "settings.connectors.contactResults",
                  )}
                </Text>
                {contacts.data.contacts.length ? (
                  <ConnectorDataList rows={mobileContactRows(contacts.data, t)} />
                ) : (
                  <Text>{t("settings.connectors.noContacts")}</Text>
                )}
              </>
            ) : null}
          </VStack>
        </Section>
      ) : null}
      <Section padding={0} width="100%" className="connector-catalog">
        <VStack gap={2} padding={4}>
          <Heading level={3}>{t("settings.connectors.title")}</Heading>
          <TextInput
            label={t("settings.connectors.searchConnectors")}
            isLabelHidden
            placeholder={t("settings.connectors.searchConnectors")}
            startIcon="search"
            value={connectorQuery}
            onChange={setConnectorQuery}
            hasClear
            width="100%"
            size="lg"
          />
          <SegmentedControl
            label={t("settings.connectors.title")}
            value={connectorTab}
            onChange={setConnectorTab}
            layout="fill"
            size="lg"
          >
            <SegmentedControlItem value="available" label={t("settings.connectors.availableTab")} />
            <SegmentedControlItem value="connected" label={t("settings.connectors.connectedTab")} />
          </SegmentedControl>
        </VStack>
        <List density="balanced" hasDividers>
          {connectors.map((connector) => (
            <Fragment key={connector.id}>
              <ListItem
                label={t(`settings.mobileAssistant.${connector.id}`)}
                startContent={
                  <span className={`connector-icon connector-icon-${connector.id}`}>
                    {connector.id === "home" ? (
                      <House />
                    ) : connector.id === "health" ? (
                      <Heart />
                    ) : connector.id === "calendar" ? (
                      <Calendar />
                    ) : connector.id === "reminders" ? (
                      <ListChecks />
                    ) : (
                      <ContactRound />
                    )}
                  </span>
                }
                endContent={
                  connector.canRequest ? (
                    <Button
                      className="connector-connect"
                      label={t("settings.connectors.connect")}
                      variant="ghost"
                      size="lg"
                      isDisabled={busy !== "" || home.busy}
                      isLoading={busy === connector.permission}
                      onClick={() => void request(connector.permission)}
                    />
                  ) : connector.permissionState === "granted" ? (
                    <ChevronRight />
                  ) : (
                    <Text type="supporting" color="secondary" wordBreak="break-word">
                      {t(`settings.connectors.${connector.state}`)}
                    </Text>
                  )
                }
                onClick={
                  connector.permissionState === "granted"
                    ? () => setOpenConnector(openConnector === connector.id ? null : connector.id)
                    : undefined
                }
              />
              {connector.permissionState === "granted" && openConnector === connector.id ? (
                <ListItem
                  label={t("settings.mobileAssistant.agentAccess")}
                  endContent={
                    <Selector
                      label={t(`settings.mobileAssistant.${connector.id}`)}
                      isLabelHidden
                      value={personalPolicy(connector.permission, settings.system.toolPolicies)}
                      options={["allow", "ask", "deny"].map((value) => ({
                        value,
                        label: t(`settings.toolPolicy.${value}`),
                      }))}
                      onChange={(value) =>
                        setSettings((previous) =>
                          updateSystem(previous, {
                            toolPolicies: {
                              ...previous.system.toolPolicies,
                              [personalPolicyKey(connector.permission)]: value as ToolPolicy,
                            },
                          }),
                        )
                      }
                    />
                  }
                />
              ) : null}
            </Fragment>
          ))}
        </List>
        {!connectors.length ? (
          <Text type="supporting" color="secondary" className="connector-empty">
            {t("settings.connectors.empty")}
          </Text>
        ) : null}
      </Section>
      <Section padding={4} width="100%">
        <VStack gap={3}>
          <Heading level={3}>{t("settings.mobileAssistant.agentAccess")}</Heading>
          {PERSONAL_CAPABILITIES.filter(
            (capability) =>
              capability === "clipboard" || status?.permissionAliases[capability] !== undefined,
          ).map((capability) => (
            <Selector
              key={capability}
              label={t(`settings.mobileAssistant.${capability}`)}
              value={personalPolicy(capability, settings.system.toolPolicies)}
              options={["allow", "ask", "deny"].map((value) => ({
                value,
                label: t(`settings.toolPolicy.${value}`),
              }))}
              onChange={(value) =>
                setSettings((previous) =>
                  updateSystem(previous, {
                    toolPolicies: {
                      ...previous.system.toolPolicies,
                      [personalPolicyKey(capability)]: value as ToolPolicy,
                    },
                  }),
                )
              }
              width="100%"
            />
          ))}
        </VStack>
      </Section>
      <Section padding={0} width="100%">
        <HStack gap={3} vAlign="start" padding={4}>
          <Shield />
          <StackItem size="fill">
            <VStack gap={1}>
              <Heading level={3}>{t("settings.mobileAssistant.permissions")}</Heading>
            </VStack>
          </StackItem>
          <IconButton
            label={t("settings.mobileAssistant.refresh")}
            tooltip={t("settings.mobileAssistant.refresh")}
            icon={<RefreshCw />}
            variant="ghost"
            isLoading={busy === "refresh"}
            isDisabled={busy !== ""}
            onClick={() => void refresh()}
          />
        </HStack>

        <List density="balanced" hasDividers>
          {permissionRows.map((permission) => {
            const Icon = permission.icon;
            const state = permissions[permission.id] ?? "prompt";
            return (
              <ListItem
                key={permission.id}
                label={t(permission.labelKey)}
                description={
                  permission.id === "notifications" ? (
                    <Text type="supporting" color="secondary" wordBreak="break-word">
                      {t(permission.descriptionKey)}
                    </Text>
                  ) : undefined
                }
                startContent={
                  busy === permission.id ? (
                    <Spinner aria-label={t(permission.labelKey)} size="sm" />
                  ) : (
                    <Icon />
                  )
                }
                endContent={<PermissionStateBadge state={state} />}
                isDisabled={busy !== "" || home.busy || state === "granted"}
                onClick={() => void request(permission.id)}
              />
            );
          })}
        </List>
      </Section>

      <Section padding={0} width="100%">
        <VStack gap={2} paddingInline={4} paddingBlockStart={4}>
          <Heading level={3}>{t("settings.mobileAssistant.platformServices")}</Heading>
        </VStack>
        <List density="balanced" hasDividers>
          {[
            {
              id: "icloud",
              icon: Cloud,
              title: t("settings.mobileAssistant.icloud"),
              detail: t("settings.mobileAssistant.icloudDescription"),
              available: status?.cloudSyncAvailable,
            },
            {
              id: "health",
              icon: Activity,
              title: t("settings.mobileAssistant.health"),
              detail: t("settings.mobileAssistant.healthDescription"),
              available: status?.healthAvailable,
            },
            {
              id: "external",
              icon: WifiOff,
              title: t("settings.mobileAssistant.externalFolders"),
              detail: t("settings.mobileAssistant.externalFoldersDescription"),
              available: status?.externalFolderMountAvailable,
            },
          ].map((service) => {
            const Icon = service.icon;
            return (
              <ListItem
                key={service.id}
                label={service.title}
                startContent={<Icon />}
                endContent={
                  <HStack gap={2} vAlign="center">
                    <StatusDot
                      label={
                        service.available
                          ? t("settings.mobileAssistant.available")
                          : t("settings.mobileAssistant.unavailable")
                      }
                      variant={service.available ? "success" : "neutral"}
                    />
                    <Text type="supporting" color="secondary" wordBreak="break-word">
                      {t(
                        service.available
                          ? "settings.mobileAssistant.available"
                          : "settings.mobileAssistant.unavailable",
                      )}
                    </Text>
                  </HStack>
                }
              />
            );
          })}
        </List>
      </Section>

      {error ? <Banner status="error" title={error} collapsible={false} /> : null}
    </VStack>
  );
}
