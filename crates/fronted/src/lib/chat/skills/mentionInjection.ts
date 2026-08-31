//

//

//

const SKILL_MENTION_CONVERSATION_STATE_LIMIT = 32;

export type SkillMentionUpdateMap = ReadonlyMap<string, string>;

type ConversationSkillMentionState = {
  updates: Map<string, string>;
  lastTouchedAt: number;
};

const states = new Map<string, ConversationSkillMentionState>();

function pruneStates() {
  if (states.size <= SKILL_MENTION_CONVERSATION_STATE_LIMIT) return;
  const sorted = [...states.entries()].sort((a, b) => a[1].lastTouchedAt - b[1].lastTouchedAt);
  for (const [key] of sorted.slice(0, states.size - SKILL_MENTION_CONVERSATION_STATE_LIMIT)) {
    states.delete(key);
  }
}

export const skillMentionInjection = {
  record(params: { conversationId: string; messageId?: string; block: string }) {
    const block = params.block;
    if (!block) return;

    const key = params.conversationId.trim();
    const messageId = params.messageId?.trim() ?? "";

    if (!key || !messageId) return;

    const existing = states.get(key);
    const state = existing ?? { updates: new Map<string, string>(), lastTouchedAt: 0 };
    state.updates.set(messageId, block);
    state.lastTouchedAt = Date.now();
    if (!existing) {
      states.set(key, state);
      pruneStates();
    }
  },

  getMessageUpdates(conversationId: string): SkillMentionUpdateMap | undefined {
    return states.get(conversationId.trim())?.updates;
  },

  dispose(conversationId: string) {
    states.delete(conversationId.trim());
  },

  disposeAll() {
    states.clear();
  },
};
