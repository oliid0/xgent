import type { RenderTimelineItem } from "./conversation/conversationState";
import type { LiveTranscriptState } from "./conversation/liveTranscriptStore";
import type { ToolTraceItem } from "./messages/uiMessages";

export type ActivityItem = ToolTraceItem & { running: boolean; round: number };

/** Persisted tool results survive settlement, navigation and application restart. */
export function collectActivityItems(
  history: readonly RenderTimelineItem[],
  live: LiveTranscriptState,
) {
  const items = new Map<string, ActivityItem>();
  for (const group of history) {
    if (group.kind !== "assistant") continue;
    for (const round of group.rounds) {
      for (const block of round.blocks) {
        if (block.kind === "tool")
          items.set(block.item.toolCall.id, { ...block.item, running: false, round: round.round });
      }
    }
  }
  for (const round of live.liveRounds) {
    for (const block of round.blocks) {
      if (block.kind !== "tool") continue;
      const persisted = items.get(block.item.toolCall.id);
      items.set(block.item.toolCall.id, {
        ...block.item,
        toolResult: block.item.toolResult ?? persisted?.toolResult,
        running: !live.isSettled && round.runningToolCallIds.includes(block.item.toolCall.id),
        round: round.round,
      });
    }
  }
  return [...items.values()];
}
