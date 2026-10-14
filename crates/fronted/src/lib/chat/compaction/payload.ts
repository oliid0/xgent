import type { AssistantMessage, Message } from "@earendil-works/pi-ai";

import type { StreamDebugLogger } from "../../debug/agentDebug";
import { assistantMessageToText } from "../../providers/llm";
import type { ProviderModelConfig } from "../../settings";
import {
  sanitizeMessageForModelContext,
  sanitizeMessagesForModelContext,
} from "../context/requestContextSanitizer";
import {
  type ConversationViewState,
  getActiveSegment,
  type StoredSummaryMessage,
} from "../conversation/conversationState";
import { estimateTextTokens } from "./tokenLedger";
import type { CompactionIntent } from "./types";

export const COMPACTION_PAYLOAD_TOKEN_CAP = 32_000;
const COMPACTION_PROMPT_TOKEN_BUDGET = 1_500;
const COMPACTION_HISTORY_BUDGET_FACTOR = 0.9;
const COMPACTION_OUTPUT_RESERVE_FACTOR = 0.5;

export type SerializedAssistantCompactionMessage = {
  index: number;
  role: "assistant";
  timestamp: number | null;
  stopReason: AssistantMessage["stopReason"] | null;
  text?: string;
  toolCalls?: string[];
  usageTotalTokens?: number;
};

export type SerializedToolResultCompactionMessage = {
  index: number;
  role: "toolResult";
  timestamp: number | null;
  toolName: string;
  toolCallId: string;
  isError: boolean;
  content: string;
  details?: string;
};

export type SerializedGenericCompactionMessage = {
  index: number;
  role: "user" | string;
  timestamp: number | null;
  content: string;
};

export type SerializedCompactionMessage = (
  | SerializedAssistantCompactionMessage
  | SerializedToolResultCompactionMessage
  | SerializedGenericCompactionMessage
) & { fragment?: { part: number; continued: boolean } };

export type CompactionReason = {
  trigger: string;
  context_tokens: number;
  threshold: number;
  payload_budget_tokens?: number;
  reduced_input?: boolean;
  omitted_message_count?: number;
};

export type CompactionPayload = {
  compaction_reason: CompactionReason;
  system_prompt: string;
  previous_summary: {
    id: string;
    content: string;
    summaryMeta: unknown;
  } | null;
  active_segment_messages: SerializedCompactionMessage[];
  next_user_message?: string;
};

export function trimText(input: string, maxChars: number) {
  const text = input.trim();
  if (!text || text.length <= maxChars) return text;
  const head = Math.max(1, Math.floor(maxChars * 0.7));
  const tail = Math.max(1, maxChars - head);
  return `${text.slice(0, head)}\n\n... [truncated] ...\n\n${text.slice(-tail)}`;
}

export function toPlainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function flattenContentBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return toPlainText(content);

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      const raw = toPlainText(block).trim();
      if (raw) parts.push(raw);
      continue;
    }

    const record = block as Record<string, unknown>;
    if (record.type === "text") {
      const text = typeof record.text === "string" ? record.text.trim() : "";
      if (text) parts.push(text);
      continue;
    }

    const raw = toPlainText(record).trim();
    if (raw) parts.push(raw);
  }

  return parts.join("\n\n");
}

function summarizeAssistantToolCalls(message: AssistantMessage) {
  if (!Array.isArray(message.content)) return [];

  const out: string[] = [];
  for (const block of message.content) {
    if (!block || typeof block !== "object") continue;
    const record = block as unknown as Record<string, unknown>;
    if (record.type !== "toolCall") continue;

    const name = typeof record.name === "string" ? record.name.trim() : "";
    const args = toPlainText(record.arguments);
    if (name && args) {
      out.push(`${name} ${args}`);
    } else if (name) {
      out.push(name);
    }
  }
  return out;
}

export function serializeMessageForCompaction(
  message: Message,
  index: number,
): SerializedCompactionMessage {
  message = sanitizeMessageForModelContext(message);

  if (message.role === "assistant") {
    const text = assistantMessageToText(message).trim();
    const toolCalls = summarizeAssistantToolCalls(message);
    return {
      index,
      role: "assistant",
      timestamp: message.timestamp ?? null,
      stopReason: message.stopReason ?? null,
      text: text || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usageTotalTokens:
        typeof message.usage?.totalTokens === "number" ? message.usage.totalTokens : undefined,
    };
  }

  if (message.role === "toolResult") {
    return {
      index,
      role: "toolResult",
      timestamp: message.timestamp ?? null,
      toolName: message.toolName,
      toolCallId: message.toolCallId,
      isError: Boolean(message.isError),
      content: flattenContentBlocks(message.content),
      details: message.details ? toPlainText(message.details) : undefined,
    };
  }

  return {
    index,
    role: message.role,
    timestamp: (message as { timestamp?: number }).timestamp ?? null,
    content: flattenContentBlocks((message as { content?: unknown }).content),
  };
}

function summaryMetaForPayload(meta: StoredSummaryMessage["summaryMeta"]) {
  const { fileLedger, ...rest } = meta;
  void fileLedger;
  return rest;
}

export function buildCompactionPayload(params: {
  state: ConversationViewState;
  incomingUserText?: string;
  intent: CompactionIntent;
  contextTokens: number;
  threshold: number;
}): CompactionPayload {
  const activeSegment = getActiveSegment(params.state);
  const activeSegmentMessages = sanitizeMessagesForModelContext(activeSegment.messages);
  return {
    compaction_reason: {
      trigger:
        params.intent === "optimization"
          ? "pre-send-optimization-threshold"
          : "mid-turn-protection-threshold",
      context_tokens: params.contextTokens,
      threshold: params.threshold,
    },
    system_prompt: params.state.meta.systemPrompt ?? "",
    previous_summary: activeSegment.summary
      ? {
          id: activeSegment.summary.id,
          content: activeSegment.summary.content,
          summaryMeta: summaryMetaForPayload(activeSegment.summary.summaryMeta),
        }
      : null,
    active_segment_messages: activeSegmentMessages.map((message, index) =>
      serializeMessageForCompaction(message, index),
    ),
    next_user_message: params.incomingUserText?.trim() ? params.incomingUserText : undefined,
  };
}

export function stringifyCompactionPayload(payload: CompactionPayload) {
  return JSON.stringify(payload);
}

export function estimateCompactionPayloadTokens(payload: CompactionPayload) {
  return estimateTextTokens(stringifyCompactionPayload(payload));
}

export function resolveCompactionPayloadBudget(modelConfig?: ProviderModelConfig) {
  const contextWindow = Math.max(0, Math.floor(modelConfig?.contextWindow ?? 0));
  const maxOutputToken = Math.max(0, Math.floor(modelConfig?.maxOutputToken ?? 0));
  if (contextWindow <= 0 || maxOutputToken <= 0) {
    return COMPACTION_PAYLOAD_TOKEN_CAP;
  }

  const outputReserve = Math.max(
    512,
    Math.floor(maxOutputToken * COMPACTION_OUTPUT_RESERVE_FACTOR),
  );
  const availableTokens = contextWindow - outputReserve - COMPACTION_PROMPT_TOKEN_BUDGET;
  if (availableTokens <= 0) {
    return COMPACTION_PAYLOAD_TOKEN_CAP;
  }

  return Math.max(
    1_024,
    Math.min(
      COMPACTION_PAYLOAD_TOKEN_CAP,
      Math.floor(availableTokens * COMPACTION_HISTORY_BUDGET_FACTOR),
    ),
  );
}

export function fitCompactionPayloadToBudget(params: {
  payload: CompactionPayload;
  modelConfig?: ProviderModelConfig;
  debugLogger?: StreamDebugLogger;
}) {
  const budgetTokens = resolveCompactionPayloadBudget(params.modelConfig);
  if (!budgetTokens) {
    return params.payload;
  }

  if (estimateCompactionPayloadTokens(params.payload) <= budgetTokens) return params.payload;
  // Carry the complete range to the chunked summarizer. Budgeting must not
  // silently delete the middle of a conversation or trim the prior checkpoint.
  params.debugLogger?.logResult({
    event: "compaction_payload_requires_chunks",
    budgetTokens,
    messageCount: params.payload.active_segment_messages.length,
  });
  return {
    ...params.payload,
    compaction_reason: { ...params.payload.compaction_reason, payload_budget_tokens: budgetTokens },
  };
}
