import { memo, useMemo } from "react";
import { ChangedFilesCard } from "../../../components/chat/ChangedFilesCard";
import { CloudArtifactsCard } from "../../../components/chat/CloudArtifactsCard";
import type { HistoryMessageRef } from "../../../lib/chat/conversation/conversationState";
import type { RetryAttemptRecord } from "../../../lib/chat/conversation/liveTranscriptStore";
import type { ChatFileLink } from "../../../lib/chat/chatFileLinks";
import { collectChangedFiles } from "../../../lib/chat/messages/changedFiles";
import { collectCloudArtifacts } from "../../../lib/chat/messages/cloudArtifacts";
import type { PendingUploadedFile } from "../../../lib/chat/messages/uploadedFiles";
import { cn } from "../../../lib/shared/utils";
import { AssistantAvatar, AssistantBubbleUnit } from "../components/AssistantBubble";
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
  showAvatar: boolean;
  compacted: boolean;
  onResendFromEdit: AssistantRenderUnitProps["onResendFromEdit"];
  onBranchConversation?: AssistantRenderUnitProps["onBranchConversation"];
}) {
  const { unit, showAvatar, compacted, onResendFromEdit, onBranchConversation } = props;
  const changedFiles = useMemo(
    () => (unit.hasChangedFilesCandidate ? collectChangedFiles(unit.rounds) : null),
    [unit.hasChangedFilesCandidate, unit.rounds],
  );
  const cloudArtifacts = useMemo(() => collectCloudArtifacts(unit.rounds), [unit.rounds]);
  const hasCards = Boolean(changedFiles) || cloudArtifacts.length > 0;

  return (
    <div className={cn("group/assistant w-full max-w-full", compacted && "opacity-70")}>
      {hasCards ? (
        <div className="flex w-full max-w-full items-start gap-3">
          {showAvatar ? <AssistantAvatar /> : <div aria-hidden="true" className="h-7 w-7 shrink-0" />}
          <div className={cn("min-w-0 flex-1 space-y-2", showAvatar ? "pt-0.5" : "")}>
            {changedFiles ? <ChangedFilesCard summary={changedFiles} /> : null}
            {cloudArtifacts.length > 0 ? <CloudArtifactsCard artifacts={cloudArtifacts} /> : null}
          </div>
        </div>
      ) : showAvatar ? (
        <div className="flex w-full max-w-full items-start gap-3">
          <AssistantAvatar />
          <div className="min-w-0 flex-1" />
        </div>
      ) : null}
      <AssistantRowFooter
        timestamp={unit.timestamp}
        replyText={unit.replyText}
        retryTarget={unit.retryTarget}
        onResendFromEdit={onResendFromEdit}
        onBranchConversation={onBranchConversation}
      />
    </div>
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
        showAvatar={row.showAvatar}
        compacted={row.compacted}
        onResendFromEdit={onResendFromEdit}
        onBranchConversation={onBranchConversation}
      />
    );
  }

  return (
    <div className={cn("group/assistant w-full max-w-full", row.compacted && "opacity-70")}>
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
    </div>
  );
});
