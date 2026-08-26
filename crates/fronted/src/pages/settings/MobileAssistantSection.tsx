import { useCallback, useEffect, useMemo, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import {
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
import {
  checkMobileAssistantPermissions,
  type MobileAssistantPermission,
  type MobileAssistantStatus,
  type MobilePermissionStates,
  mobileAssistantStatus,
  normalizeMobileAssistantPermissions,
  requestMobileAssistantPermission,
} from "../../lib/mobileAssistant";

type PermissionDescriptor = {
  id: MobileAssistantPermission;
  labelKey: string;
  descriptionKey: string;
  icon: typeof Mic;
};

const PERMISSIONS: PermissionDescriptor[] = [
  {
    id: "microphone",
    labelKey: "settings.mobileAssistant.microphone",
    descriptionKey: "settings.mobileAssistant.microphoneDescription",
    icon: Mic,
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
        : t("settings.mobileAssistant.notRequested");
  return (
    <StatusDot
      label={label}
      variant={state === "granted" ? "success" : state === "denied" ? "error" : "neutral"}
    />
  );
}

export function MobileAssistantSection() {
  const { t } = useLocale();
  const [status, setStatus] = useState<MobileAssistantStatus>();
  const [permissions, setPermissions] = useState<MobilePermissionStates>({});
  const [busy, setBusy] = useState<MobileAssistantPermission | "refresh" | "">("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setBusy((current) => current || "refresh");
    setError("");
    try {
      const [nextStatus, nextPermissions] = await Promise.all([
        mobileAssistantStatus(),
        checkMobileAssistantPermissions(),
      ]);
      setStatus(nextStatus);
      setPermissions(normalizeMobileAssistantPermissions(nextStatus, nextPermissions));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy((current) => (current === "refresh" ? "" : current));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const permissionRows = useMemo(
    () =>
      PERMISSIONS.filter((permission) => status?.permissionAliases?.[permission.id] !== undefined),
    [status],
  );

  async function request(permission: MobileAssistantPermission) {
    setBusy(permission);
    setError("");
    try {
      if (!status) throw new Error(t("settings.mobileAssistant.unavailable"));
      const alias = status.permissionAliases[permission] ?? permission;
      const next = await requestMobileAssistantPermission(alias);
      setPermissions(normalizeMobileAssistantPermissions(status, next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  }

  return (
    <VStack gap={5}>
      <Section padding={0} width="100%">
        <HStack gap={3} vAlign="start" padding={4}>
          <Shield />
          <StackItem size="fill">
            <VStack gap={1}>
            <Heading level={3}>
              {t("settings.mobileAssistant.permissions")}
            </Heading>
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
                    <Spinner accessibleLabel={t(permission.labelKey)} size="sm" />
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
          <Heading level={3}>
            {t("settings.mobileAssistant.platformServices")}
          </Heading>
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
                  <StatusDot
                    label={
                      service.available
                        ? t("settings.mobileAssistant.available")
                        : t("settings.mobileAssistant.unavailable")
                    }
                    variant={service.available ? "success" : "neutral"}
                  />
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
      {error ? (
        <Banner status="error" title={error} collapsible={false} />
      ) : null}
    </VStack>
  );
}
