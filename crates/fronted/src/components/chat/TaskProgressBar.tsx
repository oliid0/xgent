import { Button } from "@astryxdesign/core/Button";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Popover } from "@astryxdesign/core/Popover";
import { Text } from "@astryxdesign/core/Text";
import { useState } from "react";
import { useLocale } from "../../i18n";
import type { TaskProgressSnapshot } from "../../lib/chat/taskProgress";
import { Check, ChevronDown, ChevronUp, Clock3 } from "../icons";

export function TaskProgressBar(props: {
  snapshot: TaskProgressSnapshot | null;
  isConversationRunning: boolean;
}) {
  const { t } = useLocale();
  const { snapshot, isConversationRunning } = props;
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  if (!snapshot || snapshot.tasks.length === 0) return null;
  const completed = snapshot.tasks.filter((task) => task.status === "completed").length;
  const active = snapshot.tasks.find((task) => task.status === "in_progress");
  const allDone = completed === snapshot.tasks.length;
  const label = allDone
    ? t("chat.tasks.completed")
    : active?.activeForm || active?.subject || t("chat.tasks.ready");
  const position = completed;
  const isOpen = expandedRunId === snapshot.runId;
  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={(open) => setExpandedRunId(open ? snapshot.runId : null)}
      placement="above"
      label={t("chat.tasks.todo")}
      width="max-content"
      hasCloseButton={false}
      content={
        <VStack
          gap={3}
          className="xgent-task-popover"
          style={{ maxWidth: "min(32rem, calc(100vw - 3rem))" }}
        >
          <HStack hAlign="between" vAlign="center">
            <Text color="secondary">{t("chat.tasks.todo")}</Text>
            <Text color="secondary" hasTabularNumbers>
              {position} / {snapshot.tasks.length}
            </Text>
          </HStack>
          <VStack gap={3} isScrollable style={{ maxHeight: "min(24rem, 50dvh)" }}>
            {snapshot.tasks.map((task) => (
              <HStack key={task.id} gap={3} vAlign="start">
                {task.status === "completed" ? (
                  <Check className="xgent-task-check" aria-label={t("chat.tasks.completed")} />
                ) : task.status === "in_progress" ? (
                  <span
                    className="xgent-thinking-orb"
                    data-paused={!isConversationRunning}
                    aria-label={t("chat.mobileActivity.working")}
                  />
                ) : (
                  <Clock3 aria-label={t("chat.tasks.todo")} />
                )}
                <Text
                  color={task.status === "pending" ? "secondary" : "primary"}
                  style={{ overflowWrap: "anywhere" }}
                >
                  {task.subject}
                </Text>
              </HStack>
            ))}
          </VStack>
        </VStack>
      }
    >
      <Button label={label} variant="ghost" width="fit-content" className="xgent-task-trigger">
        <HStack gap={2} vAlign="center" width="100%">
          {allDone ? (
            <Check />
          ) : active ? (
            <span
              className="xgent-thinking-orb"
              data-paused={!isConversationRunning}
              aria-hidden="true"
            />
          ) : (
            <Clock3 />
          )}
          <StackItem size="fill">
            <Text maxLines={1} hasTruncateTooltip={false} style={{ textAlign: "start" }}>
              {label}
            </Text>
          </StackItem>
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {position} / {snapshot.tasks.length}
          </Text>
          {isOpen ? <ChevronUp /> : <ChevronDown />}
        </HStack>
      </Button>
    </Popover>
  );
}
