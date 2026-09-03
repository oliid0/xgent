import { Center } from "@astryxdesign/core/Center";
import { ChatMessageList } from "@astryxdesign/core/Chat";
import { ContextMenu } from "@astryxdesign/core/ContextMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { VStack } from "@astryxdesign/core/Layout";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ChevronDown, Copy } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { buildFloorEntries } from "../../../lib/chat-floor-nav/floorModel";
import { BOTTOM_REATTACH_ZONE_PX } from "../../../lib/chat-scroll/scrollFollowCore";
import { useScrollFollow } from "../../../lib/chat-scroll/useScrollFollow";
import { ChatEmptyState } from "./ChatEmptyState";
import { FloorNavRail } from "./FloorNavRail";
import { RowInteractionProvider, useRowInteractionStore } from "./rowInteraction";
import { TranscriptList, type TranscriptNavHandle } from "./TranscriptList";
import { HistorySwitchLoadingOverlay } from "./TranscriptLoadingStates";
import type { ChatTranscriptProps } from "./transcriptTypes";
import { resolveTranscriptSelectionText, writeTextToClipboard } from "./transcriptUtils";

export type { ChatTranscriptProps } from "./transcriptTypes";

const DEFER_REVEAL_HISTORY_ITEM_THRESHOLD = 120;

export const ChatTranscript = memo(function ChatTranscript(props: ChatTranscriptProps) {
  const {
    conversationId,
    workspaceRoot,
    gitClient,
    followRef,
    hasModels,
    historyItems,
    hasMoreHistory,
    onLoadEarlierHistory,
    isHistorySwitching,
    isSending,
    isAgentMode,
    showUsage,
    usageContextWindow,
    liveTranscriptStore,
    isCompactionRunning,
    isReadOnly = false,
    bottomReservePx = 0,
    onOpenFileLink,
    onResendFromEdit,
    onBranchConversation,
    branchPendingMessageId,
    onOpenSettings,
    onSuggestionSelect,
    suggestionsDisabled = false,
    mobileExperience = false,
    emptyStateComposer,
  } = props;
  const { locale } = useLocale();
  const showNoModelsState = !hasModels;
  const showStartChatState = hasModels && historyItems.length === 0 && !isSending;
  const showMobileBlankState = mobileExperience && showStartChatState;
  const shouldReserveTranscriptBottomSpace = !(showNoModelsState || showStartChatState);
  // A reserve is only needed when a caller deliberately overlays the composer.
  // The normal chat frame keeps the composer in layout flow, so a zero reserve
  // must remain zero instead of manufacturing a blank strip below the reply.
  const transcriptBottomReservePx =
    shouldReserveTranscriptBottomSpace && bottomReservePx > 0
      ? Math.max(BOTTOM_REATTACH_ZONE_PX, Math.ceil(bottomReservePx) + 12)
      : 0;
  // Keep the transcript on a native scrolling element. This avoids custom
  // ScrollArea geometry work on every WebKit scroll while retaining the same
  // content container and visual layout.
  const [scrollViewport, setScrollViewport] = useState<HTMLDivElement | null>(null);
  const transcriptRootRef = useRef<HTMLElement | null>(null);
  const [selectedTranscriptText, setSelectedTranscriptText] = useState("");

  const { handle: scrollFollowHandle, following } = useScrollFollow({
    viewport: scrollViewport,
    listenerRoot: scrollViewport,
    trackKeys: true,
    config: { reattachZonePx: BOTTOM_REATTACH_ZONE_PX },
  });

  const prependAnchorRef = useRef<{
    firstItemKey: string | undefined;
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  const loadingEarlierRef = useRef(false);
  const firstHistoryItemKey = historyItems[0]?.key;

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    if (!anchor || !scrollViewport || anchor.firstItemKey === firstHistoryItemKey) return;
    scrollViewport.scrollTop =
      anchor.scrollTop + Math.max(0, scrollViewport.scrollHeight - anchor.scrollHeight);
    prependAnchorRef.current = null;
  }, [firstHistoryItemKey, scrollViewport]);

  useEffect(() => {
    if (!scrollViewport || !hasMoreHistory || isHistorySwitching) return;
    const loadAtTop = () => {
      if (scrollViewport.scrollTop > 480 || loadingEarlierRef.current) return;
      loadingEarlierRef.current = true;
      prependAnchorRef.current = {
        firstItemKey: historyItems[0]?.key,
        scrollHeight: scrollViewport.scrollHeight,
        scrollTop: scrollViewport.scrollTop,
      };
      void onLoadEarlierHistory()
        .catch(() => undefined)
        .finally(() => {
          loadingEarlierRef.current = false;
          requestAnimationFrame(() => {
            const anchor = prependAnchorRef.current;
            if (anchor?.firstItemKey === historyItems[0]?.key) {
              prependAnchorRef.current = null;
            }
          });
        });
    };
    scrollViewport.addEventListener("scroll", loadAtTop, { passive: true });
    return () => scrollViewport.removeEventListener("scroll", loadAtTop);
  }, [hasMoreHistory, historyItems, isHistorySwitching, onLoadEarlierHistory, scrollViewport]);

  const floors = useMemo(() => buildFloorEntries(historyItems), [historyItems]);
  const [activeFloorKey, setActiveFloorKey] = useState<string | null>(null);
  const transcriptNavRef = useRef<TranscriptNavHandle | null>(null);
  const handleFloorJump = useCallback(
    (rowKey: string) => {
      scrollFollowHandle.breakFollow();
      transcriptNavRef.current?.scrollToRowKey(rowKey);
    },
    [scrollFollowHandle],
  );

  // Run-scoped state reaches row action bars through this store instead of
  // row props, so settled rows stay memo-stable across run start/settle.
  const rowInteractionStore = useRowInteractionStore({
    isSending,
    isReadOnly,
    branchPendingMessageId: branchPendingMessageId ?? null,
  });

  // Ordinary histories paint immediately. Only large static conversations
  // need the convergence gate that masks estimate-to-measure corrections.
  const shouldDeferTranscriptReveal =
    !isSending && historyItems.length >= DEFER_REVEAL_HISTORY_ITEM_THRESHOLD;
  const [settledConversationId, setSettledConversationId] = useState<string | null>(null);
  const handleFirstLayoutSettled = useCallback(() => {
    setSettledConversationId(conversationId);
  }, [conversationId]);
  const isTranscriptSettling =
    shouldReserveTranscriptBottomSpace &&
    shouldDeferTranscriptReveal &&
    settledConversationId !== conversationId;

  useLayoutEffect(() => {
    followRef.current = scrollFollowHandle;
    return () => {
      if (followRef.current === scrollFollowHandle) {
        followRef.current = null;
      }
    };
  }, [followRef, scrollFollowHandle]);

  // Conversation switches always land pinned to the latest message.
  useLayoutEffect(() => {
    scrollFollowHandle.stickToBottom();
  }, [conversationId, scrollFollowHandle]);

  const copySelectedTextLabel = locale === "en-US" ? "Copy selected text" : "复制选中文本";
  const jumpToBottomLabel = locale === "en-US" ? "Scroll to bottom" : "回到底部";

  return (
    <VStack
      ref={transcriptRootRef}
      minHeight={0}
      style={{ position: "relative", flex: 1 }}
      onContextMenuCapture={() => {
        setSelectedTranscriptText(resolveTranscriptSelectionText(transcriptRootRef.current));
      }}
    >
      <VStack
        ref={(element) => setScrollViewport(element as HTMLDivElement | null)}
        data-scroll-viewport
        width="100%"
        height="100%"
        isScrollable
        style={{ overflowAnchor: "none" }}
      >
        <ContextMenu
          data-transcript-context-trigger=""
          label={copySelectedTextLabel}
          size="sm"
          items={[
            {
              label: copySelectedTextLabel,
              icon: <Icon icon={Copy} size="sm" color="inherit" />,
              isDisabled: !selectedTranscriptText,
              onClick: () => writeTextToClipboard(selectedTranscriptText),
            },
          ]}
        >
          <VStack
            width="100%"
            minHeight="100%"
            maxWidth="var(--xgent-content-width-md)"
            paddingInline={5}
            paddingBlock={4}
            className="chat-transcript-content"
            style={{ marginInline: "auto" }}
          >
            {(showNoModelsState || showStartChatState) && !showMobileBlankState ? (
              <Center
                width="100%"
                className="chat-empty-state-stage"
                style={{
                  flex: 1,
                  minHeight: 0,
                  justifyContent: mobileExperience && showStartChatState ? "flex-end" : undefined,
                  paddingBlockEnd:
                    mobileExperience && showStartChatState ? "var(--spacing-4)" : undefined,
                }}
              >
                {/* Keyed per conversation so the hero entrance replays when
                  switching between empty conversations, not just on mount. */}
                <ChatEmptyState
                  key={conversationId ?? "empty"}
                  variant={showNoModelsState ? "no-models" : "start-chat"}
                  onOpenSettings={onOpenSettings}
                  onSuggestionSelect={onSuggestionSelect}
                  suggestionsDisabled={suggestionsDisabled}
                  composer={emptyStateComposer}
                />
              </Center>
            ) : null}

            <ChatMessageList
              align="top"
              gap={0}
              density="balanced"
              isStreaming={isSending}
              style={{
                userSelect: "text",
                opacity: isTranscriptSettling ? 0 : 1,
                transitionProperty: "opacity",
                transitionDuration: "var(--duration-fast)",
                transitionTimingFunction: "var(--ease-standard)",
              }}
            >
              <RowInteractionProvider value={rowInteractionStore}>
                {/* Keyed remount per conversation: per-conversation state
                  (row model, entrance registry, virtualizer measurements)
                  initializes fresh, and row keys can never collide across
                  conversations in the virtualizer's itemSizeCache. */}
                <TranscriptList
                  key={conversationId}
                  conversationId={conversationId}
                  historyItems={historyItems}
                  liveTranscriptStore={liveTranscriptStore}
                  scrollViewport={scrollViewport}
                  isViewportFollowing={scrollFollowHandle.isFollowing}
                  isSending={isSending}
                  isAgentMode={isAgentMode}
                  isCompactionRunning={isCompactionRunning}
                  showUsage={showUsage}
                  usageContextWindow={usageContextWindow}
                  workspaceRoot={workspaceRoot}
                  gitClient={gitClient}
                  onOpenFileLink={onOpenFileLink}
                  navRef={transcriptNavRef}
                  onAnchorUserRowChange={setActiveFloorKey}
                  onResendFromEdit={onResendFromEdit}
                  onBranchConversation={onBranchConversation}
                  onFirstLayoutSettled={
                    shouldDeferTranscriptReveal ? handleFirstLayoutSettled : undefined
                  }
                />
              </RowInteractionProvider>
            </ChatMessageList>

            <VStack style={{ height: transcriptBottomReservePx }} />
          </VStack>
        </ContextMenu>
      </VStack>
      {!showNoModelsState && !showStartChatState && !isTranscriptSettling ? (
        <FloorNavRail
          conversationId={conversationId}
          floors={floors}
          activeRowKey={activeFloorKey}
          bottomOffset={`${Math.ceil(transcriptBottomReservePx) + 8}px`}
          scrollViewport={scrollViewport}
          onJump={handleFloorJump}
        />
      ) : null}
      {!following ? (
        <IconButton
          label={jumpToBottomLabel}
          tooltip={jumpToBottomLabel}
          icon={<Icon icon={ChevronDown} size="sm" color="inherit" />}
          size="sm"
          variant="secondary"
          elevation="med"
          onClick={() => scrollFollowHandle.jumpToBottom()}
          className="chat-jump-to-bottom"
          style={{
            position: "absolute",
            insetInlineStart: "50%",
            zIndex: "var(--xgent-z-chat-floating-action)",
            bottom: `calc(${Math.ceil(bottomReservePx)}px + var(--spacing-4))`,
          }}
        />
      ) : null}
      {isHistorySwitching || isTranscriptSettling ? <HistorySwitchLoadingOverlay /> : null}
    </VStack>
  );
});
