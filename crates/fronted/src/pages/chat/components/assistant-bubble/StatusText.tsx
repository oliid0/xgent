import { HStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import type { ReactNode } from "react";
import { useLocale } from "../../../../i18n";

export function VibingText() {
  const { t } = useLocale();
  return (
    <HStack as="span" gap={2} vAlign="center" role="status">
      <span className="xgent-thinking-orb" aria-hidden="true" />
      <Text type="supporting" color="secondary">
        {t("chat.thinking")}
      </Text>
    </HStack>
  );
}

export function CompactingText() {
  const { t } = useLocale();
  return <AssistantStatus>{t("chat.compactingContext")}</AssistantStatus>;
}

export function AssistantStatus({ children }: { children: ReactNode }) {
  return (
    <HStack as="span" gap={2} vAlign="center" width="100%" role="status">
      <Spinner size="sm" aria-hidden="true" />
      <Text type="supporting" color="secondary">
        {children}
      </Text>
    </HStack>
  );
}
