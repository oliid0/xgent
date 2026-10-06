import { Banner } from "@astryxdesign/core/Banner";
import { IconButton } from "@astryxdesign/core/IconButton";
import { VStack } from "@astryxdesign/core/Layout";
import { ListItem } from "@astryxdesign/core/List";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Switch } from "@astryxdesign/core/Switch";
import { ChevronRight, Mic, RefreshCw, Shield } from "../../components/icons";
import { useLocale } from "../../i18n";
import { normalizeSettings } from "../../lib/settings";
import { SettingsRow, SettingsRowGroup } from "./shared";
import type { SettingsSectionProps } from "./types";
import { useMobileAssistantAccess } from "./useMobileAssistantAccess";

export function MobileVoiceSettingsSection({
  settings,
  setSettings,
  onOpenPermissions,
}: SettingsSectionProps & { onOpenPermissions: () => void }) {
  const { t } = useLocale();
  const { status, permissions, busy, error, refresh } = useMobileAssistantAccess(
    t("settings.mobileAssistant.unavailable"),
  );
  const speechLabel = !status
    ? t(error ? "settings.native.speechUnavailable" : "settings.native.speechChecking")
    : status.voiceInputAvailable
      ? t("settings.native.speechAvailable")
      : t("settings.native.speechUnavailable");
  const permissionLabel = t(
    `settings.mobileAssistant.${
      permissions.microphone === "granted"
        ? "granted"
        : permissions.microphone === "denied"
          ? "denied"
          : permissions.microphone === "requested"
            ? "requested"
            : "notRequested"
    }`,
  );

  return (
    <VStack gap={5} width="100%">
      <SettingsRowGroup
        title={t("settings.navVoice")}
        titleEndContent={
          <IconButton
            label={t("settings.mobileAssistant.refresh")}
            icon={<RefreshCw />}
            variant="ghost"
            className="settings-navigation-control"
            isLoading={busy === "refresh"}
            isDisabled={busy !== ""}
            onClick={() => void refresh()}
          />
        }
      >
        <SettingsRow
          label={t("settings.navVoice")}
          icon={<Mic />}
          description={t("settings.mobileAssistant.microphoneDescription")}
        >
          <Switch
            label={t("settings.navVoice")}
            isLabelHidden
            value={settings.stt.enabled}
            onChange={(enabled) =>
              setSettings((previous) =>
                normalizeSettings({ ...previous, stt: { ...previous.stt, enabled } }),
              )
            }
          />
        </SettingsRow>
        <SettingsRow label={speechLabel} icon={<Mic />}>
          <StatusDot
            label={speechLabel}
            variant={status?.voiceInputAvailable ? "success" : status ? "warning" : "neutral"}
            isPulsing={!status && busy === "refresh"}
          />
        </SettingsRow>
        <ListItem
          label={t("settings.mobileAssistant.microphone")}
          description={permissionLabel}
          startContent={<Shield />}
          endContent={<ChevronRight />}
          isDisabled={busy !== ""}
          onClick={onOpenPermissions}
        />
      </SettingsRowGroup>
      {error ? <Banner status="error" title={error} collapsible={false} /> : null}
    </VStack>
  );
}
