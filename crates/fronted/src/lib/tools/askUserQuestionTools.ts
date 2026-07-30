import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  ASK_USER_QUESTION_MAX_OPTIONS,
  ASK_USER_QUESTION_MAX_QUESTIONS,
  ASK_USER_QUESTION_MIN_OPTIONS,
  ASK_USER_QUESTION_TIMEOUT_MS,
  ASK_USER_QUESTION_TOOL_NAME,
  type AskUserQuestionAnswer,
  type AskUserQuestionItem,
  type AskUserQuestionResultDetails,
  buildAskUserQuestionResultText,
  buildDefaultAskUserQuestionAnswers,
  parseAskUserQuestionItems,
  resolveAskUserQuestionAnswers,
} from "../chat/askUserQuestion";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";

type Settlement =
  | { kind: "answered"; answers: AskUserQuestionAnswer[] }
  | { kind: "timeout"; answers: AskUserQuestionAnswer[] }
  | { kind: "cancelled" };

type PendingQuestion = {
  conversationId: string;
  questions: AskUserQuestionItem[];
  deadlineAt: number;
  settle: (settlement: Settlement) => void;
};

const pendingByToolCallId = new Map<string, PendingQuestion>();
const presetDeadlineByToolCallId = new Map<string, number>();

function sweepPresetDeadlines(now: number) {
  for (const [toolCallId, deadlineAt] of presetDeadlineByToolCallId) {
    if (deadlineAt + 60_000 < now) presetDeadlineByToolCallId.delete(toolCallId);
  }
}

export function ensureAskUserQuestionDeadlineAt(toolCallId: string) {
  const id = toolCallId.trim();
  const pending = pendingByToolCallId.get(id);
  if (pending) return pending.deadlineAt;
  const now = Date.now();
  sweepPresetDeadlines(now);
  const existing = presetDeadlineByToolCallId.get(id);
  if (existing !== undefined) return existing;
  const deadlineAt = now + ASK_USER_QUESTION_TIMEOUT_MS;
  presetDeadlineByToolCallId.set(id, deadlineAt);
  return deadlineAt;
}

export function getAskUserQuestionDeadlineAt(toolCallId: string) {
  const id = toolCallId.trim();
  return (
    pendingByToolCallId.get(id)?.deadlineAt ?? presetDeadlineByToolCallId.get(id) ?? undefined
  );
}

export function answerAskUserQuestion(
  toolCallId: string,
  rawAnswers: unknown,
  expectedConversationId?: string,
) {
  const pending = pendingByToolCallId.get(toolCallId.trim());
  if (!pending) {
    return { ok: false, message: "This question is no longer waiting for an answer." };
  }
  if (
    expectedConversationId?.trim() &&
    pending.conversationId !== expectedConversationId.trim()
  ) {
    return { ok: false, message: "This question belongs to another conversation." };
  }
  const answers = resolveAskUserQuestionAnswers(pending.questions, rawAnswers);
  if (!answers) {
    return { ok: false, message: "Answer every question before submitting." };
  }
  pending.settle({ kind: "answered", answers });
  return { ok: true };
}

export function cancelPendingAskUserQuestionsForConversation(conversationId: string) {
  for (const pending of pendingByToolCallId.values()) {
    if (pending.conversationId === conversationId) pending.settle({ kind: "cancelled" });
  }
}

const parameters = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.Optional(Type.String({ description: "Stable question id." })),
      header: Type.Optional(Type.String({ description: "Short tab label." })),
      prompt: Type.String({ description: "Question shown to the user." }),
      options: Type.Array(
        Type.Object({
          label: Type.String({ description: "Concise option label." }),
          description: Type.Optional(Type.String({ description: "One-line trade-off." })),
          recommended: Type.Optional(
            Type.Boolean({ description: "Recommended choice and timeout fallback." }),
          ),
        }),
        {
          description: `${ASK_USER_QUESTION_MIN_OPTIONS}-${ASK_USER_QUESTION_MAX_OPTIONS} mutually exclusive options.`,
        },
      ),
    }),
    { description: `1-${ASK_USER_QUESTION_MAX_QUESTIONS} focused questions.` },
  ),
});

const description = `Ask the user one or more multiple-choice questions and wait for the answer.

Use this only when a decision cannot be resolved from the conversation or workspace. The UI adds an
Other field automatically, so do not add a catch-all option. Mark at most one option per question as
recommended. If the user does not answer within three minutes, that option (or the first option) is
selected automatically. Do not use this tool in place of inspecting available evidence.`;

function errorResult(toolCall: ToolCall, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text }],
    details: {},
    isError: true,
    timestamp: Date.now(),
  };
}

export function createAskUserQuestionTools(params: {
  conversationId: string;
  timeoutMs?: number;
}): BuiltinToolBundle {
  const tool: Tool = {
    name: ASK_USER_QUESTION_TOOL_NAME,
    description,
    parameters,
  };

  async function executeToolCall(
    toolCall: ToolCall,
    signal?: AbortSignal,
  ): Promise<ToolResultMessage> {
    if (toolCall.name !== ASK_USER_QUESTION_TOOL_NAME) {
      return errorResult(toolCall, `Unknown tool: ${toolCall.name}`);
    }
    if (signal?.aborted) return errorResult(toolCall, "Cancelled");
    if (pendingByToolCallId.has(toolCall.id)) {
      return errorResult(toolCall, "This question is already waiting for an answer.");
    }

    let questions: AskUserQuestionItem[];
    try {
      questions = parseAskUserQuestionItems(
        (toolCall.arguments as Record<string, unknown> | undefined)?.questions,
      );
    } catch (error) {
      return errorResult(
        toolCall,
        error instanceof Error ? error.message : "AskUserQuestion failed.",
      );
    }

    const preset = presetDeadlineByToolCallId.get(toolCall.id);
    presetDeadlineByToolCallId.delete(toolCall.id);
    const deadlineAt =
      params.timeoutMs === undefined && preset !== undefined
        ? preset
        : Date.now() + (params.timeoutMs ?? ASK_USER_QUESTION_TIMEOUT_MS);

    const settlement = await new Promise<Settlement>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: Settlement) => {
        if (settled) return;
        settled = true;
        pendingByToolCallId.delete(toolCall.id);
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onAbort = () => finish({ kind: "cancelled" });
      pendingByToolCallId.set(toolCall.id, {
        conversationId: params.conversationId,
        questions,
        deadlineAt,
        settle: finish,
      });
      timer = setTimeout(
        () =>
          finish({
            kind: "timeout",
            answers: buildDefaultAskUserQuestionAnswers(questions),
          }),
        Math.max(0, deadlineAt - Date.now()),
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });

    if (settlement.kind === "cancelled") {
      const details: AskUserQuestionResultDetails = {
        kind: "ask_user_question",
        questions,
        answers: [],
        cancelled: true,
      };
      return {
        ...errorResult(toolCall, "The turn stopped before the user answered."),
        details,
      };
    }

    const timedOut = settlement.kind === "timeout";
    const details: AskUserQuestionResultDetails = {
      kind: "ask_user_question",
      questions,
      answers: settlement.answers,
      ...(timedOut ? { timedOut: true } : {}),
    };
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [
        {
          type: "text",
          text: buildAskUserQuestionResultText(settlement.answers, { timedOut }),
        },
      ],
      details,
      isError: false,
      timestamp: Date.now(),
    };
  }

  return {
    groupId: "system",
    tools: [tool],
    executeToolCall,
    metadataByName: createBuiltinMetadataMap([
      [
        ASK_USER_QUESTION_TOOL_NAME,
        {
          groupId: "system",
          kind: "ask_user_question",
          isReadOnly: true,
          displayCategory: "system",
        },
      ],
    ]),
  };
}
