import { ChatMessage, ChatMessageBubble } from "@astryxdesign/core/Chat";
import { VStack } from "@astryxdesign/core/Layout";
import { memo } from "react";
import type { ChatFileLink } from "../../../lib/chat/chatFileLinks";
import type { HistoryMessageRef } from "../../../lib/chat/conversation/conversationState";
import type { PendingUploadedFile } from "../../../lib/chat/messages/uploadedFiles";
import {
  type CommitDetailsLoader,
  UserMessageContent,
} from "../../../lib/chat/messages/userMessageContent";
import { EditableUserMessageBubble } from "./EditableUserMessageBubble";
import { UserRowFooter } from "./RowActions";
import type { UserRow } from "./rowModel";
import { splitUserAttachmentsForDisplay } from "./transcriptUtils";
import { UserAttachmentCards } from "./UserAttachmentCards";

export type UserMessageRowProps = {
  row: UserRow;
  isEditing: boolean;
  // True only in the row's birth window — never on virtualizer re-entry.
  animateEntrance: boolean;
  workspaceRoot?: string;
  loadCommitDetails: CommitDetailsLoader;
  onStartEdit: (key: string) => void;
  onCancelEdit: () => void;
  onOpenFileLink?: (link: ChatFileLink) => void;
  onResendFromEdit: (
    messageRef: HistoryMessageRef,
    text: string,
    attachments: PendingUploadedFile[],
  ) => void;
};

export const UserMessageRow = memo(function UserMessageRow(props: UserMessageRowProps) {
  const {
    row,
    isEditing,
    animateEntrance,
    workspaceRoot,
    loadCommitDetails,
    onStartEdit,
    onCancelEdit,
    onOpenFileLink,
    onResendFromEdit,
  } = props;
  const item = row.item;

  const effectiveMessageRef = item.messageRef;
  const compactedClass = item.isFromCompactedSegment ? "opacity-70" : "";
  const { visibleFiles, pastedTextFiles } = splitUserAttachmentsForDisplay(
    item.attachments,
    item.text,
  );

  if (isEditing && effectiveMessageRef) {
    return (
      <EditableUserMessageBubble
        initialText={item.text}
        attachments={item.attachments}
        workspaceRoot={workspaceRoot}
        compactedClass={compactedClass}
        onCancel={onCancelEdit}
        onSubmit={(newText, nextAttachments) => {
          onCancelEdit();
          onResendFromEdit(effectiveMessageRef, newText, nextAttachments);
        }}
      />
    );
  }

  return (
    <ChatMessage
      sender="user"
      density="compact"
      className={`chat-user-bubble-wrap group relative ml-auto w-full ${compactedClass}`}
    >
      <VStack width="100%" gap={1} hAlign="end">
        <UserAttachmentCards
          files={visibleFiles}
          workspaceRoot={workspaceRoot}
          onOpen={(file) => {
            const absolutePath = file.absolutePath?.trim();
            onOpenFileLink?.({
              path: absolutePath || file.relativePath,
              source: absolutePath ? "absolute" : "relative",
            });
          }}
        />
        {item.text ? (
          <ChatMessageBubble
            className={`${animateEntrance ? "chat-bubble-enter " : ""}chat-user-bubble max-w-[min(70%,40rem)] font-openai-chat`}
          >
            <UserMessageContent
              text={item.text}
              pastedTextFiles={pastedTextFiles}
              loadCommitDetails={loadCommitDetails}
            />
          </ChatMessageBubble>
        ) : null}
      </VStack>
      <UserRowFooter
        itemKey={item.key}
        text={item.text}
        timestamp={item.timestamp}
        hasStableRef={!!effectiveMessageRef}
        messageId={effectiveMessageRef?.messageId}
        onStartEdit={onStartEdit}
      />
    </ChatMessage>
  );
});
