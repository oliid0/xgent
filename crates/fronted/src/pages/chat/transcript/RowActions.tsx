import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack } from "@astryxdesign/core/Stack";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { useState } from "react";

import { Check, Copy, GitBranch, Pencil, RefreshCw, Undo2 } from "../../../components/icons";
import { ConfirmActionPopover } from "../../../components/ui/confirm-action-popover";
import { useLocale } from "../../../i18n";
import { useCheckpointRewind } from "../../../lib/chat/checkpointRewind";
import type {
  HistoryMessageRef,
  RenderUserMessage,
} from "../../../lib/chat/conversation/conversationState";
import type { PendingUploadedFile } from "../../../lib/chat/messages/uploadedFiles";
import { useRowInteraction } from "./rowInteraction";
import { useCopiedFlag } from "./useCopiedFlag";

export type AssistantRowFooterProps = {
  timestamp?: number;
  replyText: string;
  retryTarget: RenderUserMessage | null;
  onResendFromEdit: (
    messageRef: HistoryMessageRef,
    text: string,
    attachments: PendingUploadedFile[],
  ) => void;
  onBranchConversation?: (messageRef: HistoryMessageRef) => void;
};

function MessageTimestamp({ value }: { value?: number }) {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  return <Timestamp value={new Date(value).toISOString()} format="auto" size="3xs" />;
}

export function AssistantRowFooter(props: AssistantRowFooterProps) {
  const { timestamp, replyText, retryTarget, onResendFromEdit, onBranchConversation } = props;
  const { t } = useLocale();
  const { copied, markCopied } = useCopiedFlag();
  const { isSending, branchPendingMessageId } = useRowInteraction();
  const retryMessageRef = retryTarget?.messageRef;
  const retryDisabled = isSending || !retryMessageRef;
  const retryTitle = retryMessageRef ? t("chat.retry") : "旧历史缺少稳定消息标识，无法重试";
  const branchPending = branchPendingMessageId != null;
  const isRowBranchPending =
    branchPending &&
    Boolean(retryMessageRef) &&
    branchPendingMessageId === retryMessageRef?.messageId;

  return (
    <HStack gap={1.5} vAlign="center" className="mt-1 pl-10">
      <MessageTimestamp value={timestamp} />
      <HStack
        gap={0.5}
        className={`transition-opacity group-focus-within/assistant:opacity-100 group-hover/assistant:opacity-100 ${
          isRowBranchPending ? "opacity-100" : "opacity-0"
        }`}
      >
        <IconButton
          label={t("chat.copy")}
          tooltip={t("chat.copy")}
          icon={copied ? <Check size={16} /> : <Copy size={16} />}
          variant="ghost"
          size="sm"
          isDisabled={!replyText}
          onClick={() => {
            void navigator.clipboard.writeText(replyText);
            markCopied();
          }}
        />
        <ConfirmActionPopover
          title={t("chat.retryConfirmTitle")}
          description={t("chat.retryConfirmDescription")}
          confirmLabel={t("chat.retry")}
          align="start"
          side="top"
          onConfirm={() => {
            if (!retryTarget || !retryMessageRef) return;
            onResendFromEdit(retryMessageRef, retryTarget.text, retryTarget.attachments);
          }}
        >
          {() => (
            <IconButton
              label={retryTitle}
              tooltip={retryTitle}
              icon={<RefreshCw size={16} />}
              variant="ghost"
              size="sm"
              isDisabled={retryDisabled}
            />
          )}
        </ConfirmActionPopover>
        <ConfirmActionPopover
          title={t("chat.branchConfirmTitle")}
          description={t("chat.branchConfirmDescription")}
          confirmLabel={t("chat.branch")}
          tone="default"
          align="start"
          side="top"
          onConfirm={() => {
            if (retryMessageRef) onBranchConversation?.(retryMessageRef);
          }}
        >
          {() => (
            <IconButton
              label={retryMessageRef ? t("chat.branch") : t("chat.branchUnavailable")}
              tooltip={retryMessageRef ? t("chat.branch") : t("chat.branchUnavailable")}
              icon={<GitBranch size={16} />}
              variant="ghost"
              size="sm"
              isLoading={isRowBranchPending}
              isDisabled={isSending || !retryMessageRef || !onBranchConversation || branchPending}
            />
          )}
        </ConfirmActionPopover>
      </HStack>
    </HStack>
  );
}

export type UserRowFooterProps = {
  itemKey: string;
  text: string;
  timestamp: number;
  hasStableRef: boolean;
  messageId?: string;
  onStartEdit: (key: string) => void;
};

export function UserRowFooter(props: UserRowFooterProps) {
  const { itemKey, text, timestamp, hasStableRef, messageId, onStartEdit } = props;
  const { t } = useLocale();
  const { copied, markCopied } = useCopiedFlag();
  const { isSending } = useRowInteraction();
  const checkpointRewind = useCheckpointRewind();
  const [rewindError, setRewindError] = useState<string | null>(null);
  const editDisabled = isSending || !hasStableRef;
  const editTitle = hasStableRef ? t("chat.edit") : "旧历史缺少稳定消息标识，无法编辑重发";
  const isRewinding = checkpointRewind?.busyTurnId === messageId;

  return (
    <HStack gap={1.5} vAlign="center" hAlign="end" className="mt-1">
      <HStack gap={0.5} className="opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton
          label={t("chat.copy")}
          tooltip={t("chat.copy")}
          icon={copied ? <Check size={16} /> : <Copy size={16} />}
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            markCopied();
          }}
        />
        <IconButton
          label={editTitle}
          tooltip={editTitle}
          icon={<Pencil size={16} />}
          variant="ghost"
          size="sm"
          isDisabled={editDisabled}
          onClick={() => {
            if (hasStableRef) onStartEdit(itemKey);
          }}
        />
        {checkpointRewind?.available && messageId ? (
          <ConfirmActionPopover
            title={t("chat.checkpointRewind.title")}
            description={rewindError ?? t("chat.checkpointRewind.description")}
            confirmLabel={t("chat.checkpointRewind.confirm")}
            tone="destructive"
            align="end"
            side="top"
            onConfirm={async () => {
              setRewindError(null);
              try {
                await checkpointRewind.rewindTurn(messageId);
              } catch (error) {
                setRewindError(error instanceof Error ? error.message : String(error));
              }
            }}
          >
            {() => (
              <IconButton
                label={t("chat.checkpointRewind.title")}
                tooltip={t("chat.checkpointRewind.title")}
                icon={<Undo2 size={16} />}
                variant="ghost"
                size="sm"
                isLoading={isRewinding}
                isDisabled={isSending || checkpointRewind.busyTurnId !== null}
              />
            )}
          </ConfirmActionPopover>
        ) : null}
      </HStack>
      <MessageTimestamp value={timestamp} />
    </HStack>
  );
}
