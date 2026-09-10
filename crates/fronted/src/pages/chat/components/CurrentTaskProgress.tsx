import { Button } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { TaskProgressBar } from "../../../components/chat/TaskProgressBar";
import { useLocale } from "../../../i18n";
import { collectActivityItems } from "../../../lib/chat/activityTimeline";
import type { RenderTimelineItem } from "../../../lib/chat/conversation/conversationState";
import type { LiveTranscriptStore } from "../../../lib/chat/conversation/liveTranscriptStore";
import { selectLatestTaskProgress } from "../../../lib/chat/taskProgress";
import { requestToolActivity, toolStepLabel } from "../../../lib/chat/toolActivityNavigation";
import type { TaskListState } from "../../../lib/tools/builtinTypes";

export function CurrentTaskProgress(props: {
  historyItems: readonly RenderTimelineItem[];
  liveTranscriptStore: LiveTranscriptStore;
  isConversationRunning: boolean;
  persistedState?: TaskListState;
  onOpenActivity?: () => void;
}) {
  const { historyItems, liveTranscriptStore, isConversationRunning, persistedState } = props;
  const { t } = useLocale();
  const getLiveRoundsSnapshot = useCallback(
    () => liveTranscriptStore.getSnapshot().liveRounds,
    [liveTranscriptStore],
  );
  const liveRounds = useSyncExternalStore(
    liveTranscriptStore.subscribe,
    getLiveRoundsSnapshot,
    getLiveRoundsSnapshot,
  );
  const snapshot = useMemo(
    () => selectLatestTaskProgress(historyItems, liveRounds, persistedState),
    [historyItems, liveRounds, persistedState],
  );
  let currentTurnStart = historyItems.length - 1;
  while (currentTurnStart >= 0 && historyItems[currentTurnStart].kind !== "user")
    currentTurnStart--;
  const steps = collectActivityItems(historyItems.slice(currentTurnStart + 1), {
    ...liveTranscriptStore.getSnapshot(),
    liveRounds,
  });
  return snapshot?.tasks.length ? (
    <TaskProgressBar snapshot={snapshot} isConversationRunning={isConversationRunning} />
  ) : steps.length ? (
    <Collapsible
      trigger={
        <Text type="supporting">
          {t("chat.activity.tools")} · {steps.filter((step) => step.toolResult).length} /{" "}
          {steps.length}
        </Text>
      }
    >
      <VStack gap={1} width="100%">
        {steps.map((step) => (
          <VStack key={step.toolCall.id} gap={0}>
            <Button
              variant="ghost"
              size="sm"
              label={toolStepLabel(step, step.toolCall.name)}
              onClick={() => requestToolActivity(step)}
            />
            <Text type="supporting" color="secondary">
              {t(
                step.running
                  ? "chat.mobileActivity.running"
                  : step.toolResult?.isError
                    ? "chat.activity.stopped"
                    : step.toolResult
                      ? "chat.tasks.completed"
                      : "chat.mobileActivity.awaitingResult",
              )}
            </Text>
          </VStack>
        ))}
      </VStack>
    </Collapsible>
  ) : (
    <Button
      label={t(
        isConversationRunning
          ? "chat.mobileActivity.working"
          : historyItems.at(-1)?.kind === "assistant"
            ? "chat.tasks.completed"
            : "chat.activity.stopped",
      )}
      variant="ghost"
      size="sm"
      onClick={props.onOpenActivity}
    />
  );
}
