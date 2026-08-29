import { ChatToolCalls } from "@astryxdesign/core/Chat";
import { memo, useMemo, useState } from "react";
import { useLocale } from "../../../../i18n";
import type { ToolTraceItem } from "../../../../lib/chat/messages/uiMessages";
import {
  areToolTraceItemsEqual,
  createAstryxToolCall,
  getLocalizedToolTitle,
  ToolCallDetail,
} from "./ToolCallItem";

function ToolTraceGroupInner(props: { items: ToolTraceItem[]; runningToolCallIds?: string[] }) {
  const { items, runningToolCallIds = [] } = props;
  const { t } = useLocale();
  const [isExpanded, setIsExpanded] = useState(false);
  const runningIds = useMemo(() => new Set(runningToolCallIds), [runningToolCallIds]);
  const calls = useMemo(
    () =>
      items.map((item) => {
        const isRunning = Boolean(item.toolCall.id && runningIds.has(item.toolCall.id));
        return createAstryxToolCall(
          item,
          isRunning,
          <ToolCallDetail item={item} isRunning={isRunning} />,
          getLocalizedToolTitle(item, t),
        );
      }),
    [items, runningIds, t],
  );

  return <ChatToolCalls calls={calls} isExpanded={isExpanded} onExpandedChange={setIsExpanded} />;
}

function areRunningIdsEqual(previous?: string[], next?: string[]) {
  if (previous === next) return true;
  if (!previous || !next || previous.length !== next.length) return false;
  return previous.every((id, index) => id === next[index]);
}

export const ToolTraceGroup = memo(
  ToolTraceGroupInner,
  (previous, next) =>
    previous.items.length === next.items.length &&
    previous.items.every(
      (item, index) =>
        item === next.items[index] || areToolTraceItemsEqual(item, next.items[index]),
    ) &&
    areRunningIdsEqual(previous.runningToolCallIds, next.runningToolCallIds),
);
