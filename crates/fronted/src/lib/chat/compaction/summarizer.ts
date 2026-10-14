import type { AssistantMessage, Context } from "@earendil-works/pi-ai";

import type { StreamDebugLogger } from "../../debug/agentDebug";
import { assistantMessageToText, completeAssistantMessage } from "../../providers/llm";
import type { ProviderId } from "../../settings";
import { COMPACTION_MAX_CHUNKS, takeCompactionChunk } from "./chunks";
import {
  COMPACTION_PAYLOAD_TOKEN_CAP,
  type CompactionPayload,
  estimateCompactionPayloadTokens,
  resolveCompactionPayloadBudget,
  stringifyCompactionPayload,
} from "./payload";
import { detectCompactionSummaryLanguage } from "./summaryLanguage";
import { buildCompactionSystemPrompt, buildRepairPromptText } from "./summaryPrompt";
import { estimateTextTokens } from "./tokenLedger";
import type { ProviderRuntimeConfig } from "./types";
import { buildVerificationSignals, validateCompactionSummary } from "./validate";

export type CompleteAssistantFn = typeof completeAssistantMessage;

export type SummarizeConversationResult = {
  summaryText: string;
  responseId?: string;
  timestamp: number;
  summarizerUsage: { inputTokens?: number; outputTokens?: number };
  payloadTokens: number;
};

export function createCompactionAbortError() {
  const error = new Error("compaction aborted");
  error.name = "AbortError";
  return error;
}

export async function sleepWithAbort(ms: number, signal?: AbortSignal) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  if (signal?.aborted) throw createCompactionAbortError();

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(createCompactionAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function getRetryDelayMs(attempt: number) {
  return Math.min(1_500, 400 * 2 ** Math.max(0, attempt));
}

function isOverflowError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /context|token|too long|maximum context|input.*too large|overflow/i.test(message);
}

function isNonRetryableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /unauthorized|authentication|invalid api key|quota|rate limit|insufficient|forbidden/i.test(
    message,
  );
}

function isTransientError(error: unknown) {
  if (isNonRetryableError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|network|socket|econn|5\d\d|temporar/i.test(message);
}

function buildSummarizerRuntime(providerId: ProviderId, runtime: ProviderRuntimeConfig) {
  return providerId === "codex" ? { ...runtime, reasoning: "medium" as const } : runtime;
}

type SummarizerRequest = {
  providerId: ProviderId;
  model: string;
  runtime: ProviderRuntimeConfig;
  payload: CompactionPayload;
  signal?: AbortSignal;
  debugLogger?: StreamDebugLogger;
  complete: CompleteAssistantFn;
  repair?: { invalidOutput: string; validationError: string };
  summaryLanguage?: string;
};

function createZeroUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

async function requestSummary(params: SummarizerRequest): Promise<AssistantMessage> {
  const serializedPayload = stringifyCompactionPayload(params.payload);
  const summaryLanguage = params.summaryLanguage ?? detectCompactionSummaryLanguage(params.payload);
  params.debugLogger?.logResult({
    event: "compaction_payload_prepared",
    payloadChars: serializedPayload.length,
    payloadTokens: estimateTextTokens(serializedPayload),
    hardCapTokens: COMPACTION_PAYLOAD_TOKEN_CAP,
    messageCount: params.payload.active_segment_messages.length,
    summaryLanguage: summaryLanguage ?? "english-default",
    repair: Boolean(params.repair),
  });

  const messages: Context["messages"] = [
    { role: "user", content: serializedPayload, timestamp: Date.now() },
  ];
  if (params.repair) {
    messages.push(
      {
        role: "assistant",
        content: [{ type: "text", text: params.repair.invalidOutput }],
        timestamp: Date.now() + 1,
        api: "xgent-compaction",
        provider: params.providerId,
        model: params.model,
        stopReason: "stop",
        usage: createZeroUsage(),
      } as AssistantMessage,
      {
        role: "user",
        content: buildRepairPromptText(
          params.repair.validationError,
          buildVerificationSignals(params.payload),
        ),
        timestamp: Date.now() + 2,
      },
    );
  }

  return params.complete({
    providerId: params.providerId,
    model: params.model,
    runtime: buildSummarizerRuntime(params.providerId, params.runtime),
    context: { systemPrompt: buildCompactionSystemPrompt(summaryLanguage), messages },
    cacheRetention: "none",
    signal: params.signal,
    debugLogger: params.debugLogger,
  });
}

export async function summarizeConversation(params: {
  providerId: ProviderId;
  model: string;
  runtime: ProviderRuntimeConfig;
  payload: CompactionPayload;
  signal?: AbortSignal;
  debugLogger?: StreamDebugLogger;
  complete?: CompleteAssistantFn;
}): Promise<SummarizeConversationResult> {
  const complete = params.complete ?? completeAssistantMessage;
  const original = params.payload;
  if (original.compaction_reason.omitted_message_count)
    throw new Error("Compaction payload omits history; original history retained");
  let budget = Math.min(
    original.compaction_reason.payload_budget_tokens ?? COMPACTION_PAYLOAD_TOKEN_CAP,
    resolveCompactionPayloadBudget(params.runtime.modelConfig),
  );
  let pending = original.active_segment_messages.slice();
  let previousSummary = original.previous_summary;
  let overflowRetryUsed = false;
  const summaryLanguage = detectCompactionSummaryLanguage(original);
  const totalUsage: SummarizeConversationResult["summarizerUsage"] = {};
  const addUsage = (assistant: AssistantMessage) => {
    for (const [key, value] of [
      ["inputTokens", assistant.usage?.input],
      ["outputTokens", assistant.usage?.output],
    ] as const) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0)
        totalUsage[key] = (totalUsage[key] ?? 0) + value;
    }
  };

  for (let chunkIndex = 0; ; chunkIndex++) {
    params.signal?.throwIfAborted();
    if (chunkIndex >= COMPACTION_MAX_CHUNKS)
      throw new Error("Compaction requires too many summary chunks; original history retained");
    const { payload, remaining } = takeCompactionChunk(
      { ...original, previous_summary: previousSummary },
      pending,
      budget,
    );
    const payloadTokens = estimateCompactionPayloadTokens(payload);
    let networkRetryUsed = false;
    try {
      let assistant: AssistantMessage;
      while (true) {
        params.signal?.throwIfAborted();
        try {
          assistant = await requestSummary({ ...params, complete, payload, summaryLanguage });
          addUsage(assistant);
          break;
        } catch (error) {
          if (params.signal?.aborted) throw error;
          if (!networkRetryUsed && isTransientError(error)) {
            networkRetryUsed = true;
            params.debugLogger?.logResult({
              event: "compaction_request_retry",
              reason: String(error),
            });
            await sleepWithAbort(getRetryDelayMs(0), params.signal);
            continue;
          }
          throw error;
        }
      }
      params.signal?.throwIfAborted();
      let summaryText: string;
      try {
        summaryText = validateCompactionSummary(
          assistantMessageToText(assistant),
          payloadTokens,
          payload,
        ).summaryText;
      } catch (validationError) {
        assistant = await requestSummary({
          ...params,
          complete,
          payload,
          summaryLanguage,
          repair: {
            invalidOutput: assistantMessageToText(assistant).trim(),
            validationError:
              validationError instanceof Error ? validationError.message : String(validationError),
          },
        });
        addUsage(assistant);
        params.signal?.throwIfAborted();
        summaryText = validateCompactionSummary(
          assistantMessageToText(assistant),
          payloadTokens,
          payload,
        ).summaryText;
      }
      const finalResult: SummarizeConversationResult = {
        summaryText,
        responseId: assistant.responseId,
        timestamp: assistant.timestamp ?? Date.now(),
        summarizerUsage: totalUsage,
        payloadTokens: estimateCompactionPayloadTokens(original),
      };
      params.debugLogger?.logResult({
        event: "compaction_chunk_complete",
        chunkIndex,
        messageCount: payload.active_segment_messages.length,
        remainingMessageCount: remaining.length,
      });
      if (!remaining.length) return finalResult;
      previousSummary = {
        id: `compaction-chunk-${chunkIndex}`,
        content: summaryText,
        summaryMeta: original.previous_summary?.summaryMeta ?? null,
      };
      pending = remaining;
    } catch (error) {
      if (params.signal?.aborted) throw error;
      if (!overflowRetryUsed && !isNonRetryableError(error) && isOverflowError(error)) {
        overflowRetryUsed = true;
        budget = Math.floor(budget / 2);
        // Retry the same uncommitted range with smaller chunks, never a
        // head/tail subset. Earlier cumulative summaries remain in memory.
        params.debugLogger?.logResult({
          event: "compaction_chunk_budget_reduced",
          budgetTokens: budget,
        });
        chunkIndex--;
        continue;
      }
      throw error;
    }
  }
}
