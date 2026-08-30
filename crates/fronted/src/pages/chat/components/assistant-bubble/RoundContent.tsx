import { Collapsible } from "@astryxdesign/core/Collapsible";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Stack as AstryxStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "../../../../components/icons";
import { Markdown } from "../../../../components/Markdown";
import { useLocale } from "../../../../i18n";
import type { ChatFileLink } from "../../../../lib/chat/chatFileLinks";
import type { RetryAttemptRecord } from "../../../../lib/chat/conversation/liveTranscriptStore";
import type { ToolTraceItem, UiRound } from "../../../../lib/chat/messages/uiMessages";
import { normalizeLiveToolStatus, VIBING_STATUS } from "../../../../lib/chat/page/chatPageHelpers";
import { type GroupedRoundBlock, groupRoundBlocks } from "./assistantBubbleUtils";
import { HostedSearchGroupView } from "./HostedSearchGroupView";
import { AssistantStatus, CompactingText, VibingText } from "./StatusText";
import { MemoToolCallItem } from "./ToolCallItem";
import { getNativeDisplayImagePayload, NativeDisplayImageBlock } from "./ToolImages";
import { ToolTraceGroup } from "./ToolTraceGroup";
import { UsagePanel } from "./UsagePanel";

const ThinkingBlock = memo(function ThinkingBlock({
  text,
  open,
  isRunning,
  renderMode,
}: {
  text: string;
  open?: boolean;
  isRunning?: boolean;
  renderMode: "streaming" | "static";
}) {
  const hasText = /\S/.test(text || "");
  const { t } = useLocale();
  const [isOpen, setIsOpen] = useState(typeof open === "boolean" ? open : false);
  const userInteractedRef = useRef(false);
  useEffect(() => {
    if (!userInteractedRef.current && typeof open === "boolean") {
      setIsOpen(open);
    }
  }, [open]);

  if (!hasText) return null;

  return (
    <Collapsible
      isOpen={isOpen}
      onOpenChange={(nextOpen) => {
        userInteractedRef.current = true;
        setIsOpen(nextOpen);
      }}
      trigger={
        <Text type="body" color="secondary" weight="medium">
          {isRunning ? t("chat.thinking") : t("chat.thinkingProcess")}
        </Text>
      }
    >
      <VStack paddingBlockStart={2} paddingInlineStart={2} width="100%">
        <Markdown
          content={text}
          className="thinking-markdown"
          renderMode={renderMode}
          showCaret={false}
        />
      </VStack>
    </Collapsible>
  );
});

export const RetryDetailsBlock = memo(function RetryDetailsBlock({
  attempts,
}: {
  attempts: RetryAttemptRecord[];
}) {
  const { t } = useLocale();
  const [isOpen, setIsOpen] = useState(false);

  if (attempts.length === 0) return null;

  return (
    <Collapsible
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      trigger={
        <HStack gap={2} vAlign="center">
          <RefreshCw />
          <Text type="supporting" color="secondary">
            {t("chat.retryDetailsToggle").replace("{count}", String(attempts.length))}
          </Text>
        </HStack>
      }
    >
      <List density="compact" hasDividers>
        {/* Index-keyed: attempt ordinals can repeat within one list (text
            mode's tool-recovery loop restarts each wrapper's counter at 1)
            and the list is append-only, so the index is the stable key. */}
        {attempts.map((entry, index) => (
          <ListItem
            key={`${index}-${entry.attempt}-${entry.maxAttempts}`}
            label={t("chat.retryAttemptLabel")
              .replace("{attempt}", String(entry.attempt))
              .replace("{maxAttempts}", String(entry.maxAttempts))}
            description={entry.errorMessage}
            startContent={<RefreshCw />}
          />
        ))}
      </List>
    </Collapsible>
  );
});

/** Renders one grouped assistant block. The transcript virtualizer uses this
 * finer unit so very large replies no longer mount every Markdown/tool block
 * merely because one part of the reply is visible. */
export const RoundBlockContent = memo(function RoundBlockContent(props: {
  block: GroupedRoundBlock;
  isLive: boolean;
  renderMode: "streaming" | "static";
  runningToolCallIds: string[];
  thinkingOpen: boolean;
  isLatestThinking: boolean;
  workdir?: string;
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const {
    block,
    isLive,
    renderMode,
    runningToolCallIds,
    thinkingOpen,
    isLatestThinking,
    workdir,
    onOpenFileLink,
  } = props;

  if (block.kind === "thinking") {
    return (
      <ThinkingBlock
        text={block.text}
        open={isLive && thinkingOpen && isLatestThinking}
        isRunning={isLive && thinkingOpen && isLatestThinking}
        renderMode={renderMode}
      />
    );
  }
  if (block.kind === "tool") {
    const displayImagePayload = getNativeDisplayImagePayload(block.item);
    if (displayImagePayload) return <NativeDisplayImageBlock payload={displayImagePayload} />;
    if (block.item.toolCall.name === "Image" && !block.item.toolResult?.isError) return null;
    return (
      <MemoToolCallItem
        item={block.item}
        isRunning={Boolean(
          isLive && block.item.toolCall.id && runningToolCallIds.includes(block.item.toolCall.id),
        )}
      />
    );
  }
  if (block.kind === "toolGroup") {
    return (
      <ToolTraceGroup items={block.items} runningToolCallIds={isLive ? runningToolCallIds : []} />
    );
  }
  if (block.kind === "hostedSearch" || block.kind === "hostedSearchGroup") {
    return (
      <HostedSearchGroupView items={block.kind === "hostedSearch" ? [block.item] : block.items} />
    );
  }
  if (!block.text.trim()) return null;
  return (
    <Markdown
      content={block.text}
      className="font-openai-chat"
      renderMode={renderMode}
      showCaret={isLive}
      workdir={workdir}
      onOpenFileLink={onOpenFileLink}
    />
  );
});

export const RoundContent = memo(function RoundContent(props: {
  round: UiRound;
  showUsage?: boolean;
  usageContextWindow?: number;
  isLive?: boolean;
  isActive?: boolean;
  // Pinned per row (see AssistantBubble); falls back to the live flag for
  // callers that render outside the transcript row model.
  renderMode?: "streaming" | "static";
  toolStatus?: string | null;
  toolStatusVariant?: "default" | "compaction";
  retryAttempts?: RetryAttemptRecord[];
  runningToolCallIds?: string[];
  thinkingOpen?: boolean;
  latestTodoItem?: ToolTraceItem | null;
  workdir?: string;
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const {
    round,
    showUsage,
    usageContextWindow,
    isLive,
    isActive,
    renderMode,
    toolStatus,
    toolStatusVariant,
    retryAttempts,
    runningToolCallIds,
    thinkingOpen,
    latestTodoItem,
    workdir,
    onOpenFileLink,
  } = props;
  const groupedBlocks = useMemo(() => groupRoundBlocks(round.blocks), [round.blocks]);
  const visibleGroupedBlocks = useMemo(
    () =>
      groupedBlocks.filter(
        (block) =>
          !latestTodoItem ||
          block.kind !== "tool" ||
          block.item.toolCall.name !== "TodoWrite" ||
          block.item === latestTodoItem,
      ),
    [groupedBlocks, latestTodoItem],
  );
  const hasContent =
    visibleGroupedBlocks.some((block) => {
      if (
        block.kind === "tool" ||
        block.kind === "toolGroup" ||
        block.kind === "hostedSearch" ||
        block.kind === "hostedSearchGroup"
      ) {
        return true;
      }
      return block.text.trim().length > 0;
    }) ||
    (isActive && isLive);
  const normalizedToolStatus =
    isActive && isLive ? normalizeLiveToolStatus(toolStatus ?? null) : null;
  const isCompactionStatus = toolStatusVariant === "compaction";
  const isVibingStatus = normalizedToolStatus === VIBING_STATUS;
  const hasRunningToolCall = useMemo(() => {
    const runningIds = new Set(runningToolCallIds ?? []);
    return visibleGroupedBlocks.some((block) => {
      if (block.kind === "tool")
        return Boolean(block.item.toolCall.id && runningIds.has(block.item.toolCall.id));
      if (block.kind === "toolGroup") {
        return block.items.some((item) =>
          Boolean(item.toolCall.id && runningIds.has(item.toolCall.id)),
        );
      }
      return false;
    });
  }, [runningToolCallIds, visibleGroupedBlocks]);
  const latestThinkingKey = useMemo(() => {
    for (let index = visibleGroupedBlocks.length - 1; index >= 0; index -= 1) {
      const block = visibleGroupedBlocks[index];
      if (block?.kind === "thinking") return block.key;
    }
    return null;
  }, [visibleGroupedBlocks]);
  const autoOpenThinking = isLive ? Boolean(isActive && thinkingOpen) : false;

  if (!hasContent) return null;

  return (
    <AstryxStack direction="vertical" className="space-y-2">
      {isActive &&
      isLive &&
      normalizedToolStatus &&
      (!hasRunningToolCall || isCompactionStatus || isVibingStatus) ? (
        <AstryxStack direction="vertical" className="py-1.5">
          {isCompactionStatus ? (
            <CompactingText />
          ) : isVibingStatus ? (
            <VibingText />
          ) : (
            <AssistantStatus>{normalizedToolStatus}</AssistantStatus>
          )}
        </AstryxStack>
      ) : null}

      {isActive && isLive && retryAttempts && retryAttempts.length > 0 ? (
        <RetryDetailsBlock attempts={retryAttempts} />
      ) : null}

      {visibleGroupedBlocks.map((block) => {
        if (block.kind === "thinking") {
          return (
            <ThinkingBlock
              key={block.key}
              text={block.text}
              open={autoOpenThinking && block.key === latestThinkingKey}
              isRunning={autoOpenThinking && block.key === latestThinkingKey}
              renderMode={renderMode ?? (isLive ? "streaming" : "static")}
            />
          );
        }

        if (block.kind === "tool") {
          const displayImagePayload = getNativeDisplayImagePayload(block.item);
          if (displayImagePayload) {
            return <NativeDisplayImageBlock key={block.key} payload={displayImagePayload} />;
          }

          if (block.item.toolCall.name === "Image" && !block.item.toolResult?.isError) {
            return null;
          }

          return (
            <MemoToolCallItem
              key={block.key}
              item={block.item}
              isRunning={Boolean(
                isLive &&
                  block.item.toolCall.id &&
                  (runningToolCallIds || []).includes(block.item.toolCall.id),
              )}
            />
          );
        }

        if (block.kind === "toolGroup") {
          return (
            <ToolTraceGroup
              key={block.key}
              items={block.items}
              runningToolCallIds={isLive ? (runningToolCallIds ?? []) : []}
            />
          );
        }

        if (block.kind === "hostedSearch" || block.kind === "hostedSearchGroup") {
          return (
            <HostedSearchGroupView
              key={block.key}
              items={block.kind === "hostedSearch" ? [block.item] : block.items}
            />
          );
        }

        if (!block.text.trim()) return null;

        return (
          <Markdown
            key={block.key}
            content={block.text}
            className="font-openai-chat"
            renderMode={renderMode ?? (isLive ? "streaming" : "static")}
            showCaret={Boolean(isLive && isActive)}
            workdir={workdir}
            onOpenFileLink={onOpenFileLink}
          />
        );
      })}

      {showUsage ? (
        <UsagePanel usage={round.meta?.usage} contextWindow={usageContextWindow} />
      ) : null}
    </AstryxStack>
  );
});
