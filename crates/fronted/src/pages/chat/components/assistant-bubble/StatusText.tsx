import { HStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import type { ReactNode } from "react";
import { useLocale } from "../../../../i18n";
import { VIBING_STATUS } from "../../../../lib/chat/page/chatPageHelpers";

export function VibingText() {
  return <AssistantStatus>{VIBING_STATUS}</AssistantStatus>;
}

export function CompactingText() {
  const { t } = useLocale();
  return <AssistantStatus>{t("chat.compactingContext")}</AssistantStatus>;
}

export function AssistantStatus({ children }: { children: ReactNode }) {
  return (
    <HStack
      as="span"
      gap={2}
      vAlign="center"
      width="100%"
      role="status"
    >
      <Spinner size="sm" aria-hidden="true" />
      <Text type="supporting" color="secondary">
        {children}
      </Text>
    </HStack>
  );
}
