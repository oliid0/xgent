import type { ToolTraceItem } from "../../../lib/chat/messages/uiMessages";
import type { AssistantUnitRow } from "./rowModel";

/** A tool run belongs to one round and ends at intervening narrative.
 * File operations keep their exact tool/target; other calls group by explicit
 * intent or the verified MCP server identity, never by a guessed tool name.
 */
export function groupWorkTools(items: readonly ToolTraceItem[]) {
  const groups: ToolTraceItem[][] = [];
  let previousKey: string | null = null;
  for (const item of items) {
    const args = item.toolCall.arguments ?? {};
    const path = args.file_path ?? args.path;
    const step = workToolStep(item);
    const integration = workToolIntegration(item);
    const key =
      ["Read", "Write", "Edit", "Delete", "List", "Glob", "Grep"].includes(item.toolCall.name) &&
      typeof path === "string" &&
      path.trim()
        ? JSON.stringify([item.toolCall.name, path, step])
        : step
          ? JSON.stringify(["step", step])
          : integration
            ? JSON.stringify(["integration", integration.id])
            : null;
    if (key !== null && key === previousKey) groups[groups.length - 1].push(item);
    else groups.push([item]);
    previousKey = key;
  }
  return groups;
}

export function workToolStep(item: ToolTraceItem) {
  const args = item.toolCall.arguments ?? {};
  return (
    [args.brief, args.description, args.title]
      .find((value): value is string => typeof value === "string" && Boolean(value.trim()))
      ?.trim() ?? ""
  );
}

export function workToolIntegration(item: ToolTraceItem) {
  const details = item.toolResult?.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const source = details as Record<string, unknown>;
  if (typeof source.serverId !== "string" || !source.serverId.trim()) return null;
  return {
    id: source.serverId.trim(),
    label:
      typeof source.serverLabel === "string" && source.serverLabel.trim()
        ? source.serverLabel.trim()
        : source.serverId.trim(),
    tool:
      typeof source.tool === "string" && source.tool.trim()
        ? source.tool.trim()
        : item.toolCall.name,
  };
}

export function workToolGroupLabel(items: readonly ToolTraceItem[], t: (key: string) => string) {
  const integrations = new Map(
    items.flatMap((item) => {
      const integration = workToolIntegration(item);
      return integration ? [[integration.id, integration.label] as const] : [];
    }),
  );
  if (integrations.size) {
    const commands = items.some((item) => ["Bash", "ManagedProcess"].includes(item.toolCall.name));
    return t(commands ? "chat.work.integrationCommands" : "chat.work.integration").replace(
      "{provider}",
      [...integrations.values()].join(", "),
    );
  }
  return workToolStep(items[0]) || undefined;
}

/** Keep the final answer and interactive questions outside the work disclosure. */
export function workRecord(units: readonly AssistantUnitRow[], showThinking: boolean) {
  const visible = units.filter(
    ({ unit }) => showThinking || unit.kind !== "block" || unit.block.kind !== "thinking",
  );
  let lastWork = -1;
  visible.forEach(({ unit }, index) => {
    if (unit.kind === "block" && unit.block.kind !== "text") lastWork = index;
  });
  const work: AssistantUnitRow[] = [];
  const answer: AssistantUnitRow[] = [];
  visible.forEach((row, index) => {
    const block = row.unit.kind === "block" ? row.unit.block : null;
    const special =
      block?.kind === "tool" &&
      ["AskUserQuestion", "Image", "Agent"].includes(block.item.toolCall.name);
    if (index <= lastWork && block && !special) work.push(row);
    else answer.push(row);
  });
  return { work, answer };
}

export function workDuration(startedAt: number | undefined, endedAt: number) {
  if (!startedAt || endedAt < startedAt) return null;
  const seconds = Math.max(1, Math.round((endedAt - startedAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
