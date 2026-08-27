import { ChatComposer, ChatComposerDrawer, ChatSendButton } from "@astryxdesign/core/Chat";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { Token } from "@astryxdesign/core/Token";
import {
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  MentionComposer,
  type MentionComposerHandle,
  type MentionComposerSkill,
} from "../../../components/chat/MentionComposer";
import { GitBranchSelector } from "../../../components/git/GitBranchSelector";
import {
  ChevronUp,
  Clock3,
  Globe,
  GlobeOff,
  Lightbulb,
  LightbulbOff,
  Loader2,
  Maximize2,
  Mic,
  Minimize2,
  Paperclip,
  Play,
  Plus,
  Sparkle,
  SquarePen,
  Trash2,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type { PendingUploadedFile } from "../../../lib/chat/messages/uploadedFiles";
import type { GitClient } from "../../../lib/git/types";
import {
  checkMobileAssistantPermissions,
  mobileAssistantStatus,
  requestMobileAssistantPermission,
  startMobileVoiceInput,
} from "../../../lib/mobileAssistant";
import type { ModelOption } from "../../../lib/providers/llm";
import { isNativeMobileRuntime } from "../../../lib/runtimePlatform";
import {
  type ChatRuntimeControls,
  DEFAULT_CHAT_RUNTIME_CONTROLS,
  type ReasoningLevel,
  type SelectedModel,
  type SttSettings,
} from "../../../lib/settings";
import { cn } from "../../../lib/shared/utils";
import {
  type DesktopSttCapture,
  startDesktopSttCapture,
} from "../../../lib/stt/desktopAudioCapture";
import type { WorkspaceActivityClient } from "../../../lib/workspace-activity/types";
import { ChatModelSelector } from "./ChatModelSelector";

const REASONING_I18N_KEYS: Record<ReasoningLevel, string> = {
  off: "settings.reasoning.off",
  minimal: "settings.reasoning.minimal",
  low: "settings.reasoning.low",
  medium: "settings.reasoning.medium",
  high: "settings.reasoning.high",
  xhigh: "settings.reasoning.xhigh",
  max: "settings.reasoning.max",
};

function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === "string" && Object.hasOwn(REASONING_I18N_KEYS, value);
}

export type ContextUsageTokensSource = {
  subscribe: (listener: () => void) => () => void;
  getContextUsageTokens: () => number | undefined;
};

function formatCompactTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return String(value);
}

function ContextUsageIndicator(props: {
  source: ContextUsageTokensSource;
  contextWindow?: number;
  onManualCompact?: () => void;
  manualCompactionDisabled?: boolean;
}) {
  const { t } = useLocale();
  const tokens = useSyncExternalStore(
    props.source.subscribe,
    props.source.getContextUsageTokens,
    props.source.getContextUsageTokens,
  );
  const contextWindow =
    typeof props.contextWindow === "number" && Number.isFinite(props.contextWindow)
      ? Math.max(0, Math.floor(props.contextWindow))
      : 0;
  if (tokens === undefined || tokens <= 0 || contextWindow <= 0) return null;

  const ratio = Math.min(1, Math.max(0, tokens / contextWindow));
  const percent = Math.round(ratio * 100);
  const variant = ratio >= 0.9 ? "error" : ratio >= 0.7 ? "warning" : "success";
  const usageLabel = `${t("chat.contextUsage")}: ${formatCompactTokens(tokens)} / ${formatCompactTokens(contextWindow)} tokens (${percent}%)`;
  const label = props.onManualCompact ? `${usageLabel} · ${t("chat.manualCompact")}` : usageLabel;

  return (
    <HStack gap={1} vAlign="center" width="var(--xagent-context-progress-width)">
      <VStack width="100%">
        <ProgressBar
          label={usageLabel}
          value={tokens}
          max={contextWindow}
          variant={variant}
          isLabelHidden
          hasValueLabel
          formatValueLabel={() => `${percent}%`}
        />
      </VStack>
      {props.onManualCompact ? (
        <IconButton
          label={label}
          tooltip={label}
          icon={<Sparkle />}
          variant="ghost"
          size="sm"
          isDisabled={props.manualCompactionDisabled}
          onClick={props.onManualCompact}
        />
      ) : null}
    </HStack>
  );
}

export type ChatQueueTurnPreview = {
  id: string;
  previewText: string;
  fileCount: number;
};

const COMPOSER_EXPAND_ANIMATION_MS = 280;
const COMPOSER_EXPAND_EASING = "cubic-bezier(0.32, 0.72, 0.22, 1)";

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export const ChatComposerBar = memo(function ChatComposerBar(props: {
  conversationId: string;
  composerRef: RefObject<MentionComposerHandle | null>;
  isSending: boolean;
  isUploadingFiles: boolean;
  isInputDisabled: boolean;
  inputPlaceholder: string;
  workdir: string;
  enabledSkills: MentionComposerSkill[];
  isAgentMode: boolean;
  hasModels: boolean;
  currentModelLabel: string;
  modelOptions: ModelOption[];
  selectedValue?: string;
  chatRuntimeControls: ChatRuntimeControls;
  reasoningOptions: ReasoningLevel[];
  thinkingAlwaysOn: boolean;
  contextUsageTokensSource?: ContextUsageTokensSource;
  contextWindow?: number;
  sttSettings?: SttSettings;
  gitClient?: GitClient | null;
  gitWriteEnabled?: boolean;
  gitDisabledMessage?: string;
  workspaceActivityClient?: WorkspaceActivityClient | null;
  onManualCompact?: () => void;
  manualCompactionDisabled?: boolean;
  onSend: () => void;
  onStop: () => void;
  onComposerBusyChange: (isBusy: boolean) => void;
  onSelectModel: (selection: SelectedModel) => void;
  onChatRuntimeControlsChange: (patch: Partial<ChatRuntimeControls>) => void;
  onPickReadableFiles: () => void;
  onPasteFiles: (files: File[]) => void;
  /** Prompts previously sent in this conversation for ↑/↓ recall. */
  loadHistoryPrompts?: () => readonly string[];
  pendingUploadedFiles: PendingUploadedFile[];
  onRemovePendingUpload: (relativePath: string) => void;
  queuedTurns: ChatQueueTurnPreview[];
  onRunQueuedTurnNow: (id: string) => void;
  onMoveQueuedTurnUp: (id: string) => void;
  onEditQueuedTurn: (id: string) => void;
  onRemoveQueuedTurn: (id: string) => void;
  onHeightChange?: (height: number) => void;
  mobileExperience?: boolean;
}) {
  const {
    conversationId,
    composerRef,
    isSending,
    isUploadingFiles,
    isInputDisabled,
    inputPlaceholder,
    workdir,
    enabledSkills,
    isAgentMode,
    hasModels,
    currentModelLabel,
    modelOptions,
    selectedValue,
    chatRuntimeControls,
    reasoningOptions,
    thinkingAlwaysOn,
    contextUsageTokensSource,
    contextWindow,
    sttSettings,
    gitClient,
    gitWriteEnabled = true,
    gitDisabledMessage,
    workspaceActivityClient,
    onManualCompact,
    manualCompactionDisabled,
    onSend,
    onStop,
    onComposerBusyChange,
    onSelectModel,
    onChatRuntimeControlsChange,
    onPickReadableFiles,
    onPasteFiles,
    loadHistoryPrompts,
    pendingUploadedFiles,
    onRemovePendingUpload,
    queuedTurns,
    onRunQueuedTurnNow,
    onMoveQueuedTurnUp,
    onEditQueuedTurn,
    onRemoveQueuedTurn,
    onHeightChange,
    mobileExperience = false,
  } = props;
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const queuePanelRef = useRef<HTMLDivElement | null>(null);
  const queueHadTurnsRef = useRef(false);
  const [composerIsEmpty, setComposerIsEmpty] = useState(true);
  const [isComposerExpanded, setIsComposerExpanded] = useState(false);
  const isComposerExpandedRef = useRef(false);
  const glassCardRef = useRef<HTMLDivElement | null>(null);
  /** 切换瞬间记录的卡片旧高度，供 FLIP 动画用；消费后立即置空。 */
  const expandFromHeightRef = useRef<number | null>(null);
  const expandAnimationRef = useRef<Animation | null>(null);
  const scheduleHeightMeasureRef = useRef<(() => void) | null>(null);
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [voiceInputAvailable, setVoiceInputAvailable] = useState(false);
  const [voiceInputActive, setVoiceInputActive] = useState(false);
  const [voiceInputError, setVoiceInputError] = useState<string | null>(null);
  const [voiceInputPartial, setVoiceInputPartial] = useState<string | null>(null);
  const desktopSttCaptureRef = useRef<DesktopSttCapture | null>(null);
  const uploadDisabled = isInputDisabled || isUploadingFiles || !isAgentMode || !workdir;
  const controlsDisabled = isInputDisabled;
  const hasSendableDraft = !composerIsEmpty || pendingUploadedFiles.length > 0;
  const thinkingSupported = reasoningOptions.length > 0;
  const sendDisabled = isInputDisabled || isUploadingFiles || !hasSendableDraft;
  const canQueueDraftWhileSending = isSending && !sendDisabled;
  const selectedReasoning = reasoningOptions.includes(chatRuntimeControls.reasoning)
    ? chatRuntimeControls.reasoning
    : DEFAULT_CHAT_RUNTIME_CONTROLS.reasoning;
  const uploadTooltip = isUploadingFiles
    ? t("chat.upload.uploading")
    : !isAgentMode
      ? t("chat.upload.onlyInTools")
      : !workdir
        ? t("chat.upload.requireWorkdir")
        : t("chat.upload.button");
  const addMenuTooltip = t("chat.upload.add");
  const thinkingTooltip = !thinkingSupported
    ? t("chat.runtime.thinkingUnavailable")
    : t("chat.runtime.thinkingTooltip");
  const webSearchTooltip = t("chat.runtime.webSearchTooltip");

  useEffect(() => {
    if (!isNativeMobileRuntime()) {
      setVoiceInputAvailable(sttSettings?.enabled === true);
      return;
    }
    let active = true;
    void mobileAssistantStatus()
      .then((status) => {
        if (active) setVoiceInputAvailable(status.available && status.voiceInputAvailable);
      })
      .catch(() => {
        if (active) setVoiceInputAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [sttSettings?.enabled]);

  useEffect(
    () => () => {
      void desktopSttCaptureRef.current?.cancel();
      desktopSttCaptureRef.current = null;
    },
    [],
  );

  const startVoiceInput = useCallback(async () => {
    if (isInputDisabled) return;
    if (!isNativeMobileRuntime() && voiceInputActive) {
      const capture = desktopSttCaptureRef.current;
      desktopSttCaptureRef.current = null;
      setVoiceInputPartial(null);
      try {
        await capture?.stop();
      } catch (error) {
        setVoiceInputError(error instanceof Error ? error.message : String(error));
        setVoiceInputActive(false);
      }
      return;
    }
    if (voiceInputActive) return;
    setVoiceInputError(null);
    setVoiceInputPartial(null);
    setVoiceInputActive(true);
    try {
      if (!isNativeMobileRuntime()) {
        if (!sttSettings?.enabled) throw new Error(t("chat.composer.voiceNotConfigured"));
        const insertFinalText = (text: string) => {
          const composer = composerRef.current;
          const prefix = composer?.hasContent() ? " " : "";
          composer?.insertText(`${prefix}${text}`);
          composer?.focus();
          setVoiceInputPartial(null);
        };
        desktopSttCaptureRef.current = await startDesktopSttCapture({
          provider: sttSettings.provider,
          onPartial: (text) => setVoiceInputPartial(text.trim() || null),
          onFinal: insertFinalText,
          onError: (message) => setVoiceInputError(message),
          onClosed: () => {
            desktopSttCaptureRef.current = null;
            setVoiceInputActive(false);
            setVoiceInputPartial(null);
          },
        });
        return;
      }
      let permissions = await checkMobileAssistantPermissions();
      if (permissions.microphone !== "granted") {
        permissions = await requestMobileAssistantPermission("microphone");
      }
      if (permissions.microphone !== "granted") {
        throw new Error(t("chat.composer.voicePermissionRequired"));
      }
      const result = await startMobileVoiceInput();
      const text = result.text.trim();
      if (text) {
        const composer = composerRef.current;
        const prefix = composer?.hasContent() ? " " : "";
        composer?.insertText(`${prefix}${text}`);
        composer?.focus();
      }
    } catch (error) {
      setVoiceInputError(error instanceof Error ? error.message : String(error));
      setVoiceInputActive(false);
    } finally {
      if (isNativeMobileRuntime()) setVoiceInputActive(false);
    }
  }, [composerRef, isInputDisabled, sttSettings, t, voiceInputActive]);
  const toggleComposerExpandTooltip = isComposerExpanded
    ? t("chat.composer.collapse")
    : t("chat.composer.expand");

  // ref 与 state 同步更新：高度上报的 RO/rAF 回调可能先于 effect 执行，
  // 必须在布局变化前就能读到最新展开态。切换前记录卡片当前高度，
  // 布局翻转后由 FLIP effect 从旧高度平滑过渡到新高度。
  const setComposerExpanded = useCallback((next: boolean) => {
    if (next === isComposerExpandedRef.current) return;
    expandFromHeightRef.current = glassCardRef.current?.getBoundingClientRect().height ?? null;
    isComposerExpandedRef.current = next;
    setIsComposerExpanded(next);
  }, []);

  // FLIP：布局已按目标态落定，把卡片高度用 min/max 双钳制钉在动画值上，
  // 从旧高度平滑过渡到新高度。不能直接动 height——展开态卡片是 flex-1
  // (basis 0)，height 会被 flex 忽略；min/max 约束则两种布局都尊重。
  // biome-ignore lint/correctness/useExhaustiveDependencies(isComposerExpanded): 函数体不读它，但它正是"布局已翻转"的触发信号。
  useLayoutEffect(() => {
    const card = glassCardRef.current;
    const fromHeight = expandFromHeightRef.current;
    expandFromHeightRef.current = null;
    if (!card || fromHeight === null || typeof card.animate !== "function") return;
    if (prefersReducedMotion()) return;

    expandAnimationRef.current?.cancel();
    const toHeight = card.getBoundingClientRect().height;
    if (Math.abs(toHeight - fromHeight) < 1) return;

    const animation = card.animate(
      [
        { minHeight: `${fromHeight}px`, maxHeight: `${fromHeight}px` },
        { minHeight: `${toHeight}px`, maxHeight: `${toHeight}px` },
      ],
      { duration: COMPOSER_EXPAND_ANIMATION_MS, easing: COMPOSER_EXPAND_EASING },
    );
    expandAnimationRef.current = animation;
    const clear = () => {
      if (expandAnimationRef.current === animation) {
        expandAnimationRef.current = null;
      }
      // 还原方向的高度上报在动画期间被冻结，落定后补测一次。
      scheduleHeightMeasureRef.current?.();
    };
    animation.onfinish = clear;
    animation.oncancel = clear;
  }, [isComposerExpanded]);

  useEffect(() => () => expandAnimationRef.current?.cancel(), []);

  const toggleComposerExpanded = useCallback(() => {
    setComposerExpanded(!isComposerExpandedRef.current);
    composerRef.current?.focus();
  }, [composerRef, setComposerExpanded]);

  /** 发送（含排队）后退出全高编辑态，让路给回复内容。 */
  const handleComposerSend = useCallback(() => {
    setComposerExpanded(false);
    onSend();
  }, [onSend, setComposerExpanded]);

  useEffect(() => {
    const hasQueuedTurns = queuedTurns.length > 0;
    if (hasQueuedTurns && !queueHadTurnsRef.current) {
      setQueueCollapsed(false);
    }
    queueHadTurnsRef.current = hasQueuedTurns;
  }, [queuedTurns.length]);

  useEffect(() => {
    const reasoningNeedsReset =
      !(reasoningOptions.length > 0 && reasoningOptions.includes(chatRuntimeControls.reasoning)) &&
      !(
        reasoningOptions.length === 0 &&
        chatRuntimeControls.reasoning === DEFAULT_CHAT_RUNTIME_CONTROLS.reasoning
      );
    const thinkingNeedsEnable = thinkingAlwaysOn && !chatRuntimeControls.thinkingEnabled;
    if (!reasoningNeedsReset && !thinkingNeedsEnable) {
      return;
    }
    onChatRuntimeControlsChange({
      ...(reasoningNeedsReset ? { reasoning: DEFAULT_CHAT_RUNTIME_CONTROLS.reasoning } : {}),
      ...(thinkingNeedsEnable ? { thinkingEnabled: true } : {}),
    });
  }, [
    chatRuntimeControls.reasoning,
    chatRuntimeControls.thinkingEnabled,
    onChatRuntimeControlsChange,
    reasoningOptions,
    thinkingAlwaysOn,
  ]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !onHeightChange) return;

    let animationFrame: number | null = null;
    const measure = () => {
      animationFrame = null;
      // 展开态占满聊天区，保留最近一次常规高度，避免底部预留跟着跳动；
      // 展开/还原动画期间高度是中间值，同样不上报，动画结束后补测。
      if (isComposerExpandedRef.current || expandAnimationRef.current) return;
      const rootHeight = root.getBoundingClientRect().height;
      const queueHeight = queuePanelRef.current?.getBoundingClientRect().height ?? 0;
      onHeightChange(Math.ceil(Math.max(0, rootHeight - queueHeight)));
    };
    const scheduleMeasure = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(measure);
    };
    scheduleHeightMeasureRef.current = scheduleMeasure;

    scheduleMeasure();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(root);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (scheduleHeightMeasureRef.current === scheduleMeasure) {
        scheduleHeightMeasureRef.current = null;
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      onHeightChange(0);
    };
  }, [onHeightChange]);

  return (
    <VStack
      ref={rootRef}
      data-file-upload-drop-zone=""
      data-file-upload-conversation-id={conversationId}
      width="100%"
      gap={0}
      hAlign="center"
      className={cn(
        "chat-composer-layer pointer-events-none relative z-20 shrink-0",
        // 展开态从头部下沿一路铺到底部，把整个聊天区让给输入框。
        isComposerExpanded && "absolute inset-x-0 bottom-0 top-14",
      )}
    >
      <VStack
        width="100%"
        maxWidth="var(--xagent-composer-width)"
        gap={0}
        className={cn(
          "pointer-events-auto relative",
          // justify-end：展开动画途中卡片被钳在中间高度时保持贴底，向上生长。
          isComposerExpanded && "flex min-h-0 flex-col justify-end",
        )}
      >
        {queuedTurns.length > 0 ? (
          <VStack
            ref={queuePanelRef}
            width="calc(100% - (var(--spacing-3) * 2))"
            maxWidth="var(--xagent-chat-queue-width)"
            gap={0}
            className="relative z-30"
          >
            <Section variant="muted" width="100%" padding={0} dividers={["bottom"]}>
              <Collapsible
                isOpen={!queueCollapsed}
                onOpenChange={(isOpen) => setQueueCollapsed(!isOpen)}
                trigger={
                  <HStack gap={2} vAlign="center" width="100%">
                    <Clock3 size={16} />
                    <Text type="supporting" weight="medium">
                      {t("chat.queue.title").replace("{count}", String(queuedTurns.length))}
                    </Text>
                  </HStack>
                }
              >
                <VStack
                  width="100%"
                  isScrollable
                  padding={1}
                  style={{ maxHeight: "var(--xagent-chat-queue-height)" }}
                >
                  <List
                    density="compact"
                    hasDividers
                    header={
                      <Text type="label" color="secondary">
                        {t("chat.queue.title").replace("{count}", String(queuedTurns.length))}
                      </Text>
                    }
                  >
                    {queuedTurns.map((item, index) => (
                      <ListItem
                        key={item.id}
                        label={item.previewText || t("chat.queue.emptyMessage")}
                        description={
                          item.fileCount > 0
                            ? t("chat.queue.fileCount").replace("{count}", String(item.fileCount))
                            : undefined
                        }
                        startContent={<Clock3 size={16} />}
                        endContent={
                          <HStack gap={0.5} vAlign="center">
                            {index > 0 ? (
                              <IconButton
                                label={t("chat.queue.moveUp")}
                                tooltip={t("chat.queue.moveUp")}
                                icon={<ChevronUp />}
                                variant="ghost"
                                size="sm"
                                onClick={() => onMoveQueuedTurnUp(item.id)}
                              />
                            ) : null}
                            <IconButton
                              label={t("chat.queue.edit")}
                              tooltip={t("chat.queue.edit")}
                              icon={<SquarePen />}
                              variant="ghost"
                              size="sm"
                              onClick={() => onEditQueuedTurn(item.id)}
                            />
                            <IconButton
                              label={t("chat.queue.runNow")}
                              tooltip={t("chat.queue.runNow")}
                              icon={<Play />}
                              variant="ghost"
                              size="sm"
                              onClick={() => onRunQueuedTurnNow(item.id)}
                            />
                            <IconButton
                              label={t("chat.queue.delete")}
                              tooltip={t("chat.queue.delete")}
                              icon={<Trash2 />}
                              variant="destructive"
                              size="sm"
                              onClick={() => onRemoveQueuedTurn(item.id)}
                            />
                          </HStack>
                        }
                      />
                    ))}
                  </List>
                </VStack>
              </Collapsible>
            </Section>
          </VStack>
        ) : null}

        <ChatComposer
          ref={glassCardRef}
          onSubmit={() => handleComposerSend()}
          onStop={onStop}
          isStopShown={isSending && !canQueueDraftWhileSending}
          isDisabled={isInputDisabled}
          density="compact"
          elevation="low"
          onKeyDown={
            isComposerExpanded
              ? (event) => {
                  // mention 弹层消费 Escape 时会 preventDefault，此处让路。
                  if (event.key === "Escape" && !event.defaultPrevented) {
                    setComposerExpanded(false);
                  }
                }
              : undefined
          }
          className={cn(
            // 过渡只针对 focus-within 的配色/阴影；不能用 transition-all——
            // 展开态切换 flex-grow 时会被一并动画，导致卡片先跳顶再长满的闪动。
            // 常驻 flex-col：FLIP 动画把卡片钳在中间高度时，flex-1 的编辑器
            // 区吸收多余空间，工具栏才能始终贴住卡片底边。
            "relative z-10 overflow-hidden",
            isComposerExpanded && "min-h-0 flex-1",
          )}
          drawer={
            pendingUploadedFiles.length > 0 ? (
              <ChatComposerDrawer
                count={pendingUploadedFiles.length}
                label={t("chat.upload.attachedFiles")}
              >
                <HStack gap={2} wrap="wrap">
                  {pendingUploadedFiles.map((file) => (
                    <Token
                      key={file.relativePath}
                      label={file.fileName}
                      description={file.relativePath}
                      icon={<Paperclip />}
                      size="sm"
                      isDisabled={isInputDisabled}
                      onRemove={
                        isInputDisabled ? undefined : () => onRemovePendingUpload(file.relativePath)
                      }
                    />
                  ))}
                </HStack>
              </ChatComposerDrawer>
            ) : undefined
          }
          headerContext={
            contextUsageTokensSource || !mobileExperience ? (
              <HStack gap={2} vAlign="center">
                {contextUsageTokensSource ? (
                  <ContextUsageIndicator
                    source={contextUsageTokensSource}
                    contextWindow={contextWindow}
                    onManualCompact={onManualCompact}
                    manualCompactionDisabled={manualCompactionDisabled}
                  />
                ) : null}
                {!mobileExperience ? (
                  <IconButton
                    label={toggleComposerExpandTooltip}
                    tooltip={toggleComposerExpandTooltip}
                    variant="ghost"
                    size="sm"
                    icon={isComposerExpanded ? <Minimize2 /> : <Maximize2 />}
                    onClick={toggleComposerExpanded}
                  />
                ) : null}
              </HStack>
            ) : undefined
          }
          input={
            <VStack
              width="100%"
              minHeight={isComposerExpanded ? 0 : undefined}
              style={isComposerExpanded ? { flex: 1 } : undefined}
            >
              <MentionComposer
                ref={composerRef}
                onSend={handleComposerSend}
                onEmptyChange={setComposerIsEmpty}
                onBusyChange={onComposerBusyChange}
                onPasteFiles={onPasteFiles}
                loadHistoryPrompts={loadHistoryPrompts}
                placeholder={inputPlaceholder}
                disabled={isInputDisabled}
                workdir={workdir}
                enabledSkills={enabledSkills}
                preferNativeContextMenu={mobileExperience}
                className={cn("px-0 py-0", isComposerExpanded && "h-full max-h-none")}
              />
            </VStack>
          }
          footerActions={
            <HStack gap={1} vAlign="center" wrap="wrap">
              <DropdownMenu
                button={{
                  label: addMenuTooltip,
                  tooltip: addMenuTooltip,
                  variant: "ghost",
                  size: "sm",
                  icon: <Plus />,
                  isIconOnly: true,
                  isLoading: isUploadingFiles,
                  isDisabled: controlsDisabled,
                }}
                hasChevron={false}
                placement="above"
                alignment="start"
                menuWidth="var(--xagent-composer-add-menu-width)"
                items={[
                  {
                    id: "files",
                    label: t("chat.upload.filesAndPhotos"),
                    description: uploadDisabled ? uploadTooltip : t("chat.upload.selectFiles"),
                    icon: <Paperclip />,
                    isDisabled: uploadDisabled,
                    onClick: onPickReadableFiles,
                  },
                  { type: "divider" },
                  {
                    id: "mention",
                    label: t("chat.composer.addMention"),
                    description: t("chat.composer.addMentionDesc"),
                    icon: <Sparkle />,
                    onClick: () => {
                      composerRef.current?.insertText("@");
                      composerRef.current?.focus();
                    },
                  },
                  {
                    id: "command",
                    label: t("chat.composer.addCommand"),
                    description: t("chat.composer.addCommandDesc"),
                    icon: <SquarePen />,
                    onClick: () => {
                      composerRef.current?.insertText("/");
                      composerRef.current?.focus();
                    },
                  },
                ]}
              />

              <ChatModelSelector
                hasModels={hasModels}
                currentModelLabel={currentModelLabel}
                modelOptions={modelOptions}
                selectedValue={selectedValue}
                isDisabled={controlsDisabled}
                onSelectModel={onSelectModel}
              />

              {voiceInputAvailable ? (
                <ToggleButton
                  label={
                    voiceInputActive
                      ? t("chat.composer.voiceListening")
                      : t("chat.composer.voiceInput")
                  }
                  tooltip={
                    voiceInputError ??
                    voiceInputPartial ??
                    (voiceInputActive
                      ? t("chat.composer.voiceListening")
                      : t("chat.composer.voiceInput"))
                  }
                  isIconOnly
                  size="sm"
                  isPressed={voiceInputActive}
                  isDisabled={isInputDisabled || (isNativeMobileRuntime() && voiceInputActive)}
                  icon={<Mic />}
                  pressedIcon={<Loader2 />}
                  onPressedChange={() => void startVoiceInput()}
                />
              ) : null}

              <ToggleButton
                label={webSearchTooltip}
                tooltip={webSearchTooltip}
                isIconOnly
                size="sm"
                isPressed={chatRuntimeControls.nativeWebSearchEnabled}
                isDisabled={controlsDisabled}
                icon={<GlobeOff />}
                pressedIcon={<Globe />}
                onPressedChange={(isPressed) =>
                  onChatRuntimeControlsChange({ nativeWebSearchEnabled: isPressed })
                }
              />

              <ToggleButton
                label={
                  !thinkingSupported
                    ? t("chat.runtime.thinkingUnavailable")
                    : chatRuntimeControls.thinkingEnabled
                      ? t("chat.runtime.thinkingOn")
                      : t("chat.runtime.thinkingOff")
                }
                tooltip={thinkingTooltip}
                isIconOnly
                size="sm"
                isPressed={chatRuntimeControls.thinkingEnabled && thinkingSupported}
                isDisabled={controlsDisabled || !thinkingSupported || thinkingAlwaysOn}
                icon={<LightbulbOff />}
                pressedIcon={<Lightbulb />}
                onPressedChange={(isPressed) =>
                  onChatRuntimeControlsChange({ thinkingEnabled: isPressed })
                }
              />

              {reasoningOptions.length > 0 && chatRuntimeControls.thinkingEnabled ? (
                <Selector
                  label={t("chat.runtime.reasoning")}
                  isLabelHidden
                  options={reasoningOptions.map((value) => ({
                    value,
                    label: t(REASONING_I18N_KEYS[value]),
                  }))}
                  value={selectedReasoning}
                  onChange={(value) =>
                    onChatRuntimeControlsChange({
                      reasoning: isReasoningLevel(value) ? value : selectedReasoning,
                    })
                  }
                  variant="ghost"
                  size="sm"
                  startIcon={<Sparkle />}
                  isDisabled={controlsDisabled}
                  statusVariant="tooltip"
                />
              ) : null}

              <GitBranchSelector
                workdir={workdir}
                gitClient={gitClient}
                workspaceActivityClient={workspaceActivityClient}
                disabled={controlsDisabled}
                canWrite={gitWriteEnabled}
                disabledMessage={gitDisabledMessage}
              />
            </HStack>
          }
          sendButton={
            <ChatSendButton
              size="sm"
              isStopShown={isSending && !canQueueDraftWhileSending}
              isDisabled={isSending ? false : sendDisabled}
              onSend={handleComposerSend}
              onStop={onStop}
            />
          }
        />
      </VStack>
    </VStack>
  );
});
