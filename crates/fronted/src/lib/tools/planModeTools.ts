//

import type { Message, Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { ASK_USER_QUESTION_TOOL_NAME } from "../chat/askUserQuestion";
import {
  EXIT_PLAN_MODE_TOOL_NAME,
  type ExitPlanModeResultDetails,
  resolvePlanDecisionAnswer,
  sanitizePlanMarkdown,
} from "../chat/planMode";
import type { ToolChoice } from "../providers/runtime/types";
import { AGENT_TOOL_NAME, SEND_MESSAGE_TOOL_NAME } from "../subagents/types";
import {
  type BuiltinToolBundle,
  type BuiltinToolMetadata,
  createBuiltinMetadataMap,
} from "./builtinTypes";

type PendingPlan = {
  conversationId: string;
  toolCallId: string;
  plan: string;
};

const pendingPlanByConversation = new Map<string, PendingPlan>();

const approvedToolCallIds = new Set<string>();
const approvedToolCallIdsByConversation = new Map<string, Set<string>>();

const listeners = new Set<() => void>();
let version = 0;
function emitChange() {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribePlanDecisions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPlanDecisionVersion(): number {
  return version;
}

export function isPlanDecisionPending(toolCallId: string): boolean {
  const trimmed = toolCallId.trim();
  for (const pending of pendingPlanByConversation.values()) {
    if (pending.toolCallId === trimmed) return true;
  }
  return false;
}

export function isPlanApprovalToolCall(toolCallId: string): boolean {
  return approvedToolCallIds.has(toolCallId.trim());
}

export function getPendingPlanForConversation(
  conversationId: string,
): { toolCallId: string; plan: string } | null {
  const pending = pendingPlanByConversation.get(conversationId.trim());
  return pending ? { toolCallId: pending.toolCallId, plan: pending.plan } : null;
}

const PLAN_APPROVAL_PHRASES = new Set([
  "同意",
  "批准",
  "可以",
  "好",
  "好的",
  "行",
  "开始",
  "开始吧",
  "开始执行",
  "执行",
  "执行吧",
  "开干",
  "干吧",
  "去吧",
  "没问题",
  "ok",
  "okay",
  "yes",
  "yep",
  "y",
  "go",
  "go ahead",
  "do it",
  "proceed",
  "approve",
  "approved",
  "lgtm",
]);

export function isPlanApprovalMessage(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[\s。．.,，!！~～…]+$/u, "");
  return normalized.length > 0 && PLAN_APPROVAL_PHRASES.has(normalized);
}

export type PlanDecisionHandlers = {
  onApprove: (input: { conversationId: string; plan: string }) => void;
  onReject: (input: { conversationId: string; feedback: string }) => void;
};

let decisionHandlers: PlanDecisionHandlers | null = null;

export function registerPlanDecisionHandlers(next: PlanDecisionHandlers | null) {
  decisionHandlers = next;
}

export type AnswerPlanDecisionOutcome = {
  ok: boolean;
  message?: string;
  code?: "not_pending" | "invalid" | "unavailable";
};

export function answerPlanDecision(
  toolCallId: string,
  rawAnswer: unknown,
  options?: { conversationId?: string },
): AnswerPlanDecisionOutcome {
  const trimmed = toolCallId.trim();
  let pending: PendingPlan | null = null;
  for (const candidate of pendingPlanByConversation.values()) {
    if (candidate.toolCallId === trimmed) {
      pending = candidate;
      break;
    }
  }
  if (!pending) {
    return {
      ok: false,
      code: "not_pending",
      message: "Plan is not pending (already decided or superseded).",
    };
  }
  const expectedConversationId = options?.conversationId?.trim();
  if (expectedConversationId && expectedConversationId !== pending.conversationId) {
    return { ok: false, code: "invalid", message: "Plan belongs to a different conversation." };
  }
  const answer = resolvePlanDecisionAnswer(rawAnswer);
  if (!answer) {
    return { ok: false, code: "invalid", message: 'Decision must be "approve" or "reject".' };
  }
  if (!decisionHandlers) {
    return { ok: false, code: "unavailable", message: "Plan decision handlers are not ready." };
  }
  if (answer.decision === "approve") {
    pendingPlanByConversation.delete(pending.conversationId);
    approvedToolCallIds.add(pending.toolCallId);
    let conversationApproved = approvedToolCallIdsByConversation.get(pending.conversationId);
    if (!conversationApproved) {
      conversationApproved = new Set();
      approvedToolCallIdsByConversation.set(pending.conversationId, conversationApproved);
    }
    conversationApproved.add(pending.toolCallId);
    emitChange();
    try {
      decisionHandlers.onApprove({ conversationId: pending.conversationId, plan: pending.plan });
    } catch (error) {
      console.warn("plan approve handler failed", error);
    }
    return { ok: true };
  }
  const feedback = answer.feedback?.trim() ?? "";
  if (!feedback) {
    return {
      ok: false,
      message: "Rejection needs feedback — just type your changes as a message.",
    };
  }

  pendingPlanByConversation.delete(pending.conversationId);
  emitChange();
  try {
    decisionHandlers.onReject({ conversationId: pending.conversationId, feedback });
  } catch (error) {
    console.warn("plan reject handler failed", error);
  }
  return { ok: true };
}

export function cancelPendingPlanDecisionsForConversation(conversationId: string) {
  const target = conversationId.trim();
  const pending = pendingPlanByConversation.get(target);
  const approved = approvedToolCallIdsByConversation.get(target);
  if (!pending && !approved) return;
  if (pending) {
    pendingPlanByConversation.delete(target);
    approvedToolCallIds.delete(pending.toolCallId);
  }
  if (approved) {
    approvedToolCallIdsByConversation.delete(target);
    for (const toolCallId of approved) {
      approvedToolCallIds.delete(toolCallId);
    }
  }
  emitChange();
}

export function isPlanModeAllowedTool(
  toolName: string,
  metadata: BuiltinToolMetadata | undefined,
): boolean {
  if (metadata?.isReadOnly) return true;
  return (
    toolName === EXIT_PLAN_MODE_TOOL_NAME ||
    toolName === AGENT_TOOL_NAME ||
    toolName === SEND_MESSAGE_TOOL_NAME
  );
}

export function buildPlanModeSystemPromptSection(): string {
  return [
    "<plan-mode>",
    "Plan mode is ACTIVE. This is a read-only planning phase:",
    "- Research with the available read-only tools (and readonly subagents). Stop researching once you can produce the deliverable — do not re-read files you have already read; a re-read returns an unchanged stub, never new information.",

    `- When a planning detail is genuinely the user's call — scope boundaries, mutually exclusive approaches, trade-offs, target behavior — proactively ask with ${ASK_USER_QUESTION_TOOL_NAME} during research instead of guessing or leaving open questions in the plan. Execution pauses for the answers and continues this turn. Resolve what the code itself can answer; batch the remaining decisions into one focused call.`,
    "- Mutation is impossible this turn: write-capable tools are not in your tool list. Do not promise edits you cannot make here.",
    `- Submit every complete answer through ${EXIT_PLAN_MODE_TOOL_NAME} — implementation plans, architecture summaries, research findings, Q&A, and recommendations alike — instead of plain assistant text. If no code changes are needed, the plan states that and carries the findings.`,
    "- Submitting ends this turn immediately; the user replies with approval or feedback as a normal message. On feedback, revise the plan and submit again.",
    "- If the user asks to save the plan to a file, make that write the first step of the plan itself — the execution turn (full tools) will do it.",
    "- On approval, execution starts automatically in the next turn with full tools — begin that turn by turning the plan into a task list (TaskCreate), then implement. If the plan needs no file changes, confirm that briefly and stop.",
    "- Keep implementation plans concrete: files to touch, ordered steps, risks, and how to verify.",
    "</plan-mode>",
  ].join("\n");
}

const EXIT_PLAN_MODE_TOOL_DESCRIPTION = `Present the complete user-facing deliverable for this turn (every finished answer, not only implementation plans). Only available in plan mode; call it once your research is complete.

Submitting ends this turn immediately. The user replies as a normal message: approval starts execution automatically in the next turn (full tools); anything else is feedback — revise the plan and submit again.

Rules:
- \`plan\` must be the complete, self-contained markdown deliverable. Do not reference earlier messages ("as discussed above").
- Implementation work: goals, files to change, ordered steps, risks, verification. Analysis/Q&A: the full findings, plus whether any follow-up code changes are needed.
- If the user asked to save the plan to a file, include that write as the first step of the plan.`;

const exitPlanModeParameters = Type.Object({
  plan: Type.String({
    description:
      "The complete user-facing deliverable in markdown. Implementation work: goals, files to change, ordered steps, risks, verification. Analysis/Q&A: the full findings, plus whether any follow-up code changes are needed.",
  }),
});

function buildErrorResult(toolCall: ToolCall, text: string): ToolResultMessage {
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

export function createExitPlanModeTools(params: { conversationId: string }): BuiltinToolBundle {
  const toolExitPlanMode: Tool = {
    name: EXIT_PLAN_MODE_TOOL_NAME,
    description: EXIT_PLAN_MODE_TOOL_DESCRIPTION,
    parameters: exitPlanModeParameters,
  };

  async function executeToolCall(toolCall: ToolCall): Promise<ToolResultMessage> {
    if (toolCall.name !== EXIT_PLAN_MODE_TOOL_NAME) {
      return buildErrorResult(toolCall, `Unknown tool: ${toolCall.name}`);
    }
    const plan = sanitizePlanMarkdown(toolCall.arguments?.plan);
    if (!plan) {
      return buildErrorResult(
        toolCall,
        "plan is required: pass the complete markdown deliverable.",
      );
    }

    pendingPlanByConversation.set(params.conversationId, {
      conversationId: params.conversationId,
      toolCallId: toolCall.id,
      plan,
    });
    emitChange();

    const details: ExitPlanModeResultDetails = {
      kind: "exit_plan_mode",
      plan,
    };
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [
        {
          type: "text",
          text: "Plan submitted; this turn ends here. The user will reply with approval or feedback.",
        },
      ],
      details,
      isError: false,
      timestamp: Date.now(),
    };
  }

  return {
    groupId: "system",
    tools: [toolExitPlanMode],
    executeToolCall,
    metadataByName: createBuiltinMetadataMap([
      [
        EXIT_PLAN_MODE_TOOL_NAME,
        {
          groupId: "system",
          kind: "exit_plan_mode",

          isReadOnly: true,
          displayCategory: "system",
        },
      ],
    ]),
  };
}

// ---------------------------------------------------------------------------

//

// ---------------------------------------------------------------------------

export const PLAN_MODE_MAX_RESEARCH_ROUNDS = 32;

export const PLAN_MODE_MAX_NUDGE_ROUNDS = 4;

export const PLAN_MODE_REPEAT_CALL_LIMIT = 2;

export const PLAN_MODE_NUDGE_REMINDER = [
  "[plan-mode reminder] Your previous turn ended without submitting the deliverable.",
  `Call ${EXIT_PLAN_MODE_TOOL_NAME} now with the complete user-facing deliverable in markdown,`,
  "based on the research you already completed. Do not run more research tools first.",
].join(" ");

export type PlanModeRunDecision =
  | { kind: "submitted" }
  | { kind: "nudge"; reminderText: string }
  | { kind: "fallback" };

export type PlanModeFallbackPlan = {
  toolCall: ToolCall;
  toolResult: ToolResultMessage;
};

export type PlanModeRunPolicy = {
  resolveToolTermination: (toolCall: ToolCall) => boolean;

  resolveToolChoice: () => ToolChoice | undefined;

  maxRounds: () => number;

  guardRepeatedToolCall: (toolCall: ToolCall) => { allow: true } | { allow: false; reason: string };

  decideAfterRun: (input: { emittedMessages: readonly Message[] }) => PlanModeRunDecision;
  registerFallbackPlan: (input: { planText: string }) => PlanModeFallbackPlan | null;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hasSuccessfulPlanSubmission(messages: readonly Message[]): boolean {
  return messages.some(
    (message) =>
      message.role === "toolResult" &&
      message.toolName === EXIT_PLAN_MODE_TOOL_NAME &&
      !message.isError,
  );
}

export function createPlanModeRunPolicy(params: { conversationId: string }): PlanModeRunPolicy {
  let phase: "researching" | "nudging" = "researching";
  const repeatCounts = new Map<string, number>();

  return {
    resolveToolTermination: (toolCall) => toolCall.name === EXIT_PLAN_MODE_TOOL_NAME,

    resolveToolChoice: () =>
      phase === "nudging" ? { type: "tool" as const, name: EXIT_PLAN_MODE_TOOL_NAME } : undefined,

    maxRounds: () =>
      phase === "nudging" ? PLAN_MODE_MAX_NUDGE_ROUNDS : PLAN_MODE_MAX_RESEARCH_ROUNDS,

    guardRepeatedToolCall: (toolCall) => {
      if (toolCall.name === EXIT_PLAN_MODE_TOOL_NAME) return { allow: true };
      const key = `${toolCall.name}\u0000${stableStringify(toolCall.arguments ?? {})}`;
      const count = (repeatCounts.get(key) ?? 0) + 1;
      repeatCounts.set(key, count);
      if (count <= PLAN_MODE_REPEAT_CALL_LIMIT) return { allow: true };
      return {
        allow: false,
        reason:
          `You already made this exact ${toolCall.name} call in this planning turn and its result has not changed. ` +
          `Use the content you already gathered, or submit the deliverable via ${EXIT_PLAN_MODE_TOOL_NAME}.`,
      };
    },

    decideAfterRun: ({ emittedMessages }) => {
      if (hasSuccessfulPlanSubmission(emittedMessages)) {
        return { kind: "submitted" };
      }
      if (phase === "researching") {
        phase = "nudging";
        return { kind: "nudge", reminderText: PLAN_MODE_NUDGE_REMINDER };
      }
      return { kind: "fallback" };
    },

    registerFallbackPlan: ({ planText }) => {
      const plan = sanitizePlanMarkdown(planText);
      if (!plan) return null;
      const toolCallId = `call_plan_fallback_${crypto.randomUUID().replaceAll("-", "")}`;
      const toolCall: ToolCall = {
        type: "toolCall",
        id: toolCallId,
        name: EXIT_PLAN_MODE_TOOL_NAME,
        arguments: { plan },
      };

      pendingPlanByConversation.set(params.conversationId, {
        conversationId: params.conversationId,
        toolCallId,
        plan,
      });
      emitChange();
      const details: ExitPlanModeResultDetails = { kind: "exit_plan_mode", plan };
      return {
        toolCall,
        toolResult: {
          role: "toolResult",
          toolCallId,
          toolName: EXIT_PLAN_MODE_TOOL_NAME,
          content: [
            {
              type: "text",
              text: "Plan captured from the assistant's final text; the user will reply with approval or feedback.",
            },
          ],
          details,
          isError: false,
          timestamp: Date.now(),
        },
      };
    },
  };
}
