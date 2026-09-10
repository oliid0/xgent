import { Collapsible } from "@astryxdesign/core/Collapsible";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { memo, useEffect, useRef, useState } from "react";
import { useLocale } from "../../../i18n";
import type { ChatFileLink } from "../../../lib/chat/chatFileLinks";
import type { HistoryMessageRef } from "../../../lib/chat/conversation/conversationState";
import type { RetryAttemptRecord } from "../../../lib/chat/conversation/liveTranscriptStore";
import type { PendingUploadedFile } from "../../../lib/chat/messages/uploadedFiles";
import { ToolStepRow } from "../components/assistant-bubble/ToolCallItem";
import { AssistantRenderUnit } from "./AssistantRenderUnit";
import type { AssistantActivityRow as AssistantActivityRowModel } from "./rowModel";
import { useTranscriptPreferences } from "./TranscriptPreferences";
import { workDuration, workRecord } from "./workRecord";

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
  const started = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setExpanded(false);
    if (!row.live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [row.live]);
  const duration = workDuration(
    row.startedAt ?? (row.live ? started.current : undefined),
    row.endedAt ?? now,
  );
  const renderUnits = (units: typeof row.units, flat = false) =>
    units.map((unit, index) => (
      <VStack key={unit.key} data-activity-key={unit.key} className="min-w-0 max-w-full">
        {flat &&
        unit.unit.kind === "block" &&
        (unit.unit.block.kind === "tool" || unit.unit.block.kind === "toolGroup") ? (
          (unit.unit.block.kind === "tool" ? [unit.unit.block.item] : unit.unit.block.items).map(
            (item) => (
              <ToolStepRow
                key={item.toolCall.id}
                item={item}
                isRunning={
                  unit.unit.kind === "block" &&
                  row.live &&
                  unit.unit.runningToolCallIds.includes(item.toolCall.id)
                }
              />
            ),
          )
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
      {work.length ? (
        <Collapsible
          isOpen={expanded}
          onOpenChange={setExpanded}
          trigger={
            <Text type="supporting" color="secondary">
              {row.live
                ? t("chat.mobileActivity.working")
                : duration
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
