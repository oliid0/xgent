import { Button } from "@astryxdesign/core/Button";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { TaskProgressBar } from "../../../components/chat/TaskProgressBar";
import { useLocale } from "../../../i18n";
import type { RenderTimelineItem } from "../../../lib/chat/conversation/conversationState";
import type { LiveTranscriptStore } from "../../../lib/chat/conversation/liveTranscriptStore";
import { selectLatestTaskProgress } from "../../../lib/chat/taskProgress";
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
  return snapshot?.tasks.length ? (
    <TaskProgressBar snapshot={snapshot} isConversationRunning={isConversationRunning} />
  ) : (
    <Button
      label={t("chat.mobileActivity.recent")}
      variant="ghost"
      size="sm"
      onClick={props.onOpenActivity}
    />
  );
}
