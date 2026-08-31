import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { useState } from "react";
import { useLocale } from "../../i18n";
import type { TaskProgressSnapshot } from "../../lib/chat/taskProgress";
import { Check, ChevronDown, ChevronUp, Circle, X } from "../icons";

export function TaskProgressBar(props: {
  snapshot: TaskProgressSnapshot | null;
  isConversationRunning: boolean;
}) {
  const { t } = useLocale();
  const { snapshot, isConversationRunning } = props;
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
  if (!snapshot || snapshot.tasks.length === 0) return null;
  if (dismissedRunId === snapshot.runId) return null;

  const completed = snapshot.tasks.filter((task) => task.status === "completed").length;
  const active = snapshot.tasks.find((task) => task.status === "in_progress");
  const label = active?.activeForm || active?.subject || t("chat.tasks.ready");
  const isOpen = expandedRunId === snapshot.runId;

  return (
    <VStack className="mx-auto w-full max-w-4xl px-3 pb-2 sm:px-5">
      <Card width="100%" padding={3} elevation="low">
        <HStack gap={2} vAlign="start">
          <StackItem size="fill">
            <Collapsible
              isOpen={isOpen}
              onOpenChange={(nextOpen) => setExpandedRunId(nextOpen ? snapshot.runId : null)}
              trigger={
                <VStack gap={2} width="100%">
                  <HStack gap={2} vAlign="center">
                    {active && isConversationRunning ? (
                      <Spinner aria-label={label} size="sm" />
                    ) : (
                      <Check />
                    )}
                    <StackItem size="fill">
                      <Text type="label" maxLines={1}>
                        {label}
                      </Text>
                    </StackItem>
                    <Text type="supporting" color="secondary" hasTabularNumbers>
                      {completed}/{snapshot.tasks.length}
                    </Text>
                    {isOpen ? <ChevronUp /> : <ChevronDown />}
                  </HStack>
                  <ProgressBar
                    label={t("chat.tasks.progress")}
                    value={completed}
                    max={snapshot.tasks.length}
                    isLabelHidden
                    variant={completed === snapshot.tasks.length ? "success" : "accent"}
                  />
                </VStack>
              }
            >
              <VStack gap={2} paddingBlockStart={3}>
                {snapshot.tasks.map((task) => (
                  <HStack key={task.id} gap={2} vAlign="start">
                    {task.status === "completed" ? (
                      <Check aria-hidden="true" />
                    ) : task.status === "in_progress" && isConversationRunning ? (
                      <Spinner aria-label={task.activeForm || task.subject} size="sm" />
                    ) : (
                      <Circle aria-hidden="true" />
                    )}
                    <StackItem size="fill">
                      <VStack gap={0.5}>
                        <Text
                          type="body"
                          color={task.status === "completed" ? "secondary" : "primary"}
                        >
                          {task.subject}
                        </Text>
                        {task.description ? (
                          <Text type="supporting" color="secondary">
                            {task.description}
                          </Text>
                        ) : null}
                      </VStack>
                    </StackItem>
                  </HStack>
                ))}
              </VStack>
            </Collapsible>
          </StackItem>
          <IconButton
            type="button"
            label={t("chat.tasks.close")}
            tooltip={t("chat.tasks.close")}
            icon={<X />}
            variant="ghost"
            size="sm"
            onClick={() => setDismissedRunId(snapshot.runId)}
          />
        </HStack>
      </Card>
    </VStack>
  );
}
