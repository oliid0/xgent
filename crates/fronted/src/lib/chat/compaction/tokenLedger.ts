import type { Context, Message, Usage } from "@earendil-works/pi-ai";

import {
  estimateContentBlockTokenUnits,
  estimateContentTokenUnits,
  estimateTextTokens,
  estimateTextTokenUnits,
  MESSAGE_ENVELOPE_TOKENS,
  stringifiedTokenUnits,
} from "@/lib/chat/contextUsage";
import { isCompactionAssistantMessage } from "../conversation/conversationState";
import { readMessageContextUsage, writeAssistantContextUsage } from "./contextUsageMetadata";

export { estimateTextTokens, estimateTextTokenUnits };

const messageTokenCache = new WeakMap<object, number>();
const toolsTokenCache = new WeakMap<object, number>();

function estimateMessageTokenUnits(message: Message): number {
  if (message.role === "assistant") {
    let units = 0;
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "toolCall") {
        units += estimateTextTokenUnits(block.name) + stringifiedTokenUnits(block.arguments);
        continue;
      }
      units += estimateContentBlockTokenUnits(block);
    }
    return units;
  }

  if (message.role === "toolResult") {
    return estimateContentTokenUnits(message.content);
  }

  return estimateContentTokenUnits((message as { content?: unknown }).content);
}

export function estimateMessageTokens(message: Message): number {
  const cached = messageTokenCache.get(message);
  if (cached !== undefined) return cached;
  const tokens = Math.ceil(estimateMessageTokenUnits(message)) + MESSAGE_ENVELOPE_TOKENS;
  messageTokenCache.set(message, tokens);
  return tokens;
}

export function estimateToolsTokens(tools: Context["tools"]): number {
  if (!tools || tools.length === 0) return 0;
  const cached = toolsTokenCache.get(tools);
  if (cached !== undefined) return cached;
  const tokens = estimateTextTokens(JSON.stringify(tools));
  toolsTokenCache.set(tools, tokens);
  return tokens;
}

export function deriveContextTokens(context: Context, options?: { fixedTokens?: number }): number {
  const ledger = new TokenLedger();
  ledger.rebase(context, options);
  return ledger.total();
}

export function getUsageTotalTokens(usage: Usage | undefined): number | undefined {
  if (!usage) return undefined;

  const totalTokens = usage.totalTokens;
  if (typeof totalTokens === "number" && Number.isFinite(totalTokens) && totalTokens > 0) {
    return Math.max(0, Math.floor(totalTokens));
  }

  const parts = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite];
  const derivedTotal = parts.reduce<number>((sum, value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return sum;
    return sum + value;
  }, 0);
  return derivedTotal > 0 ? Math.floor(derivedTotal) : undefined;
}

export function getMessageObservedTokens(message: Message): number | undefined {
  if (message.role !== "assistant") return undefined;

  const isCheckpoint: boolean = isCompactionAssistantMessage(message);
  if (isCheckpoint) return undefined;
  return readMessageContextUsage(message)?.totalTokens ?? getUsageTotalTokens(message.usage);
}

export type TokenLedgerSnapshot = {
  fixedTokens: number;
  observedTokens: number;
  trailingTokens: number;

  estimatedTotalTokens: number;
  hasObservedUsage: boolean;
  hasFixedTokenAnchor: boolean;
  totalTokens: number;
};

export class TokenLedger {
  private fixedTokens = 0;
  private observedTokens = 0;
  private trailingTokens = 0;
  private estimatedTotalTokens = 0;
  private hasObservedUsage = false;
  private hasFixedTokenAnchor = false;

  rebase(context: Context, options?: { fixedTokens?: number }): void {
    const estimatedFixedTokens =
      estimateTextTokens(context.systemPrompt ?? "") + estimateToolsTokens(context.tools);
    this.fixedTokens =
      typeof options?.fixedTokens === "number" &&
      Number.isFinite(options.fixedTokens) &&
      options.fixedTokens >= 0
        ? Math.floor(options.fixedTokens)
        : estimatedFixedTokens;
    this.observedTokens = 0;
    this.trailingTokens = 0;
    this.estimatedTotalTokens = this.fixedTokens;
    this.hasObservedUsage = false;
    this.hasFixedTokenAnchor = false;

    const messages = context.messages;
    let anchorIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const observed = getMessageObservedTokens(message);
      if (typeof observed === "number") {
        const anchored = readMessageContextUsage(message);
        this.observedTokens = anchored
          ? Math.max(0, observed + this.fixedTokens - anchored.fixedTokens)
          : observed;
        this.hasObservedUsage = true;
        this.hasFixedTokenAnchor = anchored !== undefined;
        anchorIndex = index;
        break;
      }
    }

    if (anchorIndex < 0) {
      for (const message of messages) {
        this.estimatedTotalTokens += estimateMessageTokens(message);
      }
    }
    for (let index = anchorIndex + 1; index < messages.length; index += 1) {
      this.trailingTokens += estimateMessageTokens(messages[index]);
    }
  }

  addMessages(messages: readonly Message[]): void {
    for (const message of messages) {
      if (!this.hasObservedUsage) {
        this.estimatedTotalTokens += estimateMessageTokens(message);
      }
      const observed = getMessageObservedTokens(message);
      if (typeof observed === "number") {
        if (
          message.role === "assistant" &&
          !isCompactionAssistantMessage(message) &&
          readMessageContextUsage(message) === undefined
        ) {
          writeAssistantContextUsage(message, {
            totalTokens: observed,
            fixedTokens: this.fixedTokens,
          });
        }

        this.observedTokens = observed;
        this.hasObservedUsage = true;
        this.hasFixedTokenAnchor = readMessageContextUsage(message) !== undefined;
        this.trailingTokens = 0;
        continue;
      }
      this.trailingTokens += estimateMessageTokens(message);
    }
  }

  total(): number {
    if (!this.hasObservedUsage) return this.estimatedTotalTokens;
    return this.observedTokens + this.trailingTokens;
  }

  totalWithPendingTokens(pendingTokenUnits: number): number {
    if (!Number.isFinite(pendingTokenUnits) || pendingTokenUnits <= 0) return this.total();
    return this.total() + Math.ceil(pendingTokenUnits);
  }

  snapshot(): TokenLedgerSnapshot {
    return {
      fixedTokens: this.fixedTokens,
      observedTokens: this.observedTokens,
      trailingTokens: this.trailingTokens,
      estimatedTotalTokens: this.estimatedTotalTokens,
      hasObservedUsage: this.hasObservedUsage,
      hasFixedTokenAnchor: this.hasFixedTokenAnchor,
      totalTokens: this.total(),
    };
  }
}
