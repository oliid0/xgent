import { StackItem, VStack } from "@astryxdesign/core/Layout";

import { ProvidersSection } from "./ProvidersSection";
import type { SettingsSectionProps } from "./types";

export function ProviderSettingsSection(
  props: SettingsSectionProps & {
    thirdPartyImportEnabled: boolean;
  },
) {
  return (
    <VStack height="100%" minHeight={0} gap={0}>
      <StackItem id="provider-settings-configuration" role="tabpanel" size="fill">
        <ProvidersSection
          settings={props.settings}
          setSettings={props.setSettings}
          thirdPartyImportEnabled={props.thirdPartyImportEnabled}
        />
      </StackItem>
    </VStack>
  );
}
