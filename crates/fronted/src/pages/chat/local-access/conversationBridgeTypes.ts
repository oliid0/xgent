import type { MentionComposerDraft } from "../../../components/chat/MentionComposer";
import type { HistoryMessageRef } from "../../../lib/chat/conversation/conversationState";
import type { PendingUploadedFile } from "../../../lib/chat/messages/uploadedFiles";
import type {
  ChatRuntimeControls,
  ExecutionMode,
  SystemToolId,
} from "../../../lib/settings";

export type SendChatAction = (overrides?: {
  textOverride?: string;
  composerDraftOverride?: MentionComposerDraft;
  uploadedFilesOverride?: PendingUploadedFile[];
  conversationIdOverride?: string;
  executionModeOverride?: ExecutionMode;
  workdirOverride?: string;
  selectedSystemToolIdsOverride?: SystemToolId[];
  runtimeControlsOverride?: ChatRuntimeControls;
  preserveComposerOnStart?: boolean;
  afterInitialHistoryPersist?: () => Promise<void>;
  // Edit-resend identifies the truncation-base user message so every local
  // access client can apply the same conversation rebase.
  editResendBaseMessageRef?: HistoryMessageRef;
}) => Promise<boolean>;
