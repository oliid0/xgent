import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Stack as AstryxStack, HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { type Range, useVirtualizer } from "@tanstack/react-virtual";
import {
  type MutableRefObject,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { CheckCircle2 } from "../../../components/icons";
import { Markdown } from "../../../components/Markdown";
import { useLocale } from "../../../i18n";
import type { ChatFileLink } from "../../../lib/chat/chatFileLinks";
import type {
  HistoryMessageRef,
  RenderSummaryCard,
  RenderTimelineItem,
} from "../../../lib/chat/conversation/conversationState";
import type { LiveTranscriptStore } from "../../../lib/chat/conversation/liveTranscriptStore";
import type { PendingUploadedFile } from "../../../lib/chat/messages/uploadedFiles";
import {
  buildGitHubCommitUrl,
  type CommitDetailsLoader,
  type CommitDisplayReference,
} from "../../../lib/chat/messages/userMessageContent";
import { normalizeLiveToolStatus } from "../../../lib/chat/page/chatPageHelpers";
import type { GitClient } from "../../../lib/git/types";
import { createEntranceRegistry } from "../../../lib/transcript-virtual/entranceOnce";
import { createLiveRowScrollAdjustPolicy } from "../../../lib/transcript-virtual/liveScrollAdjustPolicy";
import { createTranscriptMeasurementsLru } from "../../../lib/transcript-virtual/measurementsLru";
import { AssistantActivityRow } from "./AssistantActivityRow";
import { AssistantRenderUnit } from "./AssistantRenderUnit";
import { extractRenderUnitRange } from "./renderUnitRangeExtractor";
import { createTranscriptRowModel } from "./rowModel";
import { UserMessageRow } from "./UserMessageRow";

// Measured row heights survive conversation switches: saved on unmount,
// restored (width-gated) on the next open so the switch lays out with exact
// heights instead of estimates.
const transcriptMeasurementsLru = createTranscriptMeasurementsLru();

const SummaryCard = memo(function SummaryCard(props: { item: RenderSummaryCard }) {
  const { item } = props;
  const { locale } = useLocale();
  const isEn = locale === "en-US";

  return (
    <HStack width="100%" hAlign="center" paddingInline={2}>
      <Card width="100%" maxWidth="var(--xagent-content-width-md)" padding={3} elevation="low">
        <Collapsible
          defaultIsOpen={false}
          trigger={
            <HStack gap={3} vAlign="center" width="100%">
              <CheckCircle2 size={16} strokeWidth={1.8} />
              <VStack gap={0.5} width="100%">
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text type="body" weight="medium">
                    {isEn ? "Context Checkpoint" : "上下文检查点"}
                  </Text>
                  <Text type="supporting" color="secondary">
                    {item.coveredMessageCount} {isEn ? "messages" : "条消息"}
                  </Text>
                </HStack>
                <Text type="supporting" color="secondary">
                  {item.generatedBy.providerId} · {item.generatedBy.model}
                </Text>
              </VStack>
            </HStack>
          }
        >
          <Markdown content={item.content} className="font-openai-chat text-sm" />
        </Collapsible>
      </Card>
    </HStack>
  );
});

export type TranscriptNavHandle = {
  /** 按行 key 跳转到对应消息（动态行高下会连帧重对准确保落位）。 */
  scrollToRowKey: (rowKey: string) => void;
};

export type TranscriptListProps = {
  conversationId: string;
  historyItems: RenderTimelineItem[];
  liveTranscriptStore: LiveTranscriptStore;
  scrollViewport: HTMLDivElement | null;
  // Whether the scroll-follow engine is attached to the bottom; gates the
  // virtualizer's resize-compensation carve-out for live-row growth.
  isViewportFollowing?: () => boolean;
  isSending: boolean;
  isAgentMode: boolean;
  isCompactionRunning: boolean;
  showUsage: boolean;
  usageContextWindow?: number;
  workspaceRoot?: string;
  gitClient?: GitClient | null;
  onOpenFileLink?: (link: ChatFileLink) => void;
  // 楼层导航：跳转句柄挂载点（与 followRef 同一模式），以及「视口顶部
  // 当前处于哪条用户消息行」变化时的上报回调。
  navRef?: MutableRefObject<TranscriptNavHandle | null>;
  onAnchorUserRowChange?: (rowKey: string | null) => void;
  onResendFromEdit: (
    messageRef: HistoryMessageRef,
    text: string,
    attachments: PendingUploadedFile[],
  ) => void;
  onBranchConversation?: (messageRef: HistoryMessageRef) => void;
  // Fires once per mount, when the first layout has settled (scroll offset
  // and total size stable across frames after the initial scroll-to-end).
  // ChatTranscript keeps the transcript hidden behind the loading overlay
  // until then, so estimate→measure corrections never show as jumps.
  onFirstLayoutSettled?: () => void;
};

// The whole transcript — committed history and the streaming reply — lives in
// one virtualized container with stable row keys, so a run settling into
// history is a pure data transition (no cross-container move, no remount).
// Rows at or after liveStartIndex are force-mounted; everything else
// virtualizes normally with per-row content-shaped height estimates.
export const TranscriptList = memo(function TranscriptList(props: TranscriptListProps) {
  const {
    conversationId,
    historyItems,
    liveTranscriptStore,
    scrollViewport,
    isViewportFollowing,
    isSending,
    isAgentMode,
    isCompactionRunning,
    showUsage,
    usageContextWindow,
    workspaceRoot,
    gitClient,
    onOpenFileLink,
    navRef,
    onAnchorUserRowChange,
    onResendFromEdit,
    onBranchConversation,
    onFirstLayoutSettled,
  } = props;

  const liveState = useSyncExternalStore(
    liveTranscriptStore.subscribe,
    liveTranscriptStore.getSnapshot,
    liveTranscriptStore.getSnapshot,
  );

  // The component remounts per conversation (keyed by ChatTranscript), so
  // per-conversation state initializes once per mount — no reset effects.
  const [entranceRegistry] = useState(() => createEntranceRegistry());
  const [rowModel] = useState(() =>
    createTranscriptRowModel({
      onRowsBorn: (keys, isInitialBuild) => entranceRegistry.observeBirths(keys, isInitialBuild),
    }),
  );

  const { rows, liveStartIndex } = useMemo(
    () => rowModel.build(historyItems, { ...liveState, isSending, isCompactionRunning }),
    [rowModel, historyItems, liveState, isSending, isCompactionRunning],
  );

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const liveStartIndexRef = useRef(liveStartIndex);
  liveStartIndexRef.current = liveStartIndex;
  const extractVirtualRange = useCallback(
    (range: Range) =>
      extractRenderUnitRange(
        range,
        (index) => rowsRef.current[index]?.renderCost,
        liveStartIndexRef.current,
      ),
    [],
  );

  const [editingMessageKey, setEditingMessageKey] = useState<string | null>(null);
  const commitDetailsCacheRef = useRef(new Map<string, CommitDisplayReference>());

  useEffect(() => {
    if (!editingMessageKey) {
      return;
    }
    const hasEditingMessage = historyItems.some(
      (item) => item.kind === "user" && item.key === editingMessageKey,
    );
    if (!hasEditingMessage) {
      setEditingMessageKey(null);
    }
  }, [editingMessageKey, historyItems]);

  const loadCommitDetails = useCallback<CommitDetailsLoader>(
    async (commit) => {
      const workdir = workspaceRoot?.trim() ?? "";
      const sha = commit.sha.trim();
      if (!gitClient || !workdir || !sha) return null;
      const cacheKey = `${workdir}\n${sha}`;
      const cached = commitDetailsCacheRef.current.get(cacheKey);
      if (cached) return cached;
      const response = await gitClient.commitDetails(workdir, sha);
      const details = response.commit;
      const resolved: CommitDisplayReference = {
        sha: details.sha,
        shortSha: details.shortSha,
        subject: details.subject,
        body: details.body,
        authorName: details.authorName,
        authorEmail: details.authorEmail,
        authorDate: details.authorDate,
        fileCount: details.fileCount,
        filesChanged: details.filesChanged,
        insertions: details.insertions,
        deletions: details.deletions,
        stat: details.stat,
        remoteName: details.remoteName,
        remoteUrl: details.remoteUrl,
        githubUrl:
          commit.githubUrl ||
          buildGitHubCommitUrl(details.remoteUrl || response.state.remoteUrl, details.sha) ||
          undefined,
      };
      commitDetailsCacheRef.current.set(cacheKey, resolved);
      return resolved;
    },
    [gitClient, workspaceRoot],
  );

  const handleStartEdit = useCallback((key: string) => {
    setEditingMessageKey(key);
  }, []);
  const handleCancelEdit = useCallback(() => {
    setEditingMessageKey(null);
  }, []);

  const displayedToolStatus = normalizeLiveToolStatus(liveState.toolStatus);

  // Restored once per mount: at conversation-switch remounts the viewport is
  // already live, so a same-width snapshot skips straight to exact layout.
  const [initialMeasurementsCache] = useState(
    () =>
      (scrollViewport
        ? transcriptMeasurementsLru.restore(conversationId, scrollViewport.clientWidth)
        : null) ?? [],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollViewport,
    estimateSize: (index) => {
      const row = rowsRef.current[index];
      return row ? row.estimate + (index < rowsRef.current.length - 1 ? row.gapAfter : 0) : 260;
    },
    getItemKey: (index) => rows[index]?.key ?? index,
    gap: 0,
    overscan: 0,
    enabled: scrollViewport !== null,
    initialMeasurementsCache,
    // End-anchored: while the viewport sits within the threshold of the end,
    // growth of the last row (streaming) compensates by the total-size delta
    // upstream, and estimate→measure corrections keep the bottom pinned. The
    // threshold matches scrollFollowCore's BOTTOM_ATTACH_THRESHOLD_PX so both
    // engines agree on what "at the bottom" means. followOnAppend stays off:
    // its DOM-distance re-follow would conflict with the follow reducer's
    // "shrink clamps never re-attach" contract — appends while following are
    // already pinned by the reducer.
    anchorTo: "end",
    scrollEndThreshold: 8,
    rangeExtractor: extractVirtualRange,
  });

  // TanStack exposes the resize-compensation predicate as an instance field,
  // not an option; reassigning per render keeps the closure's inputs current.
  // It only governs the detached reader — while virtually at the end, the
  // upstream end-anchor compensation takes priority over this predicate.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = createLiveRowScrollAdjustPolicy({
    getLiveStartIndex: () => liveStartIndexRef.current,
    isFollowing: () => isViewportFollowing?.() ?? false,
  });

  // 楼层导航跳转句柄：按行 key 定位 index 后 scrollToIndex。沿途行首次真实
  // 测量会不断修正总高度，连续若干帧重新对准，让滚动收敛在目标行顶部
  // （对准同一 index 是收敛操作，不会震荡）。收敛期间用户的滚轮/触摸/按键
  // 立即取消收敛；新跳转替换旧收敛；卸载时一并清理。
  const cancelJumpSettleRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    if (!navRef) return;
    const handle: TranscriptNavHandle = {
      scrollToRowKey: (rowKey) => {
        cancelJumpSettleRef.current();
        const alignToRow = () => {
          const index = rowsRef.current.findIndex((row) => row.key === rowKey);
          if (index < 0) return false;
          virtualizer.scrollToIndex(index, { align: "start" });
          return true;
        };
        if (!alignToRow()) return;
        let rafId: number | null = null;
        const stopSettle = () => {
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          scrollViewport?.removeEventListener("wheel", stopSettle);
          scrollViewport?.removeEventListener("touchstart", stopSettle);
          scrollViewport?.removeEventListener("keydown", stopSettle);
          if (cancelJumpSettleRef.current === stopSettle) {
            cancelJumpSettleRef.current = () => {};
          }
        };
        cancelJumpSettleRef.current = stopSettle;
        scrollViewport?.addEventListener("wheel", stopSettle, { passive: true });
        scrollViewport?.addEventListener("touchstart", stopSettle, { passive: true });
        scrollViewport?.addEventListener("keydown", stopSettle);
        let remainingFrames = 6;
        const settle = () => {
          rafId = null;
          if (!alignToRow()) {
            stopSettle();
            return;
          }
          remainingFrames -= 1;
          if (remainingFrames > 0) {
            rafId = requestAnimationFrame(settle);
          } else {
            stopSettle();
          }
        };
        rafId = requestAnimationFrame(settle);
      },
    };
    navRef.current = handle;
    return () => {
      cancelJumpSettleRef.current();
      if (navRef.current === handle) {
        navRef.current = null;
      }
    };
  }, [navRef, virtualizer, scrollViewport]);

  // 楼层导航当前楼层：以「视口顶缘（+8px 容差）」所落在的用户消息为准——与
  // 跳转的 align:"start" 落位一致，跳转后高亮的必然是刚点的楼层；视口贴近
  // 内容底部时直接取最后一层（否则短对话拼满一屏时底部楼层永远无法成为当前
  // 层）。贴底判定用 scrollHeight（与 scrollTop/clientHeight 同一坐标系，
  // 含底部输入框保留区），避免与 getTotalSize 的列表局部坐标错位。
  const lastAnchorRef = useRef<string | null>(null);
  const onAnchorUserRowChangeRef = useRef(onAnchorUserRowChange);
  onAnchorUserRowChangeRef.current = onAnchorUserRowChange;
  const reportAnchorRef = useRef(() => {});
  reportAnchorRef.current = () => {
    const callback = onAnchorUserRowChangeRef.current;
    if (!callback || !scrollViewport) return;
    const rowList = rowsRef.current;
    let anchorKey: string | null = null;
    if (rowList.length > 0) {
      const scrollTop = scrollViewport.scrollTop;
      const viewportHeight = scrollViewport.clientHeight;
      const nearBottom = scrollTop + viewportHeight >= scrollViewport.scrollHeight - 32;
      let anchorIndex = -1;
      if (nearBottom) {
        anchorIndex = rowList.length - 1;
      } else {
        const anchorLine = scrollTop + 8;
        const items = virtualizer.getVirtualItems();
        for (const item of items) {
          if (item.start > anchorLine) break;
          anchorIndex = item.index;
        }
        if (anchorIndex === -1) anchorIndex = items[0]?.index ?? -1;
      }
      for (let i = Math.min(anchorIndex, rowList.length - 1); i >= 0; i--) {
        const row = rowList[i];
        if (row?.kind === "user") {
          anchorKey = row.key;
          break;
        }
      }
    }
    if (anchorKey !== lastAnchorRef.current) {
      lastAnchorRef.current = anchorKey;
      callback(anchorKey);
    }
  };

  useEffect(() => {
    if (!scrollViewport) return;
    const handler = () => reportAnchorRef.current();
    handler();
    scrollViewport.addEventListener("scroll", handler, { passive: true });
    return () => scrollViewport.removeEventListener("scroll", handler);
  }, [scrollViewport]);

  // 行集合变化（消息追加、流式落定）后兜底重算一次；依赖 rows 而不是每次
  // 渲染都跑，避免「上报 → 父级重渲染 → 再上报」的空转循环。
  useEffect(() => {
    rowsRef.current = rows;
    reportAnchorRef.current();
  }, [rows]);

  // First paint of a conversation lands at the bottom before the user sees
  // anything: scrollToEnd re-targets as dynamic measurements land, replacing
  // the old estimated-pin → measure → re-pin dance. The component remounts
  // per conversation (keyed by the parent), so this runs once per open.
  const scrollToEndOnceRef = useRef(false);
  useLayoutEffect(() => {
    if (scrollToEndOnceRef.current || scrollViewport === null || rows.length === 0) {
      return;
    }
    scrollToEndOnceRef.current = true;
    virtualizer.scrollToEnd();
  }, [scrollViewport, rows.length, virtualizer]);

  // First-layout settle watch: the transcript stays hidden (parent-gated)
  // until the initial scroll-to-end and its estimate→measure corrections
  // have converged — scroll offset and total size unchanged across two
  // frames — then reveals in one shot. Streaming conversations and empty
  // transcripts reveal immediately; a hard cap always reveals.
  const hasRows = rows.length > 0;
  const settledRef = useRef(false);
  const onFirstLayoutSettledRef = useRef(onFirstLayoutSettled);
  onFirstLayoutSettledRef.current = onFirstLayoutSettled;
  useLayoutEffect(() => {
    if (settledRef.current || scrollViewport === null) {
      return;
    }
    const settle = () => {
      settledRef.current = true;
      onFirstLayoutSettledRef.current?.();
    };
    if (!hasRows || isSending) {
      settle();
      return;
    }

    let stableFrames = 0;
    let previousTotalSize = -1;
    let previousScrollTop = -1;
    const startedAt = performance.now();
    let frame = requestAnimationFrame(function check() {
      const totalSize = virtualizer.getTotalSize();
      const scrollTop = scrollViewport.scrollTop;
      stableFrames =
        totalSize === previousTotalSize && scrollTop === previousScrollTop ? stableFrames + 1 : 0;
      previousTotalSize = totalSize;
      previousScrollTop = scrollTop;
      if (stableFrames >= 2 || performance.now() - startedAt > 800) {
        settle();
        return;
      }
      frame = requestAnimationFrame(check);
    });
    return () => cancelAnimationFrame(frame);
  }, [hasRows, isSending, scrollViewport, virtualizer]);

  // Snapshot measured heights for the next open of this conversation.
  const saveMeasurementsRef = useRef(() => {});
  saveMeasurementsRef.current = () => {
    if (!scrollViewport) return;
    transcriptMeasurementsLru.save(
      conversationId,
      scrollViewport.clientWidth,
      virtualizer.takeSnapshot(),
    );
  };
  useEffect(() => () => saveMeasurementsRef.current(), []);

  return (
    <AstryxStack
      direction="vertical"
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index];
        if (!row) return null;

        let body: ReactNode;
        if (row.kind === "summary") {
          body = <SummaryCard item={row.item} />;
        } else if (row.kind === "user") {
          body = (
            <AstryxStack direction="horizontal" className="flex justify-end">
              <UserMessageRow
                row={row}
                isEditing={editingMessageKey === row.key}
                animateEntrance={entranceRegistry.shouldAnimate(row.key)}
                workspaceRoot={workspaceRoot}
                loadCommitDetails={loadCommitDetails}
                onStartEdit={handleStartEdit}
                onCancelEdit={handleCancelEdit}
                onOpenFileLink={onOpenFileLink}
                onResendFromEdit={onResendFromEdit}
              />
            </AstryxStack>
          );
        } else if (row.kind === "assistant-activity") {
          body = (
            <AstryxStack direction="horizontal" className="flex justify-start">
              <AssistantActivityRow
                row={row}
                showUsage={showUsage}
                usageContextWindow={usageContextWindow}
                isAgentMode={isAgentMode}
                isCompactionRunning={isCompactionRunning}
                toolStatus={displayedToolStatus}
                retryAttempts={liveState.retryAttempts}
                workdir={workspaceRoot}
                onOpenFileLink={onOpenFileLink}
                onResendFromEdit={onResendFromEdit}
                onBranchConversation={onBranchConversation}
              />
            </AstryxStack>
          );
        } else {
          body = (
            <AstryxStack direction="horizontal" className="flex justify-start">
              <AssistantRenderUnit
                row={row}
                showUsage={showUsage}
                usageContextWindow={usageContextWindow}
                isAgentMode={isAgentMode}
                isCompactionRunning={row.mutable ? isCompactionRunning : false}
                toolStatus={row.mutable ? displayedToolStatus : null}
                retryAttempts={row.mutable ? liveState.retryAttempts : undefined}
                workdir={workspaceRoot}
                onOpenFileLink={onOpenFileLink}
                onResendFromEdit={onResendFromEdit}
                onBranchConversation={onBranchConversation}
              />
            </AstryxStack>
          );
        }

        return (
          <AstryxStack
            direction="vertical"
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 right-0 top-0"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {body}
            {row.gapAfter > 0 && virtualRow.index < rows.length - 1 ? (
              <AstryxStack
                direction="vertical"
                aria-hidden="true"
                style={{ height: row.gapAfter }}
              />
            ) : null}
          </AstryxStack>
        );
      })}
    </AstryxStack>
  );
});
