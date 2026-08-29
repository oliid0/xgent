import { Divider } from "@astryxdesign/core/Divider";
import { StackItem, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { type ReactNode, useCallback, useState } from "react";
import { useLocale } from "../../i18n";
import { CronSection } from "./CronSection";
import { HooksSection } from "./HooksSection";
import { SettingsDetailLayerProvider } from "./SettingsModalShell";
import { SshSettingsSection } from "./SshSettingsSection";
import type { SettingsSectionProps } from "./types";

type OtherArea = "hooks" | "cron" | "ssh";

function OtherAreaScope(props: {
  id: OtherArea;
  activeArea: OtherArea | null;
  onDetailChange: (id: OtherArea, delta: 1 | -1) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const active = props.activeArea === props.id;
  const hidden = props.activeArea !== null && !active;
  const handleLayerChange = useCallback(
    (delta: 1 | -1) => props.onDetailChange(props.id, delta),
    [props.id, props.onDetailChange],
  );

  return (
    <StackItem
      size={active ? "fill" : "static"}
      style={{ display: hidden ? "none" : undefined, minHeight: active ? 0 : undefined }}
    >
      <VStack
        width="100%"
        height={active ? "100%" : undefined}
        minHeight={active ? 0 : undefined}
        gap={3}
      >
        {!active ? (
          <VStack gap={0.5}>
            <Heading level={4}>{props.title}</Heading>
            <Text type="supporting" color="secondary">
              {props.description}
            </Text>
          </VStack>
        ) : null}
        <SettingsDetailLayerProvider onLayerChange={handleLayerChange}>
          {props.children}
        </SettingsDetailLayerProvider>
      </VStack>
    </StackItem>
  );
}

export function OtherSettingsSection({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();
  const [activeArea, setActiveArea] = useState<OtherArea | null>(null);
  const handleDetailChange = useCallback((id: OtherArea, delta: 1 | -1) => {
    setActiveArea((current) => (delta > 0 ? id : current === id ? null : current));
  }, []);

  return (
    <VStack width="100%" height="100%" minHeight={0} gap={activeArea ? 0 : 4}>
      <OtherAreaScope
        id="hooks"
        activeArea={activeArea}
        onDetailChange={handleDetailChange}
        title={t("settings.navHooks")}
        description={t("settings.mobile.hooksDescription")}
      >
        <HooksSection settings={settings} setSettings={setSettings} />
      </OtherAreaScope>
      {!activeArea ? <Divider /> : null}
      <OtherAreaScope
        id="cron"
        activeArea={activeArea}
        onDetailChange={handleDetailChange}
        title={t("settings.navCron")}
        description={t("settings.mobile.cronDescription")}
      >
        <CronSection settings={settings} setSettings={setSettings} />
      </OtherAreaScope>
      {!activeArea ? <Divider /> : null}
      <OtherAreaScope
        id="ssh"
        activeArea={activeArea}
        onDetailChange={handleDetailChange}
        title={t("settings.navSsh")}
        description={t("settings.mobile.sshDescription")}
      >
        <SshSettingsSection settings={settings} setSettings={setSettings} />
      </OtherAreaScope>
    </VStack>
  );
}
