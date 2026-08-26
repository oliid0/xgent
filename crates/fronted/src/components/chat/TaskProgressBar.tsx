import { Card } from "@astryxdesign/core/Card";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { useLocale } from "../../i18n";
import type { TaskProgressSnapshot } from "../../lib/chat/taskProgress";
import { Check } from "../icons";

export function TaskProgressBar(props: {
  snapshot: TaskProgressSnapshot | null;
  isConversationRunning: boolean;
}) {
  const { t } = useLocale();
  const { snapshot, isConversationRunning } = props;
  if (!snapshot || snapshot.tasks.length === 0) return null;

  const completed = snapshot.tasks.filter((task) => task.status === "completed").length;
  const active = snapshot.tasks.find((task) => task.status === "in_progress");
  const label = active?.activeForm || active?.subject || t("chat.tasks.ready");

  return (
    <VStack
      className="mx-auto w-full max-w-4xl px-3 pb-2 sm:px-5"
    >
      <Card width="100%" padding={3} elevation="low">
        <VStack gap={2}>
        <HStack gap={2} vAlign="center">
          {active && isConversationRunning ? (
            <Spinner accessibleLabel={label} size="sm" />
          ) : (
            <Check />
          )}
          <StackItem size="fill">
            <Text type="label" maxLines={1}>{label}</Text>
          </StackItem>
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {completed}/{snapshot.tasks.length}
          </Text>
        </HStack>
        <ProgressBar
          label={t("chat.tasks.progress")}
          value={completed}
          max={snapshot.tasks.length}
          isLabelHidden
          variant={completed === snapshot.tasks.length ? "success" : "accent"}
        />
        </VStack>
      </Card>
    </VStack>
  );
}
