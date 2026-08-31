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

export function getAskUserQuestionDeadlineAt(toolCallId: string): number | null {
  const id = toolCallId.trim();
  return pendingByToolCallId.get(id)?.deadlineAt ?? presetDeadlineByToolCallId.get(id) ?? null;
}

export function answerAskUserQuestion(
  toolCallId: string,
  rawAnswers: unknown,
  options?: { conversationId?: string },
): { ok: boolean; message?: string } {
  const pending = pendingByToolCallId.get(toolCallId.trim());
  if (!pending) {
    return { ok: false, message: "Question is not pending (already answered or cancelled)." };
  }
  const expectedConversationId = options?.conversationId?.trim();
  if (expectedConversationId && pending.conversationId !== expectedConversationId) {
    return { ok: false, message: "Question belongs to a different conversation." };
  }
  const answers = resolveAskUserQuestionAnswers(pending.questions, rawAnswers);
  if (!answers) {
    return {
      ok: false,
      message: "Every question needs a listed option selected or a non-empty custom answer.",
    };
  }
  pending.settle({ kind: "answered", answers });
  return { ok: true };
}

export function hasPendingAskUserQuestion(toolCallId: string) {
  return pendingByToolCallId.has(toolCallId.trim());
}

export function cancelPendingAskUserQuestionsForConversation(conversationId: string) {
  for (const pending of pendingByToolCallId.values()) {
    if (pending.conversationId === conversationId) pending.settle({ kind: "cancelled" });
  }
}

const ASK_USER_QUESTION_TIMEOUT_MINUTES = Math.round(ASK_USER_QUESTION_TIMEOUT_MS / 60_000);

const description = `Ask the user up to ${ASK_USER_QUESTION_MAX_QUESTIONS} multiple-choice questions and wait for their selections. Use this whenever you need a decision only the user can make: ambiguous requirements, mutually exclusive approaches, or trade-offs you cannot resolve from the conversation and the workspace.

The questions render as an interactive card; execution pauses until the user answers every question, then the selections come back as the tool result. If the user does not answer within ${ASK_USER_QUESTION_TIMEOUT_MINUTES} minutes, the recommended (or first) option of every question is auto-selected and execution continues — the result text tells you which happened.

Rules:
- Ask 1-${ASK_USER_QUESTION_MAX_QUESTIONS} focused questions per call; each question needs ${ASK_USER_QUESTION_MIN_OPTIONS}-${ASK_USER_QUESTION_MAX_OPTIONS} options (3-4 is ideal); different questions may have different option counts.
- Options must be short, concrete, and mutually exclusive. Set recommended=true on your suggested choice (at most one per question) — it is shown first and becomes the timeout fallback.
- The UI automatically appends an "Other" free-text option to every question, so the user can always type their own answer. Do NOT add your own catch-all option (e.g. "Other", "Custom", "其他", "自定义"). When the user types an answer, the result marks it as user-typed and returns their exact words instead of a listed label — treat it as authoritative.
- Give each question a short header (2-6 chars works best) — it becomes the tab label when several questions show at once.
- Do not use this for questions answerable from the code or the conversation, and never ask for confirmation of work you can safely do.`;

const parameters = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.Optional(
        Type.String({ description: "Stable question id (defaults to q1..qN by position)." }),
      ),
      header: Type.Optional(
        Type.String({ description: "Short tab label shown when multiple questions render." }),
      ),
      prompt: Type.String({ description: "The question shown to the user." }),
      options: Type.Array(
        Type.Object({
          label: Type.String({ description: "Concise option label the user picks." }),
          description: Type.Optional(
            Type.String({ description: "One-line explanation of the trade-off." }),
          ),
          recommended: Type.Optional(
            Type.Boolean({
              description:
                "Mark exactly one option per question as your recommendation; it is shown first and auto-selected on timeout.",
            }),
          ),
        }),
        {
          description: `${ASK_USER_QUESTION_MIN_OPTIONS}-${ASK_USER_QUESTION_MAX_OPTIONS} mutually exclusive options (3-4 is ideal).`,
        },
      ),
    }),
    { description: `1-${ASK_USER_QUESTION_MAX_QUESTIONS} questions to ask in this card.` },
  ),
});

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
        ...errorResult(
          toolCall,
          "The user stopped the turn without answering. Do not assume any selection.",
        ),
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
