import { ASK_USER_QUESTION_TIMEOUT_MS } from "../chat/askUserQuestion";

export const TOOL_APPROVAL_TIMEOUT_MS = ASK_USER_QUESTION_TIMEOUT_MS;

export type ToolApprovalDecision = "approve" | "deny" | "approve_session";

export type ToolApprovalSettlement =
  | { kind: "decided"; decision: ToolApprovalDecision }
  | { kind: "timeout" }
  | { kind: "cancelled" };

type PendingToolApproval = {
  conversationId: string;
  toolName: string;
  summary: string;
  deadlineAt: number;
  settle: (settlement: ToolApprovalSettlement) => void;
};

export type PendingToolApprovalSummary = {
  toolCallId: string;
  toolName: string;
  summary: string;
  deadlineAt: number;
};

const pendingByToolCallId = new Map<string, PendingToolApproval>();
const sessionAllowByConversation = new Map<string, Set<string>>();
const listeners = new Set<() => void>();
const listenersByConversation = new Map<string, Set<() => void>>();
const pendingSnapshotsByConversation = new Map<string, PendingToolApprovalSummary[]>();
const EMPTY_PENDING_APPROVALS: PendingToolApprovalSummary[] = Object.freeze(
  [],
) as PendingToolApprovalSummary[];
let version = 0;

function emitChange(conversationId: string) {
  const key = conversationId.trim();
  version += 1;
  for (const listener of listeners) listener();
  if (!key) return;
  pendingSnapshotsByConversation.delete(key);
  for (const listener of listenersByConversation.get(key) ?? []) listener();
}

export function subscribeToolApprovals(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToolApprovalVersion() {
  return version;
}

export function subscribeToolApprovalsForConversation(
  conversationId: string,
  listener: () => void,
) {
  const key = conversationId.trim();
  if (!key) return () => undefined;
  const conversationListeners = listenersByConversation.get(key) ?? new Set<() => void>();
  conversationListeners.add(listener);
  listenersByConversation.set(key, conversationListeners);
  return () => {
    conversationListeners.delete(listener);
    if (conversationListeners.size === 0) listenersByConversation.delete(key);
  };
}

export function listPendingToolApprovalsForConversation(
  conversationId: string,
): PendingToolApprovalSummary[] {
  const target = conversationId.trim();
  const out: PendingToolApprovalSummary[] = [];
  for (const [toolCallId, pending] of pendingByToolCallId) {
    if (pending.conversationId !== target) continue;
    out.push({
      toolCallId,
      toolName: pending.toolName,
      summary: pending.summary,
      deadlineAt: pending.deadlineAt,
    });
  }
  return out.sort((left, right) => left.deadlineAt - right.deadlineAt);
}

export function getPendingToolApprovalsSnapshot(
  conversationId: string,
): PendingToolApprovalSummary[] {
  const key = conversationId.trim();
  if (!key) return EMPTY_PENDING_APPROVALS;
  const cached = pendingSnapshotsByConversation.get(key);
  if (cached) return cached;
  const pending = listPendingToolApprovalsForConversation(key);
  if (pending.length === 0) return EMPTY_PENDING_APPROVALS;
  pendingSnapshotsByConversation.set(key, pending);
  return pending;
}

export function isSessionApproved(conversationId: string, toolName: string) {
  return sessionAllowByConversation.get(conversationId)?.has(toolName) ?? false;
}

function rememberSessionApproval(conversationId: string, toolName: string) {
  const existing = sessionAllowByConversation.get(conversationId);
  if (existing) {
    existing.add(toolName);
    return;
  }
  sessionAllowByConversation.set(conversationId, new Set([toolName]));
}

export function answerToolApproval(
  toolCallId: string,
  decision: ToolApprovalDecision,
  options?: { conversationId?: string },
): { ok: boolean; message?: string } {
  const pending = pendingByToolCallId.get(toolCallId.trim());
  if (!pending) return { ok: false, message: "This approval is no longer pending." };
  const expectedConversationId = options?.conversationId?.trim();
  if (expectedConversationId && expectedConversationId !== pending.conversationId) {
    return { ok: false, message: "This approval belongs to another conversation." };
  }
  pending.settle({ kind: "decided", decision });
  return { ok: true };
}

export function cancelPendingToolApprovalsForConversation(conversationId: string) {
  const target = conversationId.trim();
  for (const pending of pendingByToolCallId.values()) {
    if (pending.conversationId === target) pending.settle({ kind: "cancelled" });
  }
  sessionAllowByConversation.delete(target);
}

export function requestToolApproval(params: {
  toolCallId: string;
  toolName: string;
  summary?: string;
  conversationId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<ToolApprovalSettlement> {
  const toolCallId = params.toolCallId.trim();
  const timeoutMs = params.timeoutMs ?? TOOL_APPROVAL_TIMEOUT_MS;
  if (params.signal?.aborted) return Promise.resolve({ kind: "cancelled" });

  return new Promise<ToolApprovalSettlement>((resolve) => {
    let settled = false;
    const settle = (settlement: ToolApprovalSettlement) => {
      if (settled) return;
      settled = true;
      if (pendingByToolCallId.get(toolCallId) === pending) {
        pendingByToolCallId.delete(toolCallId);
      }
      params.signal?.removeEventListener("abort", onAbort);
      globalThis.clearTimeout(timeoutId);
      if (settlement.kind === "decided" && settlement.decision === "approve_session") {
        rememberSessionApproval(params.conversationId, params.toolName);
      }
      emitChange(params.conversationId);
      resolve(settlement);
    };
    const onAbort = () => settle({ kind: "cancelled" });
    const timeoutId = globalThis.setTimeout(
      () => settle({ kind: "timeout" }),
      Math.max(0, timeoutMs),
    );
    const pending: PendingToolApproval = {
      conversationId: params.conversationId.trim(),
      toolName: params.toolName,
      summary: params.summary?.trim() ?? "",
      deadlineAt: Date.now() + timeoutMs,
      settle,
    };
    pendingByToolCallId.set(toolCallId, pending);
    params.signal?.addEventListener("abort", onAbort, { once: true });
    emitChange(params.conversationId);
  });
}
