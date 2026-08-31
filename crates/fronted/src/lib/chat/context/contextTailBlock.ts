import type { Message, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isDisplayImageToolResult(message: ToolResultMessage) {
  if (message.isError) return false;
  if (message.toolName === "Image") return true;
  return isRecord(message.details) && message.details.kind === "display_image";
}

function isSubagentCardToolResult(message: ToolResultMessage) {
  return isRecord(message.details) && message.details.kind === "subagent_card";
}

function followsAbortedAssistant(messages: Message[], index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (message.role === "toolResult") continue;
    return message.role === "assistant" && message.stopReason === "aborted";
  }
  return false;
}

export function resolveTailBlockAnchorId(messages: Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") break;
    if (message.role !== "toolResult") continue;
    if (!Array.isArray(message.content)) continue;
    if (typeof message.toolCallId !== "string" || !message.toolCallId) continue;
    if (isDisplayImageToolResult(message)) continue;
    if (isSubagentCardToolResult(message)) continue;
    if (followsAbortedAssistant(messages, index)) continue;
    return message.toolCallId;
  }
  return null;
}

export type PinnedTailBlock = {
  anchorToolCallId: string;
  text: string;
};

export function attachPinnedTailBlocks(
  messages: Message[],
  blocks: readonly PinnedTailBlock[],
): Message[] {
  if (blocks.length === 0) return messages;

  const byAnchor = new Map<string, string[]>();
  for (const block of blocks) {
    if (!block.text) continue;
    const existing = byAnchor.get(block.anchorToolCallId);
    if (existing) existing.push(block.text);
    else byAnchor.set(block.anchorToolCallId, [block.text]);
  }
  if (byAnchor.size === 0) return messages;

  let next: Message[] | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "toolResult") continue;
    if (!Array.isArray(message.content)) continue;
    const texts = byAnchor.get(message.toolCallId);
    if (!texts) continue;

    const appended: TextContent[] = texts.map((text) => ({ type: "text", text }));
    if (!next) next = messages.slice();
    next[index] = { ...message, content: [...message.content, ...appended] };
  }

  return next ?? messages;
}
