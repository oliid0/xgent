import type { MentionComposerDraft } from "../../../components/chat/MentionComposer";

export type ConversationDraftStore = Pick<
  Map<string, MentionComposerDraft>,
  "get" | "set" | "delete" | "has" | "clear"
>;

export function createConversationDraftStore(): ConversationDraftStore {
  return new Map<string, MentionComposerDraft>();
}
