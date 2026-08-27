import { Button } from "@astryxdesign/core/Button";
import { StackItem, VStack } from "@astryxdesign/core/Layout";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Toolbar } from "@astryxdesign/core/Toolbar";

import { ConfirmActionPopover } from "../../components/ui/confirm-action-popover";
import { useLocale } from "../../i18n";
import {
  getDefaultUsageQueryConfig,
  normalizeModelFailoverSettings,
  updateCustomProviders,
} from "../../lib/settings";
import { ModelFailoverSection } from "./ModelFailoverSection";
import { ProvidersSection } from "./ProvidersSection";
import { ProviderUsageSection } from "./ProviderUsageSection";
import type { SettingsSectionProps } from "./types";

export type ProviderSettingsPanel = "configuration" | "failover" | "usage";

export function ProviderSettingsSection(
  props: SettingsSectionProps & {
    panel: ProviderSettingsPanel;
    onPanelChange: (panel: ProviderSettingsPanel) => void;
    thirdPartyImportEnabled: boolean;
  },
) {
  const { t } = useLocale();
  const resetRuntimeConfiguration = () => {
    props.setSettings((previous) => ({
      ...previous,
      modelFailover: normalizeModelFailoverSettings({}, previous.customProviders),
      customProviders: updateCustomProviders(
        previous,
        previous.customProviders.map((provider) => ({
          ...provider,
          usageQuery: getDefaultUsageQueryConfig(),
        })),
      ).customProviders,
    }));
  };

  return (
    <VStack height="100%" minHeight={0} gap={0}>
      <Toolbar
        label={t("settings.navProviders")}
        size="sm"
        dividers={["bottom"]}
        startContent={
          <TabList
            value={props.panel}
            onChange={(value) => props.onPanelChange(value as ProviderSettingsPanel)}
            size="sm"
            overflow="scroll"
            role="tablist"
          >
            <Tab
              value="configuration"
              label={t("settings.navProviders")}
              panelId="provider-settings-configuration"
            />
            <Tab
              value="failover"
              label={t("settings.navFailover")}
              panelId="provider-settings-failover"
            />
            <Tab value="usage" label={t("settings.navUsage")} panelId="provider-settings-usage" />
          </TabList>
        }
        endContent={
          <ConfirmActionPopover
            title={t("settings.providerRuntimeResetTitle")}
            description={t("settings.providerRuntimeResetDescription")}
            confirmLabel={t("settings.providerRuntimeResetConfirm")}
            onConfirm={resetRuntimeConfiguration}
          >
            {(open) => (
              <Button
                label={t("settings.providerRuntimeReset")}
                size="sm"
                variant="ghost"
                onClick={open}
              />
            )}
          </ConfirmActionPopover>
        }
      />
      <StackItem
        id={`provider-settings-${props.panel}`}
        role="tabpanel"
        size="fill"
        isScrollable={props.panel !== "configuration"}
      >
        {props.panel === "configuration" ? (
          <ProvidersSection
            settings={props.settings}
            setSettings={props.setSettings}
            thirdPartyImportEnabled={props.thirdPartyImportEnabled}
          />
        ) : (
          <VStack padding={4}>
            {props.panel === "failover" ? (
              <ModelFailoverSection settings={props.settings} setSettings={props.setSettings} />
            ) : (
              <ProviderUsageSection settings={props.settings} setSettings={props.setSettings} />
            )}
          </VStack>
        )}
      </StackItem>
    </VStack>
  );
}
