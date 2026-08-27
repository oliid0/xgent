import { ChatMessage } from "@astryxdesign/core/Chat";
import { VStack } from "@astryxdesign/core/Layout";
import { memo, useMemo } from "react";
import { ChangedFilesCard } from "../../../components/chat/ChangedFilesCard";
import { CloudArtifactsCard } from "../../../components/chat/CloudArtifactsCard";
import type { ChatFileLink } from "../../../lib/chat/chatFileLinks";
import type { HistoryMessageRef } from "../../../lib/chat/conversation/conversationState";
import type { RetryAttemptRecord } from "../../../lib/chat/conversation/liveTranscriptStore";
import { collectChangedFiles } from "../../../lib/chat/messages/changedFiles";
import { collectCloudArtifacts } from "../../../lib/chat/messages/cloudArtifacts";
import type { PendingUploadedFile } from "../../../lib/chat/messages/uploadedFiles";
import { AssistantBubbleUnit } from "../components/AssistantBubble";
import { AssistantRowFooter } from "./RowActions";
import type { AssistantFooterRenderUnit, AssistantUnitRow } from "./rowModel";

export type AssistantRenderUnitProps = {
  row: AssistantUnitRow;
  showUsage?: boolean;
  usageContextWindow?: number;
  isAgentMode: boolean;
  isCompactionRunning: boolean;
  toolStatus: string | null;
  retryAttempts?: RetryAttemptRecord[];
  workdir?: string;
  onOpenFileLink?: (link: ChatFileLink) => void;
  onResendFromEdit: (
    messageRef: HistoryMessageRef,
    text: string,
    attachments: PendingUploadedFile[],
  ) => void;
  onBranchConversation?: (messageRef: HistoryMessageRef) => void;
};

const AssistantFooterUnit = memo(function AssistantFooterUnit(props: {
  unit: AssistantFooterRenderUnit;
  compacted: boolean;
  onResendFromEdit: AssistantRenderUnitProps["onResendFromEdit"];
  onBranchConversation?: AssistantRenderUnitProps["onBranchConversation"];
}) {
  const { unit, compacted, onResendFromEdit, onBranchConversation } = props;
  const changedFiles = useMemo(
    () => (unit.hasChangedFilesCandidate ? collectChangedFiles(unit.rounds) : null),
    [unit.hasChangedFilesCandidate, unit.rounds],
  );
  const cloudArtifacts = useMemo(() => collectCloudArtifacts(unit.rounds), [unit.rounds]);
  const hasCards = Boolean(changedFiles) || cloudArtifacts.length > 0;

  return (
    <ChatMessage
      sender="assistant"
      density="compact"
      className="group/assistant"
      style={compacted ? { opacity: "var(--xagent-opacity-compacted)" } : undefined}
    >
      {hasCards ? (
        <VStack gap={2} width="100%">
          {changedFiles ? <ChangedFilesCard summary={changedFiles} /> : null}
          {cloudArtifacts.length > 0 ? <CloudArtifactsCard artifacts={cloudArtifacts} /> : null}
        </VStack>
      ) : null}
      <AssistantRowFooter
        timestamp={unit.timestamp}
        replyText={unit.replyText}
        retryTarget={unit.retryTarget}
        onResendFromEdit={onResendFromEdit}
        onBranchConversation={onBranchConversation}
      />
    </ChatMessage>
  );
});

export const AssistantRenderUnit = memo(function AssistantRenderUnit(
  props: AssistantRenderUnitProps,
) {
  const {
    row,
    showUsage,
    usageContextWindow,
    isAgentMode,
    isCompactionRunning,
    toolStatus,
    retryAttempts,
    workdir,
    onOpenFileLink,
    onResendFromEdit,
    onBranchConversation,
  } = props;

  if (row.unit.kind === "footer") {
    return (
      <AssistantFooterUnit
        unit={row.unit}
        compacted={row.compacted}
        onResendFromEdit={onResendFromEdit}
        onBranchConversation={onBranchConversation}
      />
    );
  }

  return (
    <VStack
      width="100%"
      className="group/assistant"
      style={row.compacted ? { opacity: "var(--xagent-opacity-compacted)" } : undefined}
    >
      <AssistantBubbleUnit
        row={row}
        showUsage={showUsage}
        usageContextWindow={usageContextWindow}
        isAgentMode={isAgentMode}
        isCompactionRunning={isCompactionRunning}
        toolStatus={toolStatus}
        retryAttempts={retryAttempts}
        workdir={workdir}
        onOpenFileLink={onOpenFileLink}
      />
    </VStack>
  );
});
