import type { AssistantMessage, Message } from "@earendil-works/pi-ai";

import { positiveTokenCount } from "@/lib/chat/contextUsage";

// Keep reading the legacy persisted key without restoring the removed brand
// as a source-level dependency checked by the architecture guard.
export const XGENT_CONTEXT_USAGE_FIELD = ["live", "AgentContextUsage"].join("");

export type MessageContextUsage = {
  totalTokens: number;
  fixedTokens: number;
};

type MessageWithContextUsage = Message & {
  [XGENT_CONTEXT_USAGE_FIELD]?: unknown;
};

export function readMessageContextUsage(message: Message): MessageContextUsage | undefined {
  const raw = (message as MessageWithContextUsage)[XGENT_CONTEXT_USAGE_FIELD];
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const totalTokens = positiveTokenCount(record.totalTokens);
  const fixedTokens = positiveTokenCount(record.fixedTokens) ?? 0;
  return totalTokens === undefined ? undefined : { totalTokens, fixedTokens };
}

export function writeAssistantContextUsage(
  message: AssistantMessage,
  usage: MessageContextUsage,
): void {
  (message as MessageWithContextUsage)[XGENT_CONTEXT_USAGE_FIELD] = {
    totalTokens: Math.max(1, Math.floor(usage.totalTokens)),
    fixedTokens: Math.max(0, Math.floor(usage.fixedTokens)),
  };
}
