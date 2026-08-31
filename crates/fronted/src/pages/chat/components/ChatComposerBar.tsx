import { Button } from "@astryxdesign/core/Button";
import { Carousel } from "@astryxdesign/core/Carousel";
import { ChatComposer, ChatComposerDrawer, ChatSendButton } from "@astryxdesign/core/Chat";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Heading } from "@astryxdesign/core/Heading";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Popover } from "@astryxdesign/core/Popover";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { Thumbnail } from "@astryxdesign/core/Thumbnail";
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
import {
  AtSign,
  Blend,
  Camera,
  Check,
  ChevronUp,
  Clock3,
  Globe,
  GlobeOff,
  ImageIcon,
  Lightbulb,
  LightbulbOff,
  Loader2,
  Maximize2,
  Mic,
  Minimize2,
  Paperclip,
  Play,
  Plus,
  Shield,
  Sparkle,
  SquarePen,
  Trash2,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { canManualCompact, contextUsageRatio } from "../../../lib/chat/contextUsage";
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
  type CommandSafetyMode,
  DEFAULT_CHAT_RUNTIME_CONTROLS,
  type ReasoningLevel,
  type SelectedModel,
  type SttSettings,
} from "../../../lib/settings";
import {
  type DesktopSttCapture,
  startDesktopSttCapture,
} from "../../../lib/stt/desktopAudioCapture";
import { invokeFs } from "../../../lib/tools/fsBackend";
import type { WorkspaceActivityClient } from "../../../lib/workspace-activity/types";
import { ChatModelSelector } from "./ChatModelSelector";
import { ComposerGitRepositoryControl } from "./ComposerGitRepositoryControl";

export type ContextUsageTokensSource = {
  subscribe: (listener: () => void) => () => void;
  getContextUsageTokens: () => number | undefined;
};

function formatCompactTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return String(value);
}

type ReadWorkspaceImageResponse = {
  mimeType: string;
  data: string;
};

function PendingImageThumbnail(props: {
  file: PendingUploadedFile;
  workdir: string;
  isDisabled: boolean;
  onRemove: () => void;
}) {
  const [source, setSource] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setSource("");
    setIsLoading(true);
    if (!props.workdir.trim()) {
      setIsLoading(false);
      return () => {
        active = false;
      };
    }
    void invokeFs<ReadWorkspaceImageResponse>("fs_read_workspace_image", {
      workdir: props.workdir,
      path: props.file.relativePath,
    })
      .then((response) => {
        if (active) setSource(`data:${response.mimeType};base64,${response.data}`);
      })
      .catch(() => {
        if (active) setSource("");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.file.relativePath, props.workdir]);

  return (
    <Thumbnail
      src={source || undefined}
      alt={props.file.fileName}
      label={props.file.fileName}
      isLoading={isLoading}
      isDisabled={props.isDisabled}
      showRemoveOn="always"
      onRemove={props.isDisabled ? undefined : props.onRemove}
    />
  );
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
  const usedTokens = Math.max(0, tokens ?? 0);
  const ratio = contextUsageRatio(usedTokens, contextWindow);
  const canOfferCompaction = canManualCompact(ratio) && Boolean(props.onManualCompact);
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (contextWindow <= 0 || usedTokens <= 0) return null;

  const ringPercent = Math.min(100, ratio * 100);
  const percent = Math.min(999, Math.round(ratio * 100));
  const ringColor =
    ratio >= 0.8
      ? "var(--color-error)"
      : ratio >= 0.5
        ? "var(--color-warning)"
        : "var(--color-success)";
  const progressVariant = ratio >= 0.8 ? "error" : ratio >= 0.5 ? "warning" : "success";
  const usageLabel = `${t("chat.contextUsage")}: ${formatCompactTokens(usedTokens)} / ${formatCompactTokens(contextWindow)} tokens (${percent}%)`;

  const ring = (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="34" height="34">
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="var(--color-border)" strokeWidth="2.5" />
      <circle
        cx="12"
        cy="12"
        r="9.5"
        fill="none"
        pathLength="100"
        stroke={ringColor}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="100"
        strokeDashoffset={100 - ringPercent}
        transform="rotate(-90 12 12)"
        style={{ transition: "stroke-dashoffset 180ms ease, stroke 180ms ease" }}
      />
      <text
        x="12"
        y="12.25"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        fontSize="6"
        fontWeight="650"
      >
        {percent}%
      </text>
    </svg>
  );

  const trigger = (
    <IconButton
      label={canOfferCompaction ? t("chat.manualCompact") : usageLabel}
      tooltip={usageLabel}
      icon={ring}
      variant="ghost"
      size="lg"
    />
  );

  return (
    <Popover
      isOpen={detailsOpen}
      onOpenChange={setDetailsOpen}
      placement="above"
      alignment="end"
      label={t("chat.contextUsage")}
      width="min(20rem, calc(100dvw - var(--spacing-4)))"
      content={
        <VStack gap={3}>
          <Heading level={4}>{t("chat.contextUsage")}</Heading>
          <Text type="supporting" color="secondary">
            {usageLabel}
          </Text>
          <ProgressBar
            label={usageLabel}
            value={ringPercent}
            max={100}
            variant={progressVariant}
            hasValueLabel
            formatValueLabel={() => `${percent}%`}
          />
          {canOfferCompaction ? (
            <Text type="supporting" color="secondary">
              {t("chat.manualCompactDescription")}
            </Text>
          ) : null}
          <HStack gap={2} hAlign="end">
            <Button
              label={t("chat.cancel")}
              variant="ghost"
              size="sm"
              onClick={() => setDetailsOpen(false)}
            />
            {canOfferCompaction ? (
              <Button
                label={t("chat.manualCompactConfirm")}
                variant="primary"
                size="sm"
                isDisabled={props.manualCompactionDisabled}
                onClick={() => {
                  setDetailsOpen(false);
                  props.onManualCompact?.();
                }}
              />
            ) : null}
          </HStack>
        </VStack>
      }
    >
      {trigger}
    </Popover>
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
  commandSafetyMode: CommandSafetyMode;
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
  onCommandSafetyModeChange: (mode: CommandSafetyMode) => void;
  onPickReadableFiles: () => void;
  onPickReadablePhotos: () => void;
  onCaptureReadablePhoto: () => void;
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
    commandSafetyMode,
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
    onCommandSafetyModeChange,
    onPickReadableFiles,
    onPickReadablePhotos,
    onCaptureReadablePhoto,
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

  const expandFromHeightRef = useRef<number | null>(null);
  const expandAnimationRef = useRef<Animation | null>(null);
  const scheduleHeightMeasureRef = useRef<(() => void) | null>(null);
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [voiceInputAvailable, setVoiceInputAvailable] = useState(false);
  const [voiceInputActive, setVoiceInputActive] = useState(false);
  const [voiceInputError, setVoiceInputError] = useState<string | null>(null);
  const [voiceInputPartial, setVoiceInputPartial] = useState<string | null>(null);
  const desktopSttCaptureRef = useRef<DesktopSttCapture | null>(null);
  const uploadDisabled = isInputDisabled || isUploadingFiles || !workdir;
  const controlsDisabled = isInputDisabled;
  const hasSendableDraft = !composerIsEmpty || pendingUploadedFiles.length > 0;
  const thinkingSupported = reasoningOptions.length > 0 || thinkingAlwaysOn;
  const sendDisabled = isInputDisabled || isUploadingFiles || !hasSendableDraft;
  const canQueueDraftWhileSending = isSending && !sendDisabled;
  const imageUploads = pendingUploadedFiles.filter((file) => file.kind === "image");
  const documentUploads = pendingUploadedFiles.filter((file) => file.kind !== "image");
  const uploadTooltip = isUploadingFiles
    ? t("chat.upload.uploading")
    : !workdir
      ? t("chat.upload.requireWorkdir")
      : t("chat.upload.button");
  const addMenuTooltip = t("chat.upload.add");
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

  const setComposerExpanded = useCallback((next: boolean) => {
    if (next === isComposerExpandedRef.current) return;
    expandFromHeightRef.current = glassCardRef.current?.getBoundingClientRect().height ?? null;
    isComposerExpandedRef.current = next;
    setIsComposerExpanded(next);
  }, []);

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

      scheduleHeightMeasureRef.current?.();
    };
    animation.onfinish = clear;
    animation.oncancel = clear;
  }, [isComposerExpanded]);

  useEffect(() => () => expandAnimationRef.current?.cancel(), []);

  const addMenuContent = (
    <VStack gap={3} padding={2} width="100%">
      <List density="compact" hasDividers>
        <ListItem
          label={t("chat.upload.filesAndPhotos")}
          description={uploadDisabled ? uploadTooltip : t("chat.upload.selectFiles")}
          startContent={<Paperclip />}
          isDisabled={uploadDisabled}
          onClick={() => {
            setIsAddMenuOpen(false);
            onPickReadableFiles();
          }}
        />
      </List>
      <VStack gap={2} width="100%">
        <Switch
          label={
            chatRuntimeControls.planModeEnabled ? t("chat.planMode.on") : t("chat.planMode.off")
          }
          value={chatRuntimeControls.planModeEnabled}
          onChange={(value) => onChatRuntimeControlsChange({ planModeEnabled: value })}
          labelIcon={Sparkle}
          labelPosition="start"
          labelSpacing="spread"
          size="sm"
          width="100%"
          isDisabled={controlsDisabled || !isAgentMode}
        />
        <Switch
          label={webSearchTooltip}
          value={chatRuntimeControls.nativeWebSearchEnabled}
          onChange={(value) =>
            onChatRuntimeControlsChange({ nativeWebSearchEnabled: value })
          }
          labelIcon={chatRuntimeControls.nativeWebSearchEnabled ? Globe : GlobeOff}
          labelPosition="start"
          labelSpacing="spread"
          size="sm"
          width="100%"
          isDisabled={controlsDisabled}
        />
        <Switch
          label={
            !thinkingSupported
              ? t("chat.runtime.thinkingUnavailable")
              : chatRuntimeControls.thinkingEnabled || thinkingAlwaysOn
                ? t("chat.runtime.thinkingOn")
                : t("chat.runtime.thinkingOff")
          }
          value={
            thinkingSupported && (chatRuntimeControls.thinkingEnabled || thinkingAlwaysOn)
          }
          onChange={(value) => onChatRuntimeControlsChange({ thinkingEnabled: value })}
          labelIcon={
            chatRuntimeControls.thinkingEnabled || thinkingAlwaysOn ? Lightbulb : LightbulbOff
          }
          labelPosition="start"
          labelSpacing="spread"
          size="sm"
          width="100%"
          isDisabled={controlsDisabled || !thinkingSupported || thinkingAlwaysOn}
          disabledMessage={!thinkingSupported ? t("chat.runtime.thinkingUnavailable") : undefined}
        />
        {voiceInputAvailable ? (
          <List density="compact">
            <ListItem
              label={
                voiceInputActive
                  ? t("chat.composer.voiceListening")
                  : t("chat.composer.voiceInput")
              }
              description={voiceInputError ?? voiceInputPartial ?? undefined}
              startContent={voiceInputActive ? <Loader2 /> : <Mic />}
              isDisabled={isInputDisabled || (isNativeMobileRuntime() && voiceInputActive)}
              onClick={() => void startVoiceInput()}
            />
          </List>
        ) : null}
      </VStack>
      {isAgentMode ? (
        <ComposerGitRepositoryControl
          workdir={workdir}
          gitClient={gitClient}
          workspaceActivityClient={workspaceActivityClient}
          isOpen={isAddMenuOpen}
          isDisabled={controlsDisabled}
          canWrite={gitWriteEnabled}
          disabledMessage={gitDisabledMessage}
        />
      ) : null}
    </VStack>
  );

  const mobileAddMenuContent = (
    <VStack
      gap={1}
      padding={1}
      width="100%"
      isScrollable
      style={{ maxHeight: "min(31rem, calc(100dvh - 10rem))" }}
    >
      <List
        density="compact"
        style={{
          border: "none",
          borderRadius: 0,
          background: "transparent",
          boxShadow: "none",
        }}
      >
        <ListItem
          label={t("chat.upload.camera")}
          startContent={<Camera />}
          isDisabled={uploadDisabled}
          onClick={() => {
            setIsAddMenuOpen(false);
            onCaptureReadablePhoto();
          }}
        />
        <ListItem
          label={t("chat.upload.photos")}
          startContent={<ImageIcon />}
          isDisabled={uploadDisabled}
          onClick={() => {
            setIsAddMenuOpen(false);
            onPickReadablePhotos();
          }}
        />
        <ListItem
          label={t("chat.upload.files")}
          startContent={<Paperclip />}
          isDisabled={uploadDisabled}
          onClick={() => {
            setIsAddMenuOpen(false);
            onPickReadableFiles();
          }}
        />
        <ListItem
          label={t("chat.composer.plugins")}
          startContent={<Blend />}
          isDisabled={controlsDisabled || enabledSkills.length === 0}
          onClick={() => {
            setIsAddMenuOpen(false);
            composerRef.current?.insertText("/");
            composerRef.current?.focus();
          }}
        />
        <ListItem
          label={t("chat.runtime.thinkHarder")}
          startContent={<Lightbulb />}
          endContent={
            chatRuntimeControls.thinkingEnabled || thinkingAlwaysOn ? <Check /> : undefined
          }
          isSelected={chatRuntimeControls.thinkingEnabled || thinkingAlwaysOn}
          isDisabled={controlsDisabled || !thinkingSupported || thinkingAlwaysOn}
          onClick={() =>
            onChatRuntimeControlsChange({
              thinkingEnabled: !chatRuntimeControls.thinkingEnabled,
            })
          }
        />
        <ListItem
          label={webSearchTooltip}
          startContent={
            chatRuntimeControls.nativeWebSearchEnabled ? <Globe /> : <GlobeOff />
          }
          endContent={chatRuntimeControls.nativeWebSearchEnabled ? <Check /> : undefined}
          isSelected={chatRuntimeControls.nativeWebSearchEnabled}
          isDisabled={controlsDisabled}
          onClick={() =>
            onChatRuntimeControlsChange({
              nativeWebSearchEnabled: !chatRuntimeControls.nativeWebSearchEnabled,
            })
          }
        />
        <ListItem
          label={
            chatRuntimeControls.planModeEnabled ? t("chat.planMode.on") : t("chat.planMode.off")
          }
          startContent={<Sparkle />}
          endContent={chatRuntimeControls.planModeEnabled ? <Check /> : undefined}
          isSelected={chatRuntimeControls.planModeEnabled}
          isDisabled={controlsDisabled || !isAgentMode}
          onClick={() =>
            onChatRuntimeControlsChange({
              planModeEnabled: !chatRuntimeControls.planModeEnabled,
            })
          }
        />
      </List>
    </VStack>
  );

  const toggleComposerExpanded = useCallback(() => {
    setComposerExpanded(!isComposerExpandedRef.current);
    composerRef.current?.focus();
  }, [composerRef, setComposerExpanded]);

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
      className="chat-composer-layer"
      style={{
        pointerEvents: "none",
        position: isComposerExpanded ? "absolute" : "relative",
        insetInline: isComposerExpanded ? 0 : undefined,
        insetBlockStart: isComposerExpanded ? "var(--xgent-mobile-header-height)" : undefined,
        insetBlockEnd: isComposerExpanded ? 0 : undefined,
        zIndex: "var(--xgent-z-chat-composer)",
        flexShrink: 0,
      }}
    >
      <VStack
        width="100%"
        maxWidth="var(--xgent-composer-width)"
        gap={0}
        style={{
          pointerEvents: "auto",
          position: "relative",
          display: isComposerExpanded ? "flex" : undefined,
          minHeight: isComposerExpanded ? 0 : undefined,
          flexDirection: isComposerExpanded ? "column" : undefined,
          justifyContent: isComposerExpanded ? "flex-end" : undefined,
        }}
      >
        {queuedTurns.length > 0 ? (
          <VStack
            ref={queuePanelRef}
            width="calc(100% - (var(--spacing-3) * 2))"
            maxWidth="var(--xgent-chat-queue-width)"
            gap={0}
            style={{ position: "relative", zIndex: "var(--xgent-z-chat-queue)" }}
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
                  style={{ maxHeight: "var(--xgent-chat-queue-height)" }}
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
                  if (event.key === "Escape" && !event.defaultPrevented) {
                    setComposerExpanded(false);
                  }
                }
              : undefined
          }
          className="xgent-chat-composer"
          style={isComposerExpanded ? { minHeight: 0, flex: 1 } : undefined}
          drawer={
            pendingUploadedFiles.length > 0 ? (
              <ChatComposerDrawer>
                <VStack gap={2} width="100%">
                  {imageUploads.length > 0 ? (
                    <Carousel
                      gap={1}
                      hasButtons={imageUploads.length > 3}
                      hasSnap
                      aria-label={t("chat.upload.attachedFiles")}
                    >
                      {imageUploads.map((file) => (
                        <PendingImageThumbnail
                          key={file.relativePath}
                          file={file}
                          workdir={workdir}
                          isDisabled={isInputDisabled}
                          onRemove={() => onRemovePendingUpload(file.relativePath)}
                        />
                      ))}
                    </Carousel>
                  ) : null}
                  {documentUploads.length > 0 ? (
                    <HStack gap={1} wrap="wrap">
                      {documentUploads.map((file) => (
                        <Token
                          key={file.relativePath}
                          label={file.fileName}
                          description={file.relativePath}
                          icon={<Paperclip />}
                          size="sm"
                          isDisabled={isInputDisabled}
                          onRemove={
                            isInputDisabled
                              ? undefined
                              : () => onRemovePendingUpload(file.relativePath)
                          }
                        />
                      ))}
                    </HStack>
                  ) : null}
                </VStack>
              </ChatComposerDrawer>
            ) : undefined
          }
          headerContext={
            !mobileExperience && isAgentMode ? (
              <IconButton
                label={toggleComposerExpandTooltip}
                tooltip={toggleComposerExpandTooltip}
                variant="ghost"
                size="sm"
                icon={isComposerExpanded ? <Minimize2 /> : <Maximize2 />}
                onClick={toggleComposerExpanded}
              />
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
                compact={mobileExperience}
                className={
                  isComposerExpanded
                    ? "xgent-chat-mention-composer xgent-chat-mention-composer-expanded"
                    : "xgent-chat-mention-composer"
                }
              />
            </VStack>
          }
          footerActions={
            <HStack gap={1} vAlign="center" wrap="wrap">
              {mobileExperience ? (
                <>
                  <Popover
                    placement="above"
                    alignment="start"
                    width="min(21rem, calc(100dvw - var(--spacing-6)))"
                    label={addMenuTooltip}
                    isOpen={isAddMenuOpen}
                    onOpenChange={setIsAddMenuOpen}
                    isEnabled={!controlsDisabled}
                    content={mobileAddMenuContent}
                  >
                    <IconButton
                      label={addMenuTooltip}
                      tooltip={addMenuTooltip}
                      variant="ghost"
                      size="sm"
                      icon={<Plus />}
                      isLoading={isUploadingFiles}
                      isDisabled={controlsDisabled}
                    />
                  </Popover>
                  <IconButton
                    label={t("chat.composer.addMention")}
                    tooltip={t("chat.composer.addMentionDesc")}
                    variant="ghost"
                    size="sm"
                    icon={<AtSign />}
                    isDisabled={controlsDisabled}
                    onClick={() => {
                      composerRef.current?.insertText("@");
                      composerRef.current?.focus();
                    }}
                  />
                  {voiceInputAvailable ? (
                    <IconButton
                      label={
                        voiceInputActive
                          ? t("chat.composer.voiceListening")
                          : t("chat.composer.voiceInput")
                      }
                      tooltip={voiceInputError ?? voiceInputPartial ?? undefined}
                      variant="ghost"
                      size="sm"
                      icon={voiceInputActive ? <Loader2 /> : <Mic />}
                      isDisabled={isInputDisabled || (isNativeMobileRuntime() && voiceInputActive)}
                      onClick={() => void startVoiceInput()}
                    />
                  ) : null}
                </>
              ) : (
                <Popover
                  placement="above"
                  alignment="start"
                  width="var(--xgent-composer-add-menu-width)"
                  label={addMenuTooltip}
                  isOpen={isAddMenuOpen}
                  onOpenChange={setIsAddMenuOpen}
                  isEnabled={!controlsDisabled}
                  content={addMenuContent}
                >
                  <IconButton
                    label={addMenuTooltip}
                    tooltip={addMenuTooltip}
                    variant="ghost"
                    size="sm"
                    icon={<Plus />}
                    isLoading={isUploadingFiles}
                    isDisabled={controlsDisabled}
                  />
                </Popover>
              )}

              <Selector
                label={t("settings.commandSafety.title")}
                isLabelHidden
                options={(["auto", "ask", "sandbox", "sandboxOffline"] as CommandSafetyMode[]).map(
                  (mode) => ({
                    value: mode,
                    label: t(`settings.commandSafety.${mode}`),
                    description: t(`settings.commandSafety.${mode}Desc`),
                  }),
                )}
                value={commandSafetyMode}
                onChange={(value) => onCommandSafetyModeChange(value as CommandSafetyMode)}
                variant="ghost"
                size="sm"
                placement="above"
                startIcon={<Shield />}
                isDisabled={controlsDisabled || !isAgentMode}
                statusVariant="tooltip"
              />
            </HStack>
          }
          sendActions={
            <HStack gap={1} vAlign="center">
              {contextUsageTokensSource ? (
                <ContextUsageIndicator
                  source={contextUsageTokensSource}
                  contextWindow={contextWindow}
                  onManualCompact={onManualCompact}
                  manualCompactionDisabled={manualCompactionDisabled}
                />
              ) : null}
              <ChatModelSelector
                hasModels={hasModels}
                currentModelLabel={currentModelLabel}
                modelOptions={modelOptions}
                selectedValue={selectedValue}
                chatRuntimeControls={chatRuntimeControls}
                reasoningOptions={reasoningOptions}
                isDisabled={controlsDisabled}
                onSelectModel={onSelectModel}
                onChatRuntimeControlsChange={onChatRuntimeControlsChange}
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
