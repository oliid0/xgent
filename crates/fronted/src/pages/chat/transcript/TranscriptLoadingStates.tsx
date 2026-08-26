import { Center } from "@astryxdesign/core/Center";
import { HStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";

import { useLocale } from "../../../i18n";

export function HistorySwitchLoadingOverlay() {
  const { locale } = useLocale();
  const label = locale === "en-US" ? "Loading conversation…" : "正在加载对话…";

  return (
    <Center
      className="absolute inset-0 z-30 bg-background/95 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <HStack gap={2} vAlign="center">
        <Spinner size="sm" aria-label={label} />
        <Text type="supporting" color="secondary">
          {label}
        </Text>
      </HStack>
    </Center>
  );
}
