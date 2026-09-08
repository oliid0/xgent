import { AspectRatio } from "@astryxdesign/core/AspectRatio";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { ChatToolCalls } from "@astryxdesign/core/Chat";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AdaptiveDialog } from "../../../components/astryx/AdaptiveDialog";
import { Globe, Wrench } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { browserSessionController } from "../../../lib/browser/browserSessionController";
import type {
  LiveTranscriptState,
  LiveTranscriptStore,
} from "../../../lib/chat/conversation/liveTranscriptStore";
import { executionActivityStore } from "../../../lib/chat/executionActivityStore";
import {
  safeStringify,
  summarizeToolCall,
  type ToolTraceItem,
  toolResultMessageToText,
} from "../../../lib/chat/messages/uiMessages";

type MobileToolActivityProps = {
  conversationId: string;
  mobileExperience?: boolean;
  store: LiveTranscriptStore;
  open: boolean;
  onOpen: () => void;
  onOpenBrowser?: () => void;
  onClose: () => void;
  bottomOffsetPx: number;
};

type ActivityItem = ToolTraceItem & {
  running: boolean;
  round: number;
};

function subscribeNoop() {
  return () => {};
}

const EMPTY_TRANSCRIPT: LiveTranscriptState = {
  draftAssistantText: "",
  toolStatus: null,
  liveRounds: [],
  retryAttempts: [],
  isSettled: true,
};

function collectActivityItems(snapshot: LiveTranscriptState): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const round of snapshot.liveRounds) {
    const runningIds = new Set(round.runningToolCallIds);
    for (const block of round.blocks) {
      if (block.kind !== "tool") continue;
      items.push({
        ...block.item,
        running: runningIds.has(block.item.toolCall.id),
        round: round.round,
      });
    }
  }
  return items;
}

function activityKind(name: string): "shell" | "browser" | "cua" | "tool" {
  const normalized = name.toLowerCase();
  if (normalized.includes("cua") || normalized.includes("computer")) return "cua";
  if (
    normalized.includes("bash") ||
    normalized.includes("shell") ||
    normalized.includes("terminal")
  ) {
    return "shell";
  }
  if (
    normalized.includes("browser") ||
    normalized.includes("websearch") ||
    normalized.includes("web_search")
  ) {
    return "browser";
  }
  return "tool";
}

function toolOutput(item: ActivityItem) {
  if (!item.toolResult) return "";
  const output = toolResultMessageToText(item.toolResult);
  return output.trim();
}

function toolFailed(result: ToolResultMessage | undefined) {
  return Boolean(result && "isError" in result && result.isError);
}

export function MobileToolActivity({
  conversationId,
  mobileExperience = false,
  store,
  open,
  onOpen,
  onOpenBrowser,
  onClose,
  bottomOffsetPx,
}: MobileToolActivityProps) {
  const { t } = useLocale();
  const frames = useSyncExternalStore(
    executionActivityStore.subscribe,
    () => executionActivityStore.getSnapshot(conversationId),
    () => executionActivityStore.getSnapshot(conversationId),
  );
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const frameIndex = selectedFrameId
    ? frames.findIndex((frame) => frame.id === selectedFrameId)
    : -1;
  const selectedFrame = frameIndex >= 0 ? frames[frameIndex] : frames.at(-1);
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? subscribeNoop,
    store?.getSnapshot ?? (() => EMPTY_TRANSCRIPT),
    () => EMPTY_TRANSCRIPT,
  );
  const items = useMemo(() => collectActivityItems(snapshot), [snapshot]);
  const browserState = useSyncExternalStore(
    browserSessionController.subscribe,
    browserSessionController.getSnapshot,
    browserSessionController.getSnapshot,
  );
  const conversationSessions = browserSessionController.sessionsForConversation(conversationId);
  const activeBrowserSession =
    conversationSessions.find((session) =>
      browserState.busySessionIds.includes(session.sessionId),
    ) ??
    conversationSessions.find((session) => session.sessionId === browserState.activeSessionId) ??
    conversationSessions.at(-1);
  const activeBrowserSessionId = activeBrowserSession?.sessionId;
  const activeItem = [...items].reverse().find((item) => item.running) ?? null;
  const hasActiveItem = Boolean(activeItem);
  const latestItem = items.at(-1) ?? null;
  const capsuleItem = activeItem;
  const status = snapshot.toolStatus?.trim() || "";
  const capsuleKind = capsuleItem
    ? activityKind(capsuleItem.toolCall.name)
    : (frames.at(-1)?.kind ?? "tool");
  const capsuleTitle =
    capsuleKind === "browser" && activeBrowserSession
      ? activeBrowserSession.title?.trim() || activeBrowserSession.url
      : capsuleItem?.toolCall.name || frames.at(-1)?.title || t("chat.mobileActivity.working");
  const capsuleDetail = capsuleItem
    ? summarizeToolCall(capsuleItem.toolCall, { includeName: false }) || status
    : status;
  const browserPreview = activeBrowserSession
    ? browserState.previewDataUrls[activeBrowserSession.sessionId]
    : undefined;
  const assistanceActive =
    browserState.humanAssistance?.sessionId === activeBrowserSession?.sessionId;

  useEffect(() => {
    if (capsuleKind !== "browser" || !activeBrowserSessionId || (!hasActiveItem && !open)) return;
    let disposed = false;
    let timer: number | undefined;
    const capture = async () => {
      if (document.visibilityState === "visible") {
        await browserSessionController
          .captureSessionPreview(activeBrowserSessionId)
          .catch(() => undefined);
      }
      if (!disposed) timer = window.setTimeout(capture, open ? 1_000 : 3_000);
    };
    void capture();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeBrowserSessionId, capsuleKind, hasActiveItem, open]);
  useEffect(() => {
    if (!open) return;
    browserSessionController.setSurfaceOccluded(true);
    return () => browserSessionController.setSurfaceOccluded(false);
  }, [open]);
  useEffect(() => {
    if (capsuleKind !== "browser" || !browserPreview || !activeBrowserSession) return;
    executionActivityStore.record(conversationId, {
      id: `browser:${activeBrowserSession.sessionId}:${activeItem?.toolCall.id ?? "view"}`,
      kind: "browser",
      title: activeBrowserSession.url,
      text: capsuleDetail,
      imageUrl: browserPreview,
      status: activeItem ? "running" : "complete",
    });
  }, [
    conversationId,
    capsuleKind,
    browserPreview,
    activeBrowserSession,
    activeItem,
    capsuleDetail,
  ]);
  const toolCalls = [...items].reverse().map((item) => {
    const output = toolOutput(item);
    const failed = toolFailed(item.toolResult);
    return {
      key: item.toolCall.id,
      name: item.toolCall.name,
      target:
        summarizeToolCall(item.toolCall, { includeName: false }) ||
        t("chat.mobileActivity.noArguments"),
      node: t("chat.mobileActivity.round").replace("{round}", String(item.round)),
      status: item.running
        ? ("running" as const)
        : failed
          ? ("error" as const)
          : ("complete" as const),
      errorMessage: failed && output ? output : undefined,
      resultDetail: (
        <VStack gap={3}>
          <Text type="label" color="secondary">
            {t("chat.mobileActivity.input")}
          </Text>
          <CodeBlock
            code={safeStringify(item.toolCall.arguments || {})}
            language="json"
            size="sm"
            width="100%"
            maxHeight="var(--xgent-tool-input-max-height)"
            isWrapped
            container="section"
          />
          {output ? (
            <>
              <Text type="label" color="secondary">
                {t("chat.mobileActivity.output")}
              </Text>
              <CodeBlock
                code={output}
                language="plaintext"
                size="sm"
                width="100%"
                maxHeight="var(--xgent-tool-output-max-height)"
                isWrapped
                container="section"
              />
            </>
          ) : null}
        </VStack>
      ),
    };
  });

  return (
    <>
      {capsuleItem || status || frames.length > 0 ? (
        <HStack
          hAlign="start"
          width="100%"
          paddingInline={5}
          className="pointer-events-none absolute inset-x-0 z-30"
          style={{ bottom: `calc(${Math.max(0, bottomOffsetPx)}px + var(--spacing-2))` }}
        >
          <Button
            label={capsuleTitle}
            tooltip={capsuleDetail || capsuleTitle}
            variant="secondary"
            size="sm"
            elevation="high"
            width="fit-content"
            onClick={() => {
              setSelectedFrameId(null);
              onOpen();
            }}
            className="xgent-mobile-browser-activity-button pointer-events-auto"
          >
            <HStack gap={2} vAlign="center" width="100%">
              <AspectRatio ratio={100 / 65} fit="cover">
                {(capsuleKind === "browser" ? browserPreview : frames.at(-1)?.imageUrl) ? (
                  <img
                    src={capsuleKind === "browser" ? browserPreview : frames.at(-1)?.imageUrl}
                    alt=""
                  />
                ) : (
                  <VStack width="100%" height="100%" hAlign="center" vAlign="center">
                    <Icon icon={Globe} size="md" color="secondary" />
                  </VStack>
                )}
              </AspectRatio>
              <VStack gap={0} hAlign="start" style={{ minWidth: 0 }}>
                <Text type="label" textWrap="nowrap" maxLines={1}>
                  {activeItem ? t("chat.mobileActivity.working") : t("chat.mobileActivity.recent")}
                </Text>
                <Text type="supporting" color="secondary" textWrap="nowrap" maxLines={1}>
                  {assistanceActive ? t("browser.assistanceActive") : capsuleDetail || capsuleTitle}
                </Text>
              </VStack>
            </HStack>
          </Button>
        </HStack>
      ) : null}

      <AdaptiveDialog
        isOpen={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
        title={t("chat.mobileActivity.title")}
        subtitle={activeItem ? t("chat.mobileActivity.running") : t("chat.mobileActivity.recent")}
        purpose="info"
        presentation={mobileExperience ? "fullscreen" : "dialog"}
        width="min(70rem, calc(100dvw - var(--spacing-8)))"
        maxHeight="90dvh"
      >
        <VStack gap={4}>
          {selectedFrame ? (
            <VStack gap={3} width="100%">
              <Text type="label" maxLines={2}>
                {selectedFrame.title}
              </Text>
              {selectedFrame.imageUrl ? (
                <AspectRatio ratio={4 / 3} fit="contain">
                  <img src={selectedFrame.imageUrl} alt={selectedFrame.title} />
                </AspectRatio>
              ) : null}
              {selectedFrame.text ? (
                <CodeBlock
                  code={selectedFrame.text}
                  language="plaintext"
                  size="sm"
                  width="100%"
                  maxHeight="45dvh"
                  isWrapped
                  container="section"
                />
              ) : selectedFrame.status === "running" ? (
                <Text color="secondary">{t("chat.mobileActivity.running")}</Text>
              ) : null}
              <HStack gap={2} width="100%" vAlign="center">
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, frames.length - 1)}
                  value={frameIndex >= 0 ? frameIndex : Math.max(0, frames.length - 1)}
                  aria-label={t("chat.mobileActivity.recent")}
                  onChange={(event) =>
                    setSelectedFrameId(frames[Number(event.target.value)]?.id ?? null)
                  }
                  style={{ flex: 1, minWidth: 0 }}
                />
                <Button
                  label={t("chat.mobileActivity.live")}
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedFrameId(null)}
                />
                <Text type="supporting" color="secondary">
                  {new Date(selectedFrame.updatedAt).toLocaleTimeString()}
                </Text>
              </HStack>
              {selectedFrame.kind === "browser" && onOpenBrowser ? (
                <Button
                  label={t("browser.title")}
                  size="sm"
                  variant="secondary"
                  onClick={onOpenBrowser}
                />
              ) : null}
            </VStack>
          ) : null}
          {toolCalls.length > 0 ? (
            <ChatToolCalls
              calls={toolCalls}
              label={t("chat.mobileActivity.title")}
              defaultIsExpanded
            />
          ) : (
            <EmptyState
              icon={<Wrench />}
              title={t("chat.mobileActivity.empty")}
              description={t("chat.mobileActivity.emptyDescription")}
            />
          )}
          {!activeItem && latestItem && status ? (
            <Banner status="info" title={status} collapsible={false} />
          ) : null}
        </VStack>
      </AdaptiveDialog>
    </>
  );
}
