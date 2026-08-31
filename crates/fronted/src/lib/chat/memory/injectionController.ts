//

//

import {
  type MemoryInjectionBaseline,
  type MemoryTurnUpdateMap,
  planMemoryTurnInjection,
} from "../../memory/prompts/turnInjection";

const INJECTION_CONVERSATION_STATE_LIMIT = 32;

type ConversationInjectionState = {
  baseline: MemoryInjectionBaseline;

  updates: Map<string, string>;
  lastTouchedAt: number;
};

const states = new Map<string, ConversationInjectionState>();

function pruneStates() {
  if (states.size <= INJECTION_CONVERSATION_STATE_LIMIT) return;
  const sorted = [...states.entries()].sort((a, b) => a[1].lastTouchedAt - b[1].lastTouchedAt);
  for (const [key] of sorted.slice(0, states.size - INJECTION_CONVERSATION_STATE_LIMIT)) {
    states.delete(key);
  }
}

export type MemoryTurnInjectionResult = {
  systemText: string;

  turnUpdate: string;
};

export const memoryTurnInjection = {
  planTurn(params: {
    conversationId: string;
    messageId?: string;
    overview: string | null;
    workdir?: string;
  }): MemoryTurnInjectionResult {
    const key = params.conversationId.trim();
    if (!key) {
      return { systemText: params.overview ?? "", turnUpdate: "" };
    }

    const existing = states.get(key);
    const plan = planMemoryTurnInjection({
      baseline: existing?.baseline ?? null,
      overview: params.overview,
      workdir: params.workdir,
    });
    if (!plan.baseline) {
      return { systemText: plan.systemText, turnUpdate: "" };
    }

    const messageId = params.messageId?.trim() ?? "";
    if (plan.turnUpdate && !messageId) {
      return { systemText: plan.systemText, turnUpdate: "" };
    }

    const state = existing ?? {
      baseline: plan.baseline,
      updates: new Map<string, string>(),
      lastTouchedAt: 0,
    };
    state.baseline = plan.baseline;
    state.lastTouchedAt = Date.now();
    if (plan.refrozen) {
      state.updates.clear();
    }
    if (plan.turnUpdate) {
      state.updates.set(messageId, plan.turnUpdate);
    }
    if (!existing) {
      states.set(key, state);
      pruneStates();
    }

    return { systemText: plan.systemText, turnUpdate: plan.turnUpdate };
  },

  getMessageUpdates(conversationId: string): MemoryTurnUpdateMap | undefined {
    return states.get(conversationId.trim())?.updates;
  },

  getSystemText(conversationId: string): string | undefined {
    return states.get(conversationId.trim())?.baseline.systemText;
  },

  invalidate(conversationId: string) {
    states.delete(conversationId.trim());
  },

  dispose(conversationId: string) {
    states.delete(conversationId.trim());
  },

  disposeAll() {
    states.clear();
  },
};
