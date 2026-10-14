import type { AssistantMessage, Context, ToolCall } from "@earendil-works/pi-ai";
import type { CompactionCheckpointMessage } from "../chat/compaction/engine";
import type { BackgroundResumeCheckpoint } from "./types";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () =>
  new Error("Invalid background recovery checkpoint; retained evidence needs inspection");

/** Validate the stored boundary before any model or tool receives it. Only a
 * tail tool group may be unfinished, and only exact call IDs can recover it. */
export function restoreBackgroundContext(
  snapshot: BackgroundResumeCheckpoint,
  prompt: string,
  tools: Context["tools"],
): {
  revision: number;
  context?: Context;
  pendingCalls: ToolCall[];
  conclusion?: AssistantMessage;
  lastCompaction?: CompactionCheckpointMessage;
} {
  if (!object(snapshot) || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0)
    throw invalid();
  if (snapshot.revision === 0) {
    if (snapshot.context != null || snapshot.lastCompaction != null) throw invalid();
    return { revision: 0, pendingCalls: [] };
  }
  const saved = snapshot.context;
  if (
    !object(saved) ||
    typeof saved.systemPrompt !== "string" ||
    !Array.isArray(saved.messages) ||
    !saved.messages.length
  )
    throw invalid();
  const seen = new Set<string>();
  const pending = new Map<string, ToolCall>();
  let original = false;
  for (const message of saved.messages) {
    if (
      !object(message) ||
      typeof message.timestamp !== "number" ||
      !Number.isFinite(message.timestamp)
    )
      throw invalid();
    if (message.role === "user") {
      if (pending.size || (typeof message.content !== "string" && !Array.isArray(message.content)))
        throw invalid();
      if (message.content === prompt) original = true;
    } else if (message.role === "assistant") {
      if (pending.size || !Array.isArray(message.content)) throw invalid();
      if (
        message.content.some((part: unknown) => object(part) && part.type === "toolCall") &&
        message.stopReason !== "toolUse"
      )
        throw new Error("Incomplete assistant output cannot authorize recovered tool calls");
      for (const part of message.content) {
        if (!object(part)) throw invalid();
        if (part.type === "toolCall") {
          if (
            typeof part.id !== "string" ||
            !part.id ||
            typeof part.name !== "string" ||
            !part.name ||
            !object(part.arguments) ||
            seen.has(part.id)
          )
            throw invalid();
          seen.add(part.id);
          pending.set(part.id, part as unknown as ToolCall);
        } else if (part.type === "text") {
          if (typeof part.text !== "string") throw invalid();
        } else if (part.type === "thinking") {
          if (typeof part.thinking !== "string") throw invalid();
        } else throw invalid();
      }
    } else if (message.role === "toolResult") {
      if (
        typeof message.toolCallId !== "string" ||
        pending.get(message.toolCallId)?.name !== message.toolName ||
        !Array.isArray(message.content) ||
        typeof message.isError !== "boolean"
      )
        throw invalid();
      if (object(message.details) && message.details.outcomeUncertain === true)
        throw new Error("Uncertain operation receipt cannot authorize background recovery");
      pending.delete(message.toolCallId);
    } else throw invalid();
  }
  if (!original) throw new Error("Background recovery lost the exact accepted request");
  const last = saved.messages.at(-1);
  let conclusion: AssistantMessage | undefined;
  if (!pending.size && last.role === "assistant") {
    if (
      last.api === "xgent-compaction" ||
      last.stopReason !== "stop" ||
      !last.content.some(
        (part: Record<string, unknown>) =>
          part.type === "text" && typeof part.text === "string" && part.text.trim(),
      )
    )
      throw new Error("Background recovery has no complete model continuation boundary");
    conclusion = last as AssistantMessage;
  }
  let lastCompaction: CompactionCheckpointMessage | undefined;
  if (snapshot.lastCompaction != null) {
    const summary = snapshot.lastCompaction;
    if (
      !object(summary) ||
      summary.role !== "assistant" ||
      summary.api !== "xgent-compaction" ||
      typeof summary.promptVersion !== "string" ||
      !object(summary.compactionStats) ||
      !Array.isArray(summary.content) ||
      !summary.content.every(
        (part: unknown) => object(part) && part.type === "text" && typeof part.text === "string",
      )
    )
      throw invalid();
    lastCompaction = summary as unknown as CompactionCheckpointMessage;
  }
  return {
    revision: snapshot.revision,
    context: { systemPrompt: saved.systemPrompt, messages: saved.messages, tools },
    pendingCalls: [...pending.values()],
    conclusion,
    lastCompaction,
  };
}
