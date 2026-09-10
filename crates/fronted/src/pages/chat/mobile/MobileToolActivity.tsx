import { AspectRatio } from "@astryxdesign/core/AspectRatio";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { invoke } from "@xgent/runtime";
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ImagePreviewPanel } from "../../../components/chat/ImagePreview";
import { ArrowLeft, Globe, MonitorSmartphone, Terminal, Wrench } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { browserSessionController } from "../../../lib/browser/browserSessionController";
import { collectActivityItems } from "../../../lib/chat/activityTimeline";
import type { RenderTimelineItem } from "../../../lib/chat/conversation/conversationState";
import type {
  LiveTranscriptState,
  LiveTranscriptStore,
} from "../../../lib/chat/conversation/liveTranscriptStore";
import {
  activityObservation,
  executionActivityStore,
  recordShellActivity,
  type ShellActivityResponse,
} from "../../../lib/chat/executionActivityStore";
import { imageActivitySelection } from "../../../lib/chat/imageActivityNavigation";
import { summarizeToolCall, toolResultMessageToText } from "../../../lib/chat/messages/uiMessages";
import { toolActivitySelection, toolStepLabel } from "../../../lib/chat/toolActivityNavigation";
import { ToolCallDetail } from "../components/assistant-bubble/ToolCallItem";
import { ActivityTerminal } from "./ActivityTerminal";

type MobileToolActivityProps = {
  conversationId: string;
  mobileExperience?: boolean;
  store: LiveTranscriptStore;
  historyItems: readonly RenderTimelineItem[];
  open: boolean;
  onOpen: () => void;
  onOpenBrowser?: () => void;
  onClose: () => void;
  view?: "capsule" | "panel";
  progressContent?: ReactNode;
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

function activityKind(name: string): "shell" | "browser" | "cua" | "tool" {
  const normalized = name.toLowerCase();
  if (normalized.includes("cua") || normalized.includes("computer")) return "cua";
  if (
    normalized.includes("bash") ||
    normalized.includes("shell") ||
    normalized.includes("terminal") ||
    normalized.includes("process")
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

export function MobileToolActivity({
  conversationId,
  mobileExperience = false,
  store,
  historyItems,
  open,
  onOpen,
  onOpenBrowser,
  onClose,
  view = "capsule",
  progressContent,
}: MobileToolActivityProps) {
  const { t } = useLocale();
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (view !== "panel" || !open || !mobileExperience) return;
    const previous = document.activeElement;
    panelRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [view, open, mobileExperience]);
  const frames = useSyncExternalStore(
    executionActivityStore.subscribe,
    () => executionActivityStore.getSnapshot(conversationId),
    () => executionActivityStore.getSnapshot(conversationId),
  );
  const imageSelection = useSyncExternalStore(
    imageActivitySelection.subscribe,
    () => imageActivitySelection.get(conversationId),
    () => null,
  );
  const selection = useSyncExternalStore(
    toolActivitySelection.subscribe,
    () => toolActivitySelection.get(conversationId),
    () => null,
  );
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  useEffect(() => {
    if (selection) setSelectedFrameId(null);
  }, [selection]);
  const frameIndex = selectedFrameId
    ? frames.findIndex((frame) => frame.id === selectedFrameId)
    : -1;
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? subscribeNoop,
    store?.getSnapshot ?? (() => EMPTY_TRANSCRIPT),
    () => EMPTY_TRANSCRIPT,
  );
  const items = useMemo(
    () => collectActivityItems(historyItems, snapshot),
    [historyItems, snapshot],
  );
  useEffect(() => {
    const current = selection && items.find((item) => item.toolCall.id === selection.toolCall.id);
    if (current && current.toolResult !== selection?.toolResult)
      toolActivitySelection.select(conversationId, current);
  }, [conversationId, items, selection]);
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
  const capsuleItem = activeItem ?? latestItem;
  const selectedItem = selectedFrameId
    ? null
    : selection
      ? (items.find((item) => item.toolCall.id === selection.toolCall.id) ?? selection)
      : (activeItem ?? latestItem);
  const recordedFrame =
    frameIndex >= 0
      ? frames[frameIndex]
      : !selection && activeItem
        ? [...frames]
            .reverse()
            .find(
              (frame) =>
                frame.toolCallId === activeItem.toolCall.id ||
                (frame.kind === "cua" && frame.id.startsWith("monitor:")),
            )
        : selectedItem
          ? [...frames].reverse().find((frame) => frame.toolCallId === selectedItem.toolCall.id)
          : frames.at(-1);
  const selectedFrame =
    recordedFrame ??
    (selectedItem?.toolResult
      ? {
          id: selectedItem.toolCall.id,
          kind: activityKind(selectedItem.toolCall.name),
          title: selectedItem.toolCall.name,
          app: undefined,
          previewError: undefined,
          updatedAt: selectedItem.toolResult.timestamp,
          ...activityObservation(selectedItem.toolResult.content),
        }
      : undefined);
  const selectedRunning = selectedItem
    ? items.some((item) => item.toolCall.id === selectedItem.toolCall.id && item.running)
    : false;
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
  const previewTarget = [...frames]
    .reverse()
    .find((frame) => frame.kind === "cua" && frame.app)?.app;
  const monitoring = open || !snapshot.isSettled;
  const selectedKind =
    selectedFrame?.kind ?? (selectedItem ? activityKind(selectedItem.toolCall.name) : "tool");
  const shellDetails = selectedItem?.toolResult?.details as Record<string, unknown> | undefined;
  const shellOutput =
    selectedFrame?.text ??
    (Array.isArray(shellDetails?.output)
      ? shellDetails.output.map((chunk: { text?: string }) => chunk.text ?? "").join("")
      : shellDetails && typeof shellDetails.stdout === "string"
        ? `${shellDetails.stdout}${shellDetails.stderr ?? ""}`
        : selectedItem?.toolResult
          ? toolResultMessageToText(selectedItem.toolResult)
          : "");
  const shellCommand =
    selectedFrame?.title ??
    String(selectedItem?.toolCall.arguments?.command ?? selectedItem?.toolCall.name ?? "");
  const shellSessionId = [...frames].reverse().find((frame) => frame.kind === "shell")?.sessionId;
  useEffect(() => {
    if (view !== "capsule" || !monitoring || !shellSessionId) return;
    let disposed = false;
    let cursor = 0;
    let timer: number | undefined;
    let failures = 0;
    const read = async () => {
      try {
        const response = await invoke<ShellActivityResponse>("shell_session_wait", {
          session_id: shellSessionId,
          cursor,
          yield_time_ms: 5000,
        });
        if (disposed) return;
        recordShellActivity(conversationId, response);
        cursor = response.cursor;
        failures = 0;
        if (response.status !== "running" && !response.has_more) return;
      } catch {
        if (disposed || ++failures >= 10) return;
      }
      if (!disposed) timer = window.setTimeout(read, 500);
    };
    void read();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [conversationId, view, monitoring, shellSessionId]);
  useEffect(() => {
    if (view !== "capsule" || !previewTarget || !monitoring || capsuleKind !== "cua") return;
    let disposed = false;
    let timer: number | undefined;
    const capture = async () => {
      let delay = open ? 500 : 1000;
      if (document.visibilityState === "visible") {
        try {
          const result = await invoke<{ content: unknown[]; isError: boolean }>("cua_preview", {
            target: previewTarget,
            max_image_size: open ? 1280 : 640,
          });
          if (disposed) return;
          const observation = activityObservation(result.content);
          if (result.isError || !observation.imageUrl)
            throw new Error(observation.text || "Preview unavailable");
          executionActivityStore.record(conversationId, {
            id: `monitor:${previewTarget}`,
            kind: "cua",
            app: previewTarget,
            title: previewTarget,
            text: "",
            imageUrl: observation.imageUrl,
            status: snapshot.isSettled ? "complete" : "running",
          });
        } catch (error) {
          if (disposed) return;
          const id = `monitor:${previewTarget}`;
          const previous = executionActivityStore
            .getSnapshot(conversationId)
            .find((frame) => frame.id === id);
          executionActivityStore.record(conversationId, {
            ...previous,
            id,
            kind: "cua",
            app: previewTarget,
            title: previewTarget,
            text: "",
            previewError: String(error),
            status: "error",
          });
          delay = 4000;
        }
      }
      if (!disposed) timer = window.setTimeout(capture, delay);
    };
    void capture();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [conversationId, previewTarget, monitoring, open, view, capsuleKind, snapshot.isSettled]);

  useEffect(() => {
    if (
      view !== "capsule" ||
      capsuleKind !== "browser" ||
      !activeBrowserSessionId ||
      (!hasActiveItem && !open)
    )
      return;
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
  }, [activeBrowserSessionId, capsuleKind, hasActiveItem, open, view]);
  useEffect(() => {
    if (!open || view !== "panel") return;
    browserSessionController.setSurfaceOccluded(true);
    return () => browserSessionController.setSurfaceOccluded(false);
  }, [open, view]);
  useEffect(() => {
    if (view !== "capsule" || capsuleKind !== "browser" || !browserPreview || !activeBrowserSession)
      return;
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
    view,
  ]);

  return (
    <>
      {view === "capsule" &&
      !open &&
      (progressContent || capsuleItem || status || frames.length > 0) ? (
        <HStack hAlign="start" width="100%" paddingInline={5} className="xgent-activity-strip">
          <Button
            label={capsuleTitle}
            tooltip={t("chat.activity.title")}
            variant="ghost"
            size="sm"
            width="fit-content"
            onClick={() => {
              setSelectedFrameId(null);
              imageActivitySelection.select(conversationId, null);
              toolActivitySelection.select(conversationId, null);
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
                    <Icon
                      icon={
                        capsuleKind === "shell"
                          ? Terminal
                          : capsuleKind === "browser"
                            ? Globe
                            : MonitorSmartphone
                      }
                      size="md"
                      color="secondary"
                    />
                  </VStack>
                )}
              </AspectRatio>
            </HStack>
          </Button>
          <div className="xgent-activity-progress">{progressContent}</div>
        </HStack>
      ) : null}

      {view === "panel" && open && imageSelection ? (
        <section
          ref={panelRef}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              imageActivitySelection.select(conversationId, null);
              onClose();
            }
          }}
          className={
            mobileExperience ? "xgent-activity-panel xgent-activity-page" : "xgent-activity-panel"
          }
          aria-label={t("chat.image.preview")}
        >
          <ImagePreviewPanel
            key={imageSelection.slides[0]?.src}
            open
            slides={imageSelection.slides}
            index={imageSelection.index}
            onClose={() => {
              imageActivitySelection.select(conversationId, null);
              onClose();
            }}
          />
        </section>
      ) : view === "panel" && open ? (
        <VStack
          as="section"
          ref={panelRef}
          tabIndex={-1}
          aria-label={t("chat.mobileActivity.title")}
          role={mobileExperience ? "dialog" : undefined}
          aria-modal={mobileExperience ? true : undefined}
          className={
            mobileExperience ? "xgent-activity-panel xgent-activity-page" : "xgent-activity-panel"
          }
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onClose();
            }
          }}
        >
          <HStack gap={3} padding={3} vAlign="center" className="xgent-activity-header">
            {mobileExperience ? (
              <Button label={t("browser.back")} variant="ghost" size="sm" onClick={onClose}>
                <Icon icon={ArrowLeft} size="sm" />
              </Button>
            ) : null}
            <VStack gap={0} style={{ minWidth: 0, flex: "1 1 0" }}>
              <Text type="label">{t("chat.activity.title")}</Text>
              <Text type="supporting" color="secondary" maxLines={1} hasTruncateTooltip={false}>
                {assistanceActive
                  ? t("browser.assistanceActive")
                  : selectedItem
                    ? toolStepLabel(selectedItem, selectedItem.toolCall.name).slice(0, 100)
                    : (capsuleDetail || capsuleTitle).slice(0, 100)}
              </Text>
              {progressContent}
            </VStack>
          </HStack>
          <VStack gap={4} padding={3} className="xgent-activity-content">
            {selectedFrame?.previewError ? (
              <Banner status="warning" title={selectedFrame.previewError} />
            ) : null}
            {selectedKind === "shell" ? (
              <ActivityTerminal
                key={selectedFrame?.id ?? selectedItem?.toolCall.id}
                command={shellCommand}
                output={shellOutput}
              />
            ) : null}
            {selectedFrame ? (
              <VStack gap={3} width="100%" style={{ flexShrink: 0 }}>
                {selectedFrame.imageUrl ? (
                  <img
                    className="xgent-activity-screen"
                    src={selectedFrame.imageUrl}
                    alt={selectedFrame.app ?? selectedFrame.title}
                  />
                ) : selectedFrame.kind !== "shell" ? (
                  <Text type="supporting" color="secondary">
                    {t("chat.mobileActivity.awaitingResult")}
                  </Text>
                ) : null}
                {frames.length > 1 && items.length === 0 ? (
                  <HStack gap={2} width="100%" vAlign="center">
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, frames.length - 1)}
                      value={frameIndex >= 0 ? frameIndex : Math.max(0, frames.length - 1)}
                      aria-label={t("chat.mobileActivity.recent")}
                      onChange={(event) => {
                        toolActivitySelection.select(conversationId, null);
                        setSelectedFrameId(frames[Number(event.target.value)]?.id ?? null);
                      }}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <Button
                      label={t("chat.mobileActivity.live")}
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSelectedFrameId(null);
                        toolActivitySelection.select(conversationId, null);
                      }}
                    />
                    <Text type="supporting" color="secondary">
                      {new Date(selectedFrame.updatedAt).toLocaleTimeString()}
                    </Text>
                  </HStack>
                ) : null}
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
            {selectedItem ? (
              <VStack gap={3} width="100%">
                <Collapsible
                  defaultIsOpen={selectedKind === "tool"}
                  trigger={
                    <Text type="supporting" color="secondary">
                      {selectedItem.toolCall.name}
                    </Text>
                  }
                >
                  <ToolCallDetail
                    key={selectedItem.toolCall.id}
                    item={selectedItem}
                    isRunning={selectedRunning}
                    expanded
                  />
                </Collapsible>
                {!selectedItem.toolResult ? (
                  <Text color="secondary">
                    {t(
                      selectedRunning
                        ? "chat.mobileActivity.running"
                        : "chat.mobileActivity.awaitingResult",
                    )}
                  </Text>
                ) : null}
              </VStack>
            ) : !selectedFrame ? (
              <EmptyState
                icon={<Wrench />}
                title={t("chat.mobileActivity.empty")}
                description={t("chat.mobileActivity.emptyDescription")}
              />
            ) : null}
            {items.length > 0 ? (
              <HStack gap={2} width="100%" vAlign="center">
                <input
                  type="range"
                  min={0}
                  max={items.length - 1}
                  value={Math.max(
                    0,
                    items.findIndex((item) => item.toolCall.id === selectedItem?.toolCall.id),
                  )}
                  aria-label={t("chat.mobileActivity.recent")}
                  aria-valuetext={
                    selectedItem
                      ? toolStepLabel(selectedItem, selectedItem.toolCall.name)
                      : undefined
                  }
                  onChange={(event) => {
                    setSelectedFrameId(null);
                    toolActivitySelection.select(
                      conversationId,
                      items[Number(event.target.value)] ?? null,
                    );
                  }}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <Button
                  label={t("chat.mobileActivity.live")}
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelectedFrameId(null);
                    toolActivitySelection.select(conversationId, null);
                  }}
                />
              </HStack>
            ) : null}
            {!activeItem && latestItem && status ? (
              <Banner status="info" title={status} collapsible={false} />
            ) : null}
          </VStack>
        </VStack>
      ) : null}
    </>
  );
}
