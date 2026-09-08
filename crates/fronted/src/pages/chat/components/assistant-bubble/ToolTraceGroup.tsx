import { Collapsible } from "@astryxdesign/core/Collapsible";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { memo, useMemo, useState } from "react";
import { useLocale } from "../../../../i18n";
import type { ToolTraceItem } from "../../../../lib/chat/messages/uiMessages";
import { areToolTraceItemsEqual, ToolStepRow } from "./ToolCallItem";

function ToolTraceGroupInner(props: { items: ToolTraceItem[]; runningToolCallIds?: string[] }) {
  const { items, runningToolCallIds = [] } = props;
  const { t } = useLocale();
  const [isExpanded, setIsExpanded] = useState(false);
  const runningIds = useMemo(() => new Set(runningToolCallIds), [runningToolCallIds]);
  const edited = new Set<string>();
  const read = new Set<string>();
  let commands = false;
  let tools = false;
  for (const { toolCall, toolResult } of items) {
    const path = String(toolCall.arguments?.path ?? toolCall.arguments?.file_path ?? toolCall.id);
    if (toolResult && !toolResult.isError && ["Edit", "Write", "Delete"].includes(toolCall.name))
      edited.add(path);
    else if (toolResult && !toolResult.isError && toolCall.name === "Read") read.add(path);
    else if (["Bash", "ManagedProcess"].includes(toolCall.name)) commands = true;
    else tools = true;
  }
  const summary = [
    edited.size ? t("chat.activity.edited").replace("{count}", String(edited.size)) : "",
    read.size ? t("chat.activity.read").replace("{count}", String(read.size)) : "",
    commands ? t("chat.activity.commands") : "",
    tools ? t("chat.activity.tools") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const active = [...items].reverse().find((item) => runningIds.has(item.toolCall.id));
  return (
    <VStack gap={1} width="100%">
      <Collapsible
        isOpen={isExpanded}
        onOpenChange={setIsExpanded}
        trigger={
          <Text type="supporting" color="secondary">
            {summary}
          </Text>
        }
      >
        <VStack gap={1} paddingBlock={2} width="100%">
          {items.map((item) => (
            <ToolStepRow
              key={item.toolCall.id}
              item={item}
              isRunning={runningIds.has(item.toolCall.id)}
            />
          ))}
        </VStack>
      </Collapsible>
      {!isExpanded && active ? <ToolStepRow item={active} isRunning /> : null}
    </VStack>
  );
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
