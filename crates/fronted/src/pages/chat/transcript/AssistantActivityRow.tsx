import { ChatToolCalls } from "@astryxdesign/core/Chat";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { memo, useEffect, useState } from "react";
import { ChangedFilesCard } from "../../../components/chat/ChangedFilesCard";
import { useLocale } from "../../../i18n";
import type { ChatFileLink } from "../../../lib/chat/chatFileLinks";
import type { HistoryMessageRef } from "../../../lib/chat/conversation/conversationState";
import type { RetryAttemptRecord } from "../../../lib/chat/conversation/liveTranscriptStore";
import { collectChangedFiles } from "../../../lib/chat/messages/changedFiles";
import type { UiRoundContentBlock } from "../../../lib/chat/messages/uiMessages";
import type { PendingUploadedFile } from "../../../lib/chat/messages/uploadedFiles";
import { createAstryxToolCall, ToolCallDetail } from "../components/assistant-bubble/ToolCallItem";
import { AssistantRenderUnit } from "./AssistantRenderUnit";
import type { AssistantActivityRow as AssistantActivityRowModel } from "./rowModel";
import { useTranscriptPreferences } from "./TranscriptPreferences";
import { groupWorkTools, workDuration, workRecord, workToolGroupLabel } from "./workRecord";

export const AssistantActivityRow = memo(function AssistantActivityRow(props: {
  row: AssistantActivityRowModel;
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
    onResendFromEdit,
    onBranchConversation,
  } = props;
  const { t } = useLocale();
  const { showThinking } = useTranscriptPreferences();
  const { work, answer } = workRecord(row.units, showThinking);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!row.live) setExpanded(false);
  }, [row.live]);
  const duration = workDuration(row.startedAt, row.endedAt ?? 0);
  const liveToolBlocks: UiRoundContentBlock[] = row.live
    ? row.units.flatMap(({ unit }) => {
        if (unit.kind !== "block") return [];
        if (unit.block.kind === "tool") return [{ kind: "tool" as const, item: unit.block.item }];
        if (unit.block.kind === "toolGroup") {
          return unit.block.items.map((item) => ({ kind: "tool" as const, item }));
        }
        return [];
      })
    : [];
  const liveChangedFiles = liveToolBlocks.length
    ? collectChangedFiles([{ blocks: liveToolBlocks }])
    : null;
  const renderUnits = (units: typeof row.units, flat = false) =>
    units.map((unit, index) => (
      <VStack key={unit.key} data-activity-key={unit.key} className="min-w-0 max-w-full">
        {flat &&
        unit.unit.kind === "block" &&
        (unit.unit.block.kind === "tool" || unit.unit.block.kind === "toolGroup") ? (
          groupWorkTools(
            unit.unit.block.kind === "tool" ? [unit.unit.block.item] : unit.unit.block.items,
          ).map((items) => {
            const calls = items.map((item) => {
              const running =
                unit.unit.kind === "block" &&
                row.live &&
                unit.unit.runningToolCallIds.includes(item.toolCall.id);
              return createAstryxToolCall(
                item,
                running,
                <ToolCallDetail item={item} isRunning={running} expanded={row.live} />,
              );
            });
            return (
              <ChatToolCalls
                key={items[0].toolCall.id}
                calls={calls}
                label={workToolGroupLabel(items, t)}
                defaultIsExpanded={false}
              />
            );
          })
        ) : (
          <AssistantRenderUnit
            row={unit}
            showUsage={showUsage}
            usageContextWindow={usageContextWindow}
            isAgentMode={isAgentMode}
            isCompactionRunning={unit.mutable ? isCompactionRunning : false}
            toolStatus={unit.mutable ? toolStatus : null}
            retryAttempts={unit.mutable && unit.unit.kind === "status" ? retryAttempts : undefined}
            workdir={workdir}
            onOpenFileLink={onOpenFileLink}
            onResendFromEdit={onResendFromEdit}
            onBranchConversation={onBranchConversation}
          />
        )}
        {unit.gapAfter > 0 && index < units.length - 1 ? (
          <VStack aria-hidden="true" className="shrink-0" style={{ height: unit.gapAfter }} />
        ) : null}
      </VStack>
    ));
  return (
    <VStack
      data-live-activity={row.live ? "true" : undefined}
      gap={2}
      className="min-w-0 w-full max-w-full"
    >
      {work.length && row.live ? (
        <VStack
          gap={1}
          width="100%"
          className="xgent-work-record"
          aria-label={t("chat.mobileActivity.working")}
        >
          <Text type="supporting" color="secondary">
            {t("chat.mobileActivity.working")}
          </Text>
          {renderUnits(work, true)}
          {liveChangedFiles ? <ChangedFilesCard summary={liveChangedFiles} /> : null}
        </VStack>
      ) : work.length ? (
        <Collapsible
          isOpen={expanded}
          onOpenChange={setExpanded}
          trigger={
            <Text type="supporting" color="secondary">
              {duration
                ? t("chat.activity.worked").replace("{duration}", duration)
                : t("chat.activity.tools")}
            </Text>
          }
        >
          <VStack gap={1} width="100%" className="xgent-work-record">
            {renderUnits(work, true)}
          </VStack>
        </Collapsible>
      ) : null}
      {renderUnits(answer)}
    </VStack>
  );
});
