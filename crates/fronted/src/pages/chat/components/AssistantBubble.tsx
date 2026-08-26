import { ChatMessage } from "@astryxdesign/core/Chat";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { memo, useMemo } from "react";

import { ChangedFilesCard } from "../../../components/chat/ChangedFilesCard";
import { CloudArtifactsCard } from "../../../components/chat/CloudArtifactsCard";
import type { ChatFileLink } from "../../../lib/chat/chatFileLinks";
import type { RetryAttemptRecord } from "../../../lib/chat/conversation/liveTranscriptStore";
import { collectChangedFiles } from "../../../lib/chat/messages/changedFiles";
import { collectCloudArtifacts } from "../../../lib/chat/messages/cloudArtifacts";
import type { UiRound } from "../../../lib/chat/messages/uiMessages";
import { normalizeLiveToolStatus, VIBING_STATUS } from "../../../lib/chat/page/chatPageHelpers";
import type { AssistantUnitRow } from "../transcript/rowModel";

import { AssistantAvatar } from "./assistant-bubble/AssistantAvatar";
import {
  RetryDetailsBlock,
  RoundBlockContent,
  RoundContent,
} from "./assistant-bubble/RoundContent";
import { AssistantStatus, CompactingText, VibingText } from "./assistant-bubble/StatusText";
import { UsagePanel } from "./assistant-bubble/UsagePanel";

export { AssistantAvatar } from "./assistant-bubble/AssistantAvatar";
export { RetryDetailsBlock } from "./assistant-bubble/RoundContent";
export { AssistantStatus, CompactingText, VibingText } from "./assistant-bubble/StatusText";

const EMPTY_RUNNING_TOOL_CALL_IDS: string[] = [];
const EMPTY_RETRY_ATTEMPTS: RetryAttemptRecord[] = [];

export const AssistantBubble = memo(function AssistantBubble(props: {
  rounds: (UiRound & {
    runningToolCallIds?: string[];
    thinkingOpen?: boolean;
  })[];
  showUsage?: boolean;
  usageContextWindow?: number;
  isLive?: boolean;
  // Pinned per row: stream-born content renders in streaming mode forever,
  // history renders static. Never flips for a given row.
  renderMode?: "streaming" | "static";
  toolStatus?: string | null;
  toolStatusVariant?: "default" | "compaction";
  retryAttempts?: RetryAttemptRecord[];
  workdir?: string;
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const {
    rounds,
    showUsage,
    usageContextWindow,
    isLive,
    renderMode,
    toolStatus,
    toolStatusVariant,
    retryAttempts,
    workdir,
    onOpenFileLink,
  } = props;
  const latestTodoItem = useMemo(() => {
    for (let roundIndex = rounds.length - 1; roundIndex >= 0; roundIndex -= 1) {
      const blocks = rounds[roundIndex]?.blocks ?? [];
      for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
        const block = blocks[blockIndex];
        if (block?.kind === "tool" && block.item.toolCall.name === "TodoWrite") {
          return block.item;
        }
      }
    }
    return null;
  }, [rounds]);
  // 回复末尾的已编辑文件卡：聚合整条回复所有 round 的 Write/Edit/Delete，
  // 只在回复结束（行落定）后出现，流式过程中不渲染。
  const changedFiles = useMemo(
    () => (isLive ? null : collectChangedFiles(rounds)),
    [isLive, rounds],
  );
  const cloudArtifacts = useMemo(
    () => (isLive ? [] : collectCloudArtifacts(rounds)),
    [isLive, rounds],
  );

  return (
    <ChatMessage sender="assistant" density="compact" avatar={<AssistantAvatar />}>
      <VStack gap={2} width="100%" paddingBlockStart={0.5}>
        {rounds.map((round, idx) => (
          <RoundContent
            key={round.key}
            round={round}
            showUsage={showUsage}
            usageContextWindow={usageContextWindow}
            isLive={isLive}
            isActive={isLive && idx === rounds.length - 1}
            renderMode={renderMode}
            toolStatus={idx === rounds.length - 1 ? toolStatus : null}
            toolStatusVariant={idx === rounds.length - 1 ? toolStatusVariant : "default"}
            retryAttempts={idx === rounds.length - 1 ? retryAttempts : EMPTY_RETRY_ATTEMPTS}
            runningToolCallIds={round.runningToolCallIds ?? EMPTY_RUNNING_TOOL_CALL_IDS}
            thinkingOpen={round.thinkingOpen}
            latestTodoItem={latestTodoItem}
            workdir={workdir}
            onOpenFileLink={onOpenFileLink}
          />
        ))}
        {changedFiles ? <ChangedFilesCard summary={changedFiles} /> : null}
        {cloudArtifacts.length > 0 ? <CloudArtifactsCard artifacts={cloudArtifacts} /> : null}
      </VStack>
    </ChatMessage>
  );
});

export const AssistantBubbleUnit = memo(function AssistantBubbleUnit(props: {
  row: AssistantUnitRow;
  showUsage?: boolean;
  usageContextWindow?: number;
  isAgentMode: boolean;
  isCompactionRunning: boolean;
  toolStatus: string | null;
  retryAttempts?: RetryAttemptRecord[];
  workdir?: string;
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
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
  } = props;
  const { unit } = row;
  if (unit.kind === "footer") return null;

  const normalizedStatus = normalizeLiveToolStatus(toolStatus);
  const status =
    unit.kind === "status" && row.live ? (
      isCompactionRunning ? (
        <CompactingText />
      ) : normalizedStatus === VIBING_STATUS || !normalizedStatus ? (
        <VibingText />
      ) : (
        <AssistantStatus>{normalizedStatus}</AssistantStatus>
      )
    ) : null;

  return (
    <ChatMessage
      sender="assistant"
      density="compact"
      avatar={
        row.showAvatar ? (
          <AssistantAvatar />
        ) : (
          <HStack
            aria-hidden="true"
            width="var(--xagent-assistant-avatar-size)"
            height="var(--xagent-assistant-avatar-size)"
          />
        )
      }
    >
      <VStack
        gap={2}
        width="100%"
        paddingBlockStart={unit.kind === "status" && isAgentMode ? 1 : row.showAvatar ? 0.5 : 0}
      >
        {status ? (
          <VStack width="100%" paddingBlock={1.5} style={{ overflow: "hidden" }}>
            {status}
          </VStack>
        ) : null}
        {row.mutable && retryAttempts?.length ? (
          <RetryDetailsBlock attempts={retryAttempts} />
        ) : null}
        {unit.kind === "block" ? (
          <RoundBlockContent
            block={unit.block}
            isLive={row.live}
            renderMode={row.renderMode}
            runningToolCallIds={unit.runningToolCallIds}
            thinkingOpen={unit.thinkingOpen}
            isLatestThinking={unit.isLatestThinking}
            workdir={workdir}
            onOpenFileLink={onOpenFileLink}
          />
        ) : null}
        {unit.kind === "block" && unit.isRoundTail && showUsage ? (
          <UsagePanel usage={unit.roundMeta?.usage} contextWindow={usageContextWindow} />
        ) : null}
      </VStack>
    </ChatMessage>
  );
});
