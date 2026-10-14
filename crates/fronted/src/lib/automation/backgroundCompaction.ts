import type { Context, Message } from "@earendil-works/pi-ai";
import {
  type CompactionCheckpointMessage,
  createSyntheticContinueUserMessage,
  runCompaction,
} from "../chat/compaction/engine";
import { resolveCompactionThreshold } from "../chat/compaction/policy";
import {
  deriveContextTokens,
  estimateMessageTokens,
  estimateTextTokens,
  estimateToolsTokens,
} from "../chat/compaction/tokenLedger";
import type { ProviderRuntimeConfig } from "../chat/compaction/types";
import {
  buildRequestContext,
  createConversationStateFromContext,
} from "../chat/conversation/conversationState";
import type { StreamDebugLogger } from "../debug/agentDebug";
import { completeAssistantMessage } from "../providers/llm";
import type { ProviderId } from "../settings";
import { backgroundReceipt } from "./backgroundExecutionJournal";
import type { PromptRunRequest } from "./types";

const COMPACTION_BYTE_THRESHOLD = 2 * 1024 * 1024;
const utf8Bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

// Retained assistants carry historic usage, not the replacement prompt size.
function freshContextTokens(context: Context) {
  return (
    estimateTextTokens(context.systemPrompt ?? "") +
    estimateToolsTokens(context.tools) +
    context.messages.reduce((tokens, message) => tokens + estimateMessageTokens(message), 0)
  );
}

function completeRecentToolTurn(messages: Message[]): Message[] {
  let start = -1;
  const pending = new Map<string, string>();
  for (const [index, message] of messages.entries()) {
    if (message.role === "assistant") {
      if (pending.size)
        throw new Error("Background context contains unfinished tool calls before another turn");
      start = index;
      for (const part of message.content) {
        if (part.type !== "toolCall") continue;
        if (pending.has(part.id))
          throw new Error("Duplicate tool call at the background compaction boundary");
        pending.set(part.id, part.name);
      }
    } else if (message.role === "toolResult") {
      if (pending.get(message.toolCallId) !== message.toolName)
        throw new Error("Background context contains an orphaned or mismatched tool receipt");
      pending.delete(message.toolCallId);
    } else if (pending.size) {
      throw new Error("Background context contains unfinished tool calls before user input");
    }
  }
  if (pending.size)
    throw new Error("Background context cannot be compacted across unfinished tool calls");
  return start < 0 ? [] : messages.slice(start);
}

/** Rebuild policy from accepted settings and memory from the actual native
 * compaction checkpoint. Never recover dynamic state by parsing old prompts. */
export function rebuildBackgroundSystemPrompt(
  baseSystemPrompt: string,
  request: Pick<PromptRunRequest, "prompt" | "startedAt">,
  checkpoint?: CompactionCheckpointMessage,
) {
  if (!checkpoint) return baseSystemPrompt;
  const state = createConversationStateFromContext({
    systemPrompt: baseSystemPrompt,
    messages: [{ role: "user", content: request.prompt, timestamp: request.startedAt }, checkpoint],
  });
  return buildRequestContext(state).systemPrompt ?? baseSystemPrompt;
}

export function createBackgroundCompactor(options: {
  request: PromptRunRequest;
  baseSystemPrompt: string;
  providerId: ProviderId;
  runtime: ProviderRuntimeConfig;
  signal: AbortSignal;
  debugLogger?: StreamDebugLogger;
  verifyConfiguration: () => Promise<unknown>;
  beforeModelRequest?: () => void | Promise<void>;
  persist: (context: Context, checkpoint: CompactionCheckpointMessage) => Promise<void>;
  previousCheckpoint?: CompactionCheckpointMessage;
}) {
  let previousCheckpoint = options.previousCheckpoint;
  return {
    async compactIfNeeded(runtimeContext: Context): Promise<Context | null> {
      options.signal.throwIfAborted();
      const source: Context = {
        ...runtimeContext,
        messages: runtimeContext.messages.map((message) =>
          message.role === "toolResult" ? backgroundReceipt(message) : message,
        ),
      };
      const tokensBefore = Math.max(deriveContextTokens(source), freshContextTokens(source));
      const model = options.runtime.modelConfig;
      const threshold =
        model?.contextWindow && model.maxOutputToken
          ? Math.min(
              Math.floor(model.contextWindow * 0.75),
              resolveCompactionThreshold({
                providerId: options.providerId,
                intent: "protection",
                contextWindow: model.contextWindow,
                maxOutputToken: model.maxOutputToken,
                pressureLevel: 0,
              }).threshold,
            )
          : 0;
      const bytesBefore = utf8Bytes({
        systemPrompt: source.systemPrompt,
        messages: source.messages,
      });
      if ((!threshold || tokensBefore < threshold) && bytesBefore < COMPACTION_BYTE_THRESHOLD)
        return null;
      const recent = completeRecentToolTurn(source.messages);
      const originalRequest: Message = {
        role: "user",
        content: options.request.prompt,
        timestamp: options.request.startedAt || Date.now(),
      };
      const state = createConversationStateFromContext({
        systemPrompt: options.baseSystemPrompt,
        tools: source.tools,
        // Conversation checkpoints require a nonempty covered segment. A
        // checkpoint in the first position is deliberately ignored by the
        // existing engine; seed it with the real accepted request it covers.
        messages: previousCheckpoint
          ? [originalRequest, previousCheckpoint, ...source.messages]
          : source.messages,
      });
      const outcome = await runCompaction({
        state,
        incomingUserText: options.request.prompt,
        intent: "protection",
        contextTokens: tokensBefore,
        threshold,
        providerId: options.providerId,
        model: options.request.model,
        runtime: options.runtime,
        signal: options.signal,
        debugLogger: options.debugLogger,
        complete: async (params) => {
          options.signal.throwIfAborted();
          await options.verifyConfiguration();
          options.signal.throwIfAborted();
          return completeAssistantMessage({
            ...params,
            beforeModelRequest: options.beforeModelRequest,
          });
        },
      });
      const prepared = buildRequestContext(outcome.state);
      const resume = createSyntheticContinueUserMessage();
      const next: Context = { ...prepared, messages: [originalRequest, ...recent, resume] };
      const fits = (context: Context) =>
        utf8Bytes({ systemPrompt: context.systemPrompt, messages: context.messages }) <
          bytesBefore &&
        (!threshold || freshContextTokens(context) < threshold * 0.85);
      // Drop a whole completed turn when necessary; never strand a receipt.
      // Its original messages and operation receipts remain in native storage.
      if (!fits(next)) next.messages = [originalRequest, resume];
      if (!fits(next))
        throw new Error(
          "Background compaction did not release enough context; original evidence was retained",
        );
      await options.verifyConfiguration();
      options.signal.throwIfAborted();
      await options.persist(next, outcome.checkpointMessage);
      options.signal.throwIfAborted();
      previousCheckpoint = outcome.checkpointMessage;
      return next;
    },
  };
}
