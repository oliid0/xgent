import { Banner } from "@astryxdesign/core/Banner";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { useMemo } from "react";
import {
  Activity,
  Camera,
  Check,
  Clock3,
  Cloud,
  ImageIcon,
  Mic,
  RefreshCw,
  Shield,
  WifiOff,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import type { MobileAssistantPermission, MobilePermissionStates } from "../../lib/mobileAssistant";
import { type ToolPolicy, updateSystem } from "../../lib/settings";
import {
  PERSONAL_CAPABILITIES,
  personalPolicy,
  personalPolicyKey,
} from "../../lib/tools/mobileAssistantPolicy";
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
    icon: Clock3,
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
  const { status, permissions, busy, error, refresh, request } = useMobileAssistantAccess(
    t("settings.mobileAssistant.unavailable"),
  );

  const permissionRows = useMemo(
    () =>
      PERMISSIONS.filter((permission) => status?.permissionAliases?.[permission.id] !== undefined),
    [status],
  );

  return (
    <VStack gap={5}>
      <Section padding={4} width="100%">
        <VStack gap={3}>
          <Heading level={3}>{t("settings.mobileAssistant.agentAccess")}</Heading>
          <Text type="supporting" color="secondary">
            {t("settings.mobileAssistant.agentAccessDescription")}
          </Text>
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
              <Text type="supporting" color="secondary">
                {t("settings.mobileAssistant.permissionsDescription")}
              </Text>
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
                description={t(permission.descriptionKey)}
                startContent={
                  busy === permission.id ? (
                    <Spinner aria-label={t(permission.labelKey)} size="sm" />
                  ) : (
                    <Icon />
                  )
                }
                endContent={<PermissionStateBadge state={state} />}
                isDisabled={busy !== "" || state === "granted"}
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
                description={service.detail}
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

      {status?.detail ? (
        <Text type="supporting" color="secondary">
          {status.detail}
        </Text>
      ) : null}
      {error ? <Banner status="error" title={error} collapsible={false} /> : null}
    </VStack>
  );
}
