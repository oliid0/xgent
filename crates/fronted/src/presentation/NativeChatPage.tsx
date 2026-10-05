import {
  lazy,
  type MutableRefObject,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  MentionComposerHandle,
  MentionComposerSkill,
} from "../components/chat/MentionComposer";
import { useLocale } from "../i18n";
import type { AppUpdateController } from "../lib/appUpdates";
import { collectActivityItems } from "../lib/chat/activityTimeline";
import type { RenderTimelineItem } from "../lib/chat/conversation/conversationState";
import type { LiveTranscriptStore } from "../lib/chat/conversation/liveTranscriptStore";
import { executionActivityStore } from "../lib/chat/executionActivityStore";
import {
  readChatLayoutPreferences,
  saveChatLayoutPreferences,
} from "../lib/chat/layoutPreferences";
import { normalizeLogicalLineEndings } from "../lib/chat/messages/composerText";
import { createFileMentionReference } from "../lib/chat/messages/mentionReferences";
import { safeStringify, summarizeToolCall } from "../lib/chat/messages/uiMessages";
import type { PendingUploadedFile } from "../lib/chat/messages/uploadedFiles";
import { normalizeConversationTitle } from "../lib/chat/page/chatPageHelpers";
import { isTaskToolBlock, selectLatestTaskProgress } from "../lib/chat/taskProgress";
import {
  checkMobileAssistantPermissions,
  mobileAssistantStatus,
  requestMobileAssistantPermission,
  startMobileVoiceInput,
} from "../lib/mobileAssistant";
import { type ModelOption, parseModelValue } from "../lib/providers/llm";
import { isNativeMobileRuntime } from "../lib/runtimePlatform";
import type {
  AppSettings,
  ChatRuntimeControls,
  CommandSafetyMode,
  ReasoningLevel,
  SelectedModel,
  WorkspaceProject,
  WorkspaceProjectGroup,
} from "../lib/settings";
import { workspaceProjectPathKey } from "../lib/settings";
import { sortSidebarConversations } from "../lib/sidebar/reconcile";
import type { SidebarStore } from "../lib/sidebar/store";
import { useSoul } from "../lib/soul";
import { type DesktopSttCapture, startDesktopSttCapture } from "../lib/stt/desktopAudioCapture";
import type { TaskListState } from "../lib/tools/builtinTypes";
import type { PendingToolApprovalSummary, ToolApprovalDecision } from "../lib/tools/toolApproval";
import { sortWorkspaceProjectsByActivity } from "../lib/workspaceProjects";
import type { ChatQueueTurnPreview } from "../pages/chat/components/ChatComposerBar";
import type { SectionId } from "../pages/settings/types";
import { createNativeComposerStore } from "./composerStore";
import { presentationControls } from "./controls";
import { NativeSurface } from "./NativeSurface";
import { NativeWorkspaceSearchPalette } from "./NativeWorkspaceSearchPalette";
import { useNativeAskUserQuestions } from "./nativeAskUserQuestions";
import { createNativeChatContextUsage } from "./nativeChatContextUsage";
import { toolEvidenceNodes } from "./nativeChatEvidence";
import { createNativeChatRuntimeControls } from "./nativeChatRuntimeControls";
import { createNativeChatTranscript } from "./nativeChatTranscript";
import {
  createNativeMentionSearch,
  decodeNativeComposerSelection,
  detectNativeComposerMention,
  nativeMentionSearchKey,
} from "./nativeComposerMentions";
import {
  createNativeConversationActions,
  mutateNativeConversation,
} from "./nativeConversationActions";
import { decodeNativeFiles } from "./nativeFiles";
import { nativeReadOnlyCodeNodes } from "./nativeReadOnlyCode";
import { attachReadOnlySyntax, readOnlySyntaxPalette } from "./nativeReadOnlySyntax";
import { createNativeSidebarSoulMenu } from "./nativeSidebarSoulMenu";
import { createNativeSidebarUpdate } from "./nativeSidebarUpdate";
import { createNativeTaskProgress } from "./nativeTaskProgress";
import { createNativePresentationTheme } from "./nativeTheme";
import {
  type NativeWorkspaceActionsProps,
  useNativeWorkspaceActions,
} from "./nativeWorkspaceActions";
import type { NativeWorkspaceEditorSessions } from "./nativeWorkspaceEditorSessions";
import type { PresentationHandler, PresentationNode, PresentationValue } from "./types";

const NativeDesktopTrajectory = lazy(() => import("./NativeDesktopTrajectory"));

function activityIcon(toolName: string) {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("browser") || normalized.includes("web_search")) return "globe";
  if (
    normalized.includes("shell") ||
    normalized.includes("terminal") ||
    normalized.includes("process")
  )
    return "terminal";
  if (normalized.includes("edit") || normalized.includes("write")) return "doc.badge.gearshape";
  return "hammer";
}

export type NativeChatPageProps = NativeWorkspaceActionsProps & {
  appUpdate?: AppUpdateController;
  editorSessions?: NativeWorkspaceEditorSessions;
  conversationId: string;
  uploadWorkdir: string;
  settings: AppSettings;
  composerRef: MutableRefObject<MentionComposerHandle | null>;
  sidebarStore: SidebarStore;
  historyItems: RenderTimelineItem[];
  liveTranscriptStore: LiveTranscriptStore;
  modelOptions: ModelOption[];
  chatRuntimeControls: ChatRuntimeControls;
  reasoningOptions: ReasoningLevel[];
  thinkingAlwaysOn: boolean;
  onChatRuntimeControlsChange: (patch: Partial<ChatRuntimeControls>) => void;
  enabledSkills?: MentionComposerSkill[];
  selectedValue?: string;
  contextUsageTokensSource: {
    subscribe: (listener: () => void) => () => void;
    getContextUsageTokens: () => number | undefined;
  };
  contextWindow?: number;
  onManualCompact?: () => void;
  manualCompactionDisabled?: boolean;
  inputDisabled: boolean;
  inputPlaceholder: string;
  isSending: boolean;
  errorMessage: string | null;
  hasMoreHistory: boolean;
  pendingApprovals: PendingToolApprovalSummary[];
  projects: WorkspaceProject[];
  workspaceProjectGroups?: WorkspaceProjectGroup[];
  attachmentsEnabled: boolean;
  trajectoryAvailable: boolean;
  uploads: PendingUploadedFile[];
  taskList?: TaskListState;
  isUploading: boolean;
  onSend: () => void;
  onSteer?: () => void;
  onStop: () => void;
  queuedTurns: ChatQueueTurnPreview[];
  onRunQueuedTurnNow: (id: string) => void;
  onMoveQueuedTurnUp: (id: string) => void;
  onEditQueuedTurn: (id: string) => void;
  onRemoveQueuedTurn: (id: string) => void;
  onSelectModel: (selection: SelectedModel) => void;
  onSelectConversation: (id: string) => void;
  onConversationDeleted: (id: string) => void;
  onConversationCwdChanged: (id: string, cwd: string) => void;
  onSelectProject: (project: WorkspaceProject) => void;
  onNewConversation: () => void;
  onCreateSoul?: () => void;
  onNewSideConversation?: () => void;
  onOpenConversationInSplit?: (id: string) => void;
  onOpenSettings: (section?: SectionId) => void;
  onOpenSkillsHub: () => void;
  onOpenMcpHub: () => void;
  sidebarOpenRequestId?: number;
  onOpenRemote: () => void;
  onOpenBrowser: () => void;
  onOpenBrowserSettings: () => void;
  onOpenGitReview: () => void;
  onOpenBackgroundTasks: () => void;
  onOpenFiles: () => void;
  onOpenWorkspaceFile: (path: string) => void;
  onChangeMode: (mode: "text" | "tools") => void;
  onCommandSafetyModeChange: (mode: CommandSafetyMode) => void;
  onLoadEarlierHistory: () => Promise<unknown> | void;
  onDecide: (id: string, decision: ToolApprovalDecision) => { ok: boolean; message?: string };
  onCreateProject: () => void;
  onToggleWorkspaceGroupCollapsed?: (groupId: string) => void;
  onOpenTerminal: () => void;
  onImportFiles: (files: File[]) => Promise<void>;
  onRemoveUpload: (path: string) => void;
};

export function NativeChatPage(props: NativeChatPageProps) {
  const { t } = useLocale();
  const compact = isNativeMobileRuntime();
  const soul = useSoul();
  const soulRef = useRef(soul);
  soulRef.current = soul;
  const appUpdateRef = useRef(props.appUpdate);
  appUpdateRef.current = props.appUpdate;
  const [updateRequest] = useState(() => ({ busy: false, mounted: true }));
  const [, setUpdateBusy] = useState(false);
  const [soulRequest] = useState(() => ({ busy: false, mounted: true }));
  useEffect(() => {
    soulRequest.mounted = true;
    return () => {
      soulRequest.mounted = false;
    };
  }, [soulRequest]);
  useEffect(() => {
    updateRequest.mounted = true;
    return () => {
      updateRequest.mounted = false;
    };
  }, [updateRequest]);
  const [composer] = useState(createNativeComposerStore);
  const [mentionSearch] = useState(createNativeMentionSearch);
  useSyncExternalStore(composer.subscribe, composer.getSnapshot, composer.getSnapshot);
  const mentionFiles = useSyncExternalStore(
    mentionSearch.subscribe,
    mentionSearch.getSnapshot,
    mentionSearch.getSnapshot,
  );
  const detectedMentionContext = props.inputDisabled
    ? null
    : detectNativeComposerMention(composer.handle.getText(), composer.getSelection(), true);
  const [dismissedMentionScope, setDismissedMentionScope] = useState<string | null>(null);
  const mentionScope = JSON.stringify([
    props.conversationId,
    props.uploadWorkdir,
    detectedMentionContext?.text,
    detectedMentionContext?.start,
    detectedMentionContext?.end,
  ]);
  const mentionContext = mentionScope === dismissedMentionScope ? null : detectedMentionContext;
  const mentionKey = nativeMentionSearchKey(
    props.conversationId,
    props.uploadWorkdir,
    mentionContext,
  );
  const mentionContextRef = useRef(mentionContext);
  mentionContextRef.current = mentionContext;
  useEffect(() => {
    void mentionSearch.search(mentionKey, props.uploadWorkdir, mentionContextRef.current);
    return () => mentionSearch.cancel();
  }, [mentionSearch, mentionKey, props.uploadWorkdir]);
  const sidebar = useSyncExternalStore(
    props.sidebarStore.subscribe,
    props.sidebarStore.getSnapshot,
  );
  const workspaceActions = useNativeWorkspaceActions(
    {
      ...props,
      runningProjectPathKeys: sidebar.runningWorkdirPathKeys,
      onNavigate: () => {
        if (compact) setSidebarOpen(false);
      },
    },
    t,
  );
  const sidebarProjects = sortWorkspaceProjectsByActivity(props.projects, {
    projectActivityUpdatedAts: sidebar.workdirActivity,
    runningProjectPathKeys: sidebar.runningWorkdirPathKeys,
  });
  const live = useSyncExternalStore(
    props.liveTranscriptStore.subscribe,
    props.liveTranscriptStore.getSnapshot,
  );
  const contextUsedTokens = useSyncExternalStore(
    props.contextUsageTokensSource.subscribe,
    props.contextUsageTokensSource.getContextUsageTokens,
    props.contextUsageTokensSource.getContextUsageTokens,
  );
  const activityFrames = useSyncExternalStore(
    executionActivityStore.subscribe,
    () => executionActivityStore.getSnapshot(props.conversationId),
    () => executionActivityStore.getSnapshot(props.conversationId),
  );
  const attachmentContext = useRef({
    conversationId: props.conversationId,
    workdir: props.uploadWorkdir,
    revision: 0,
  }).current;
  const currentProps = useRef(props);
  currentProps.current = props;
  if (
    attachmentContext.conversationId !== props.conversationId ||
    attachmentContext.workdir !== props.uploadWorkdir
  ) {
    attachmentContext.conversationId = props.conversationId;
    attachmentContext.workdir = props.uploadWorkdir;
    attachmentContext.revision += 1;
  }
  const [sidebarOpen, setSidebarOpen] = useState(
    () => !compact && readChatLayoutPreferences().leftSidebarOpen,
  );
  const [toolsOpen, setToolsOpen] = useState(false);
  const [trajectoryOpen, setTrajectoryOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);
  const [archivedGroupOpen, setArchivedGroupOpen] = useState(false);
  const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [conversationDialog, setConversationDialog] = useState<{
    id: string;
    kind: "rename" | "delete";
    title: string;
  } | null>(null);
  useEffect(() => {
    if (!sidebarOpen) return;
    for (const project of props.projects) {
      if (
        expandedProjectIds.has(project.id) &&
        !props.archivedProjectPathKeys?.has(workspaceProjectPathKey(project.path)) &&
        !sidebar.workspaceHistory.has(workspaceProjectPathKey(project.path))
      ) {
        void props.sidebarStore.loadWorkspaceHistory(project.path);
      }
    }
  }, [
    expandedProjectIds,
    props.projects,
    props.archivedProjectPathKeys,
    props.sidebarStore,
    sidebar.workspaceHistory,
    sidebarOpen,
  ]);
  const recentChats = sortSidebarConversations(
    Array.from(sidebar.byId.values()).filter((item) => !item.cwd?.trim()),
  ).slice(0, sidebar.recentHistory.limit);
  const searchableConversations = useMemo(
    () => sortSidebarConversations(Array.from(sidebar.byId.values())),
    [sidebar.byId],
  );
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voicePartial, setVoicePartial] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const desktopVoiceCapture = useRef<DesktopSttCapture | null>(null);
  useEffect(() => {
    if (!compact) saveChatLayoutPreferences({ leftSidebarOpen: sidebarOpen });
  }, [compact, sidebarOpen]);
  useEffect(() => {
    if ((props.sidebarOpenRequestId ?? 0) > 0) setSidebarOpen(true);
  }, [props.sidebarOpenRequestId]);
  useEffect(() => {
    if (!props.trajectoryAvailable) setTrajectoryOpen(false);
  }, [props.trajectoryAvailable]);
  useEffect(() => {
    if (!compact) {
      const provider = props.settings.stt.provider;
      setVoiceAvailable(
        props.settings.stt.enabled && props.settings.stt.providers[provider]?.configured === true,
      );
      return;
    }
    if (!props.settings.stt.enabled) {
      setVoiceAvailable(false);
      return;
    }
    let active = true;
    void mobileAssistantStatus()
      .then((status) => {
        if (active) setVoiceAvailable(status.available && status.voiceInputAvailable);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [compact, props.settings.stt]);
  useEffect(
    () => () => {
      void desktopVoiceCapture.current?.cancel();
      desktopVoiceCapture.current = null;
    },
    [],
  );
  const [failure, setFailure] = useState<unknown>(null);
  useLayoutEffect(() => {
    props.composerRef.current = composer.handle;
    return () => {
      if (props.composerRef.current === composer.handle) props.composerRef.current = null;
    };
  }, [composer, props.composerRef]);
  const syntaxPalette = useMemo(
    () => readOnlySyntaxPalette(props.settings, compact),
    [props.settings, compact],
  );
  if (failure) throw failure;

  const handlers = new Map<string, PresentationHandler>();
  const action = (id: string, run: () => unknown, enabled = true) => {
    handlers.set(id, { enabled, accepts: (value) => value === null, run });
    return id;
  };
  const change = (
    id: string,
    run: (value: string) => unknown,
    accepts: (value: string) => boolean = () => true,
    enabled = true,
    normalize?: (value: string) => string,
  ) => {
    handlers.set(id, {
      enabled,
      accepts: (value: PresentationValue) => typeof value === "string" && accepts(value),
      run: (value) => run(value as string),
      normalize: normalize ? (value) => normalize(value as string) : undefined,
    });
    return id;
  };
  const button = (
    id: string,
    label: string,
    run: () => unknown,
    enabled = true,
  ): PresentationNode => ({
    id,
    kind: "Button",
    label,
    action: action(id, run, enabled),
    disabled: !enabled,
  });
  const showThinking = props.settings.customSettings.appearance.showThinking;
  const contentLabels = {
    thinking: t("chat.thinking"),
    search: t("chat.search.webSearch"),
    arguments: t("chat.toolDetails.arguments"),
    result: t("chat.toolDetails.result"),
  };
  const activityItems = collectActivityItems(props.historyItems, live).filter(
    (item) => !isTaskToolBlock({ kind: "tool", item }),
  );
  const questions = useNativeAskUserQuestions(props.conversationId, activityItems, t);
  for (const [id, handler] of questions.handlers) handlers.set(id, handler);
  const messages = attachReadOnlySyntax(
    createNativeChatTranscript(
      props.historyItems,
      live,
      showThinking,
      t,
      action,
      props.onOpenWorkspaceFile,
      questions.nodes,
    ),
    handlers,
    syntaxPalette,
  );
  const taskProgress = selectLatestTaskProgress(
    props.historyItems,
    live.liveRounds,
    props.taskList,
  );
  const taskProgressNode = createNativeTaskProgress(taskProgress, props.isSending, t);
  const activeActivity = [...activityItems].reverse().find((item) => item.running);
  const latestActivity = activeActivity ?? activityItems.at(-1);
  const latestActivityFrame = latestActivity
    ? [...activityFrames]
        .reverse()
        .find((frame) => !frame.toolCallId || frame.toolCallId === latestActivity.toolCall.id)
    : activityFrames.at(-1);
  const activityPreviewNode: PresentationNode | undefined =
    latestActivity || live.toolStatus
      ? {
          id: "activity-preview",
          kind: "ActivityPreview",
          label: latestActivity?.toolCall.name ?? t("chat.mobileActivity.working"),
          text: latestActivity
            ? summarizeToolCall(latestActivity.toolCall, { includeName: false }) ||
              live.toolStatus ||
              ""
            : live.toolStatus || "",
          icon: activityIcon(latestActivity?.toolCall.name ?? ""),
          value: latestActivityFrame?.imageUrl ?? null,
          status: latestActivity?.running ? "running" : "completed",
          action: action("activity-preview", () => setActivityOpen(true)),
        }
      : undefined;
  const draft = composer.handle.getDraft();
  const mentionNodes: PresentationNode[] = [];
  if (mentionContext?.trigger === "skill") {
    const query = mentionContext.query.toLocaleLowerCase();
    for (const skill of (props.enabledSkills ?? [])
      .filter((skill) =>
        `${skill.name}\n${skill.description}\n${skill.baseDir}`.toLocaleLowerCase().includes(query),
      )
      .slice(0, 12)) {
      mentionNodes.push({
        ...button(
          `mention-skill:${skill.name}`,
          skill.name,
          () => composer.replaceMention(mentionContext, { type: "skillMention", skill }),
          !props.inputDisabled,
        ),
        icon: "sparkles",
        text: skill.description,
      });
    }
  } else if (mentionContext?.trigger === "file" && mentionFiles.key === mentionKey) {
    for (const file of mentionFiles.entries) {
      const reference = createFileMentionReference(file.path, file.kind);
      if (!reference) continue;
      mentionNodes.push({
        ...button(
          `mention-file:${file.path}`,
          file.path,
          () => composer.replaceMention(mentionContext, { type: "fileMention", reference }),
          !props.inputDisabled,
        ),
        icon: file.kind === "dir" ? "folder" : "doc",
      });
    }
  }
  const mentionMenu: PresentationNode | undefined = mentionContext
    ? {
        id: "composer-suggestions",
        kind: "List",
        variant: "composer-suggestions",
        value: mentionScope,
        label: t(mentionContext.trigger === "skill" ? "chat.composer.plugins" : "sidebar.myFiles"),
        children: mentionNodes.length
          ? mentionNodes
          : [
              {
                id: "composer-suggestions-status",
                kind: "Text",
                secondary: true,
                text: t(
                  mentionContext.trigger === "file" &&
                    (mentionFiles.key !== mentionKey || mentionFiles.loading)
                    ? "settings.loading"
                    : mentionFiles.key === mentionKey && mentionFiles.error
                      ? "search.filesFailed"
                      : mentionContext.trigger === "skill"
                        ? "chat.composer.noMatchingEnabledSkills"
                        : "chat.composer.noMatchingFiles",
                ),
              },
            ],
      }
    : undefined;
  const canSend =
    !props.inputDisabled &&
    !props.isUploading &&
    props.modelOptions.length > 0 &&
    (!draft.isEmpty || props.uploads.length > 0);
  const keyboardScope = `${props.conversationId}:${attachmentContext.revision}`;
  const keyboardEnabled =
    !props.inputDisabled && !props.isUploading && props.modelOptions.length > 0;
  const keyboardSubmit = (steer: boolean): PresentationNode => {
    const conversation = props.conversationId;
    const revision = attachmentContext.revision;
    const available = () => {
      const latest = currentProps.current;
      return (
        attachmentContext.conversationId === conversation &&
        attachmentContext.revision === revision &&
        !latest.inputDisabled &&
        !latest.isUploading &&
        latest.modelOptions.length > 0
      );
    };
    return {
      id: steer ? "draft-keyboard-steer" : "draft-keyboard-submit",
      kind: "Button",
      label: t(steer ? "chat.queue.runNow" : "chat.send"),
      disabled: !keyboardEnabled,
      action: change(
        `draft-keyboard:${keyboardScope}:${steer ? "steer" : "submit"}`,
        (text) => {
          if (!available()) throw new Error("This composer is no longer available.");
          // Hardware Return can arrive before the last text edit is acknowledged.
          // Reconcile that native draft without losing unchanged rich references.
          composer.replaceEditorText(text);
          if (!composer.handle.hasContent() && currentProps.current.uploads.length === 0) return;
          const latest = currentProps.current;
          (steer ? (latest.onSteer ?? latest.onSend) : latest.onSend)();
        },
        () => available(),
        keyboardEnabled,
        normalizeLogicalLineEndings,
      ),
    };
  };
  const dismissSuggestions: PresentationNode | undefined = mentionContext
    ? {
        id: "draft-keyboard-dismiss",
        kind: "Button",
        label: t("settings.close"),
        action: action(
          `draft-keyboard-dismiss:${mentionScope}`,
          () => {
            if (
              composer.handle.getText() !== mentionContext.text ||
              composer.getSelection().location !== mentionContext.end
            )
              return;
            setDismissedMentionScope(mentionScope);
          },
          !props.inputDisabled,
        ),
      }
    : undefined;
  const queuedTurns: PresentationNode[] = props.queuedTurns.map((turn, index) => {
    const prefix = `queue:${props.conversationId}:${turn.id}`;
    const queueAction = (
      name: string,
      icon: string,
      run: (id: string) => void,
      enabled = true,
    ): PresentationNode => ({
      ...button(`${prefix}:${name}`, t(`chat.queue.${name}`), () => run(turn.id), enabled),
      icon,
      destructive: name === "delete",
    });
    return {
      id: prefix,
      kind: "HStack",
      spacing: 8,
      children: [
        {
          id: `${prefix}:preview`,
          kind: "VStack",
          spacing: 4,
          children: [
            {
              id: `${prefix}:text`,
              kind: "Text",
              text: turn.previewText || t("chat.queue.emptyMessage"),
              maxLines: 2,
            },
            ...(turn.fileCount > 0
              ? [
                  {
                    id: `${prefix}:files`,
                    kind: "Text" as const,
                    secondary: true,
                    text: t("chat.queue.fileCount").replace("{count}", String(turn.fileCount)),
                  },
                ]
              : []),
          ],
        },
        { id: `${prefix}:spacer`, kind: "Spacer" },
        {
          id: `${prefix}:actions`,
          kind: "Menu",
          variant: "compact",
          icon: "ellipsis",
          label: turn.previewText || t("chat.queue.emptyMessage"),
          children: [
            ...(index > 0 ? [queueAction("moveUp", "arrow.up", props.onMoveQueuedTurnUp)] : []),
            queueAction(
              "edit",
              "square.and.pencil",
              props.onEditQueuedTurn,
              !props.inputDisabled && !props.isUploading,
            ),
            queueAction(
              "runNow",
              "play",
              props.onRunQueuedTurnNow,
              !props.inputDisabled && !props.isUploading && props.modelOptions.length > 0,
            ),
            queueAction("delete", "trash", props.onRemoveQueuedTurn),
          ],
        },
      ],
    };
  });
  const contextUsage = createNativeChatContextUsage(
    {
      conversationId: props.conversationId,
      usedTokens: contextUsedTokens,
      contextWindow: props.contextWindow,
      onManualCompact: props.onManualCompact,
      manualCompactionDisabled: props.manualCompactionDisabled,
    },
    t,
  );
  const contextUsageNode = contextUsage.node;
  for (const [id, handler] of contextUsage.handlers) handlers.set(id, handler);
  const runtime = createNativeChatRuntimeControls(
    {
      controls: props.chatRuntimeControls,
      reasoningOptions: props.reasoningOptions,
      thinkingAlwaysOn: props.thinkingAlwaysOn,
      agentMode: props.settings.system.executionMode !== "text",
      disabled: props.inputDisabled,
      onChange: props.onChatRuntimeControlsChange,
    },
    t,
  );
  for (const [id, handler] of runtime.handlers) handlers.set(id, handler);
  const nodes: PresentationNode[] = [
    {
      id: "chat",
      kind: "ChatLayout",
      text: props.editorSessions
        ? JSON.stringify({ editorSessions: props.editorSessions })
        : undefined,
      fill: true,
      children: [
        ...(!compact
          ? [
              {
                id: "workspace-panel-actions",
                kind: "Menu" as const,
                label: t("chat.workspacePanel.open"),
                icon: "plus",
                children: [
                  {
                    ...button("workspace-open-browser", t("browser.title"), props.onOpenBrowser),
                    icon: "globe",
                  },
                  {
                    ...button(
                      "workspace-open-terminal",
                      t("chat.mobileMenu.terminal"),
                      props.onOpenTerminal,
                    ),
                    icon: "terminal",
                  },
                  ...(props.onNewSideConversation
                    ? [
                        {
                          ...button(
                            "workspace-new-chat",
                            t("chat.newConversation"),
                            props.onNewSideConversation,
                          ),
                          icon: "bubble.left",
                        },
                      ]
                    : []),
                  {
                    ...button(
                      "workspace-open-git",
                      t("chat.mobileMenu.gitReview"),
                      props.onOpenGitReview,
                    ),
                    icon: "arrow.triangle.branch",
                  },
                  {
                    ...button("workspace-open-ssh", t("chat.mobileMenu.ssh"), props.onOpenRemote),
                    icon: "server.rack",
                  },
                ],
              },
            ]
          : []),
        {
          id: "toolbar",
          kind: "HStack",
          padding: 12,
          children: [
            {
              ...button("sidebar", t("tooltip.openSidebar"), () => setSidebarOpen(!sidebarOpen)),
              kind: "IconButton",
              icon: compact ? "xgent.sidebar" : "sidebar.leading",
              variant: compact ? "secondary" : undefined,
            },
            { id: "toolbar-space", kind: "Spacer" },
            ...(!compact && props.onNewSideConversation
              ? [
                  {
                    ...button(
                      "new-side-chat",
                      t("chat.split.toolbar"),
                      props.onNewSideConversation,
                    ),
                    kind: "IconButton" as const,
                    icon: "rectangle.split.2x1",
                  },
                ]
              : []),
            {
              ...button("tools", t("chat.mobileMenu.title"), () => setToolsOpen(true)),
              kind: "IconButton",
              icon: "ellipsis",
              variant: compact ? "secondary" : undefined,
            },
          ],
        },
        ...(props.errorMessage
          ? [{ id: "error", kind: "Text" as const, text: props.errorMessage }]
          : []),
        ...(props.hasMoreHistory
          ? [button("earlier", t("presentation.loadEarlier"), props.onLoadEarlierHistory)]
          : []),
        {
          id: "transcript",
          kind: "ScrollView",
          value: props.conversationId,
          fill: true,
          children: [
            ...(props.modelOptions.length === 0
              ? [
                  {
                    id: "no-model",
                    kind: "EmptyState" as const,
                    label: t("chat.welcome"),
                    text: `${t("chat.noModelSelected")} ${t("chat.configureModel")}`,
                    icon: "sparkles",
                    children: [
                      {
                        ...button("configure-provider", t("chat.goToSettings"), () =>
                          props.onOpenSettings("providers"),
                        ),
                        prominent: true,
                      },
                    ],
                  },
                ]
              : []),
            ...messages,
          ],
        },
        ...props.pendingApprovals.map(
          (approval): PresentationNode => ({
            id: `approval:${approval.toolCallId}`,
            kind: "Section",
            label: approval.toolName,
            children: [
              {
                id: `approval:${approval.toolCallId}:summary`,
                kind: "Text",
                text: approval.summary,
              },
              ...(["approve", "approve_session", "deny"] as const).map((decision) =>
                button(
                  `approval:${approval.toolCallId}:${decision}`,
                  t(
                    decision === "approve"
                      ? "chat.toolApproval.approve"
                      : decision === "deny"
                        ? "chat.toolApproval.deny"
                        : "chat.toolApproval.approveSession",
                  ),
                  () => {
                    const result = props.onDecide(approval.toolCallId, decision);
                    if (!result.ok)
                      throw new Error(result.message || t("chat.toolApproval.failed"));
                  },
                  approval.deadlineAt > Date.now(),
                ),
              ),
            ],
          }),
        ),
        {
          id: "composer",
          kind: "Composer",
          children: [
            ...(queuedTurns.length > 0
              ? [
                  {
                    id: "queued-turns",
                    kind: "Collapsible" as const,
                    label: t("chat.queue.title").replace("{count}", String(queuedTurns.length)),
                    value: props.conversationId,
                    children: [
                      {
                        id: "queued-turns-list",
                        kind: "ScrollView" as const,
                        maxHeight: 160,
                        children: queuedTurns,
                      },
                    ],
                  },
                ]
              : []),
            ...(activityPreviewNode || taskProgressNode
              ? [
                  {
                    id: "activity-strip",
                    kind: "HStack" as const,
                    spacing: 8,
                    children: [
                      ...(activityPreviewNode ? [activityPreviewNode] : []),
                      ...(activityPreviewNode && taskProgressNode
                        ? [{ id: "activity-strip-spacer", kind: "Spacer" as const }]
                        : []),
                      ...(taskProgressNode ? [taskProgressNode] : []),
                    ],
                  },
                ]
              : []),
            ...(mentionMenu ? [mentionMenu] : []),
            {
              id: "draft",
              kind: "ComposerInput",
              focusRequest: composer.getFocusRevision(),
              text: composer.getSelectionRequest(),
              selectionAction: change(
                `draft-selection:${props.conversationId}:${attachmentContext.revision}`,
                (value) => {
                  const selection = decodeNativeComposerSelection(value);
                  if (selection) composer.reportSelection(selection);
                },
                (value) => {
                  const selection = decodeNativeComposerSelection(value);
                  return selection?.text === composer.handle.getText();
                },
                !props.inputDisabled,
              ),
              label: props.inputPlaceholder,
              value: draft.text,
              children: [
                keyboardSubmit(false),
                keyboardSubmit(true),
                ...(dismissSuggestions ? [dismissSuggestions] : []),
              ],
              disabled: props.inputDisabled,
              action: change(
                `draft:${keyboardScope}`,
                composer.replaceEditorText,
                undefined,
                !props.inputDisabled,
                normalizeLogicalLineEndings,
              ),
            },
            ...(voiceError
              ? [
                  {
                    id: "voice-error",
                    kind: "Banner" as const,
                    status: "error" as const,
                    text: voiceError,
                  },
                ]
              : voicePartial
                ? [
                    {
                      id: "voice-partial",
                      kind: "StatusDot" as const,
                      status: "running" as const,
                      label: voicePartial,
                    },
                  ]
                : []),
            ...props.uploads.map((upload) =>
              button(`upload:${upload.relativePath}`, `× ${upload.fileName}`, () =>
                props.onRemoveUpload(upload.relativePath),
              ),
            ),
            {
              id: "composer-actions",
              kind: "HStack",
              children: [
                {
                  id: "attach",
                  kind: "FilePicker",
                  label: t("chat.upload.button"),
                  options: ["camera", "photos", "files"].map((value) => ({
                    value,
                    label: t("chat.upload." + value),
                    disabled: !props.attachmentsEnabled,
                  })),
                  disabled: props.isUploading || props.inputDisabled,
                  children: [
                    {
                      ...button(
                        "attach-plugins",
                        t("chat.composer.plugins"),
                        props.onOpenSkillsHub,
                        !props.inputDisabled,
                      ),
                      icon: "puzzlepiece.extension",
                    },
                    { id: "attach-runtime-divider", kind: "Divider" },
                    ...runtime.nodes,
                  ],
                  action: change(
                    `attach:${props.conversationId}:${attachmentContext.revision}`,
                    async (value) => props.onImportFiles(decodeNativeFiles(value)),
                    undefined,
                    props.attachmentsEnabled && !props.isUploading && !props.inputDisabled,
                  ),
                },
                {
                  id: "command-safety",
                  kind: "Selector",
                  variant: "composer-command-safety",
                  icon: "shield",
                  label: t("settings.commandSafety.title"),
                  value: props.settings.system.commandSafetyMode ?? "ask",
                  options: (["auto", "ask", "sandbox", "sandboxOffline"] as const).map((value) => ({
                    value,
                    label: t(`settings.commandSafety.${value}`),
                  })),
                  disabled: props.inputDisabled || props.settings.system.executionMode === "text",
                  action: change(
                    "command-safety",
                    (value) => props.onCommandSafetyModeChange(value as CommandSafetyMode),
                    (value) => ["auto", "ask", "sandbox", "sandboxOffline"].includes(value),
                    !props.inputDisabled && props.settings.system.executionMode !== "text",
                  ),
                },
                {
                  id: "model",
                  kind: "Selector",
                  variant: "compact",
                  icon: "sparkles",
                  label: t("chat.model"),
                  text: t("chat.searchModel"),
                  value: props.selectedValue ?? "",
                  disabled: props.modelOptions.length === 0,
                  options: props.modelOptions.map((option) => ({
                    value: option.value,
                    label: `${option.providerName} · ${option.label}`,
                    group: option.providerId,
                    groupLabel: option.providerName,
                  })),
                  children: [
                    {
                      id: "model-empty",
                      kind: "EmptyState",
                      label: t("chat.noModelFound"),
                      icon: "magnifyingglass",
                    },
                  ],
                  action: change(
                    "model",
                    (value) => {
                      const selection = parseModelValue(value);
                      if (!selection) throw new Error(t("chat.noModelSelected"));
                      props.onSelectModel(selection);
                    },
                    (value) => props.modelOptions.some((option) => option.value === value),
                    props.modelOptions.length > 0,
                  ),
                },
                ...(contextUsageNode ? [contextUsageNode] : []),
                { id: "composer-spacer", kind: "Spacer" },
                ...(voiceAvailable
                  ? [
                      {
                        ...button(
                          "voice",
                          t(
                            voiceActive
                              ? "chat.composer.voiceListening"
                              : "chat.composer.voiceInput",
                          ),
                          async () => {
                            setVoiceError("");
                            if (!compact) {
                              if (voiceActive) {
                                const capture = desktopVoiceCapture.current;
                                desktopVoiceCapture.current = null;
                                setVoicePartial("");
                                await capture?.stop();
                                return;
                              }
                              const provider = props.settings.stt.provider;
                              if (
                                !props.settings.stt.enabled ||
                                props.settings.stt.providers[provider]?.configured !== true
                              ) {
                                throw new Error(t("chat.composer.voiceNotConfigured"));
                              }
                              setVoiceActive(true);
                              try {
                                desktopVoiceCapture.current = await startDesktopSttCapture({
                                  provider,
                                  onPartial: (text) => setVoicePartial(text.trim()),
                                  onFinal: (text) => {
                                    const value = text.trim();
                                    if (!value) return;
                                    composer.handle.insertText(
                                      `${composer.handle.hasContent() ? " " : ""}${value}`,
                                    );
                                    setVoicePartial("");
                                  },
                                  onError: setVoiceError,
                                  onClosed: () => {
                                    desktopVoiceCapture.current = null;
                                    setVoiceActive(false);
                                    setVoicePartial("");
                                  },
                                });
                              } catch (error) {
                                setVoiceActive(false);
                                throw error;
                              }
                              return;
                            }
                            setVoiceActive(true);
                            try {
                              let permissions = await checkMobileAssistantPermissions();
                              if (permissions.microphone !== "granted")
                                permissions = await requestMobileAssistantPermission("microphone");
                              if (permissions.microphone !== "granted")
                                throw new Error(t("chat.composer.voicePermissionRequired"));
                              const result = await startMobileVoiceInput();
                              if (result.text.trim())
                                composer.handle.insertText(
                                  `${composer.handle.hasContent() ? " " : ""}${result.text.trim()}`,
                                );
                            } finally {
                              setVoiceActive(false);
                            }
                          },
                          !props.inputDisabled && (!compact || !voiceActive),
                        ),
                        kind: "IconButton" as const,
                        icon: voiceActive && !compact ? "stop.circle.fill" : "mic",
                      },
                    ]
                  : []),
                ...(!compact || !props.isSending || canSend
                  ? [
                      {
                        ...button(
                          "send",
                          t(props.isSending ? "chat.queue.addToQueue" : "chat.send"),
                          props.onSend,
                          canSend,
                        ),
                        prominent: true,
                        kind: "IconButton" as const,
                        icon: "arrow.up",
                      },
                    ]
                  : []),
                ...(props.isSending
                  ? [
                      {
                        ...button("stop", t("chat.stopGeneration"), props.onStop),
                        prominent: compact,
                        kind: compact ? ("IconButton" as const) : ("Button" as const),
                        icon: compact ? "stop.fill" : undefined,
                      },
                    ]
                  : []),
              ],
            },
          ],
        },
      ],
    },
  ];

  const sidebarHandlers = new Map<string, PresentationHandler>();
  const finishSidebarAction = () => {
    if (compact) setSidebarOpen(false);
  };
  const sidebarButton = (
    id: string,
    label: string,
    run: () => unknown,
    enabled = true,
  ): PresentationNode => {
    sidebarHandlers.set(id, { enabled, accepts: (value) => value === null, run });
    return {
      id,
      kind: "NavigationRow",
      label,
      action: id,
      icon: compact
        ? undefined
        : (
            {
              skills: "link",
              mcp: "point.3.connected.trianglepath.dotted",
              files: "folder",
              trajectory: "clock.arrow.circlepath",
              "create-project": "plus",
            } as Record<string, string>
          )[id],
      variant: compact ? "sidebar" : undefined,
    };
  };
  const conversationSidebarRow = (
    row: PresentationNode,
    conversationId: string,
  ): PresentationNode => {
    const item = sidebar.byId.get(conversationId);
    if (!item) return row;
    const actions = createNativeConversationActions(
      {
        item,
        store: props.sidebarStore,
        projects: props.projects,
        currentId: props.conversationId,
        onRename: (current) =>
          setConversationDialog({ id: current.id, kind: "rename", title: current.title }),
        onDelete: (id) => setConversationDialog({ id, kind: "delete", title: item.title }),
        onMoved: props.onConversationCwdChanged,
        onOpenInSplit: compact ? undefined : props.onOpenConversationInSplit,
      },
      t,
    );
    for (const [id, handler] of actions.handlers) sidebarHandlers.set(id, handler);
    return {
      ...row,
      variant: "sidebar-conversation-row",
      icon: item.isPinned ? "pin.fill" : row.icon,
      status: actions.running ? "running" : undefined,
      accessibilityValue: actions.running ? t("chat.statusRunningReply") : undefined,
      children: [actions.menu],
    };
  };
  const projectSidebarRows = (project: WorkspaceProject, indent = 0): PresentationNode[] => {
    const archived =
      props.archivedProjectPathKeys?.has(workspaceProjectPathKey(project.path)) ?? false;
    const expanded = expandedProjectIds.has(project.id);
    const key = workspaceProjectPathKey(project.path);
    const state = sidebar.workspaceHistory.get(key);
    const conversations = sortSidebarConversations(
      Array.from(sidebar.byId.values()).filter(
        (item) => workspaceProjectPathKey(item.cwd ?? "") === key,
      ),
    );
    const visible = conversations.slice(0, state?.limit ?? 10);
    return [
      {
        ...sidebarButton(
          `project:${project.id}`,
          project.name,
          () => {
            if (archived) return;
            setExpandedProjectIds((current) => {
              const next = new Set(current);
              if (next.has(project.id)) next.delete(project.id);
              else next.add(project.id);
              return next;
            });
            props.onSelectProject(project);
          },
          !archived,
        ),
        icon: expanded ? "folder.fill" : "folder",
        variant: "sidebar-workspace-row",
        selected: workspaceProjectPathKey(props.uploadWorkdir) === key,
        secondary: archived,
        status: sidebar.runningWorkdirPathKeys.has(key) ? "running" : undefined,
        accessibilityValue: sidebar.runningWorkdirPathKeys.has(key)
          ? t("chat.statusRunningReply")
          : undefined,
        children: [workspaceActions.projectMenu(project)],
        indent,
      },
      ...(expanded && !archived
        ? visible.map((conversation) =>
            conversationSidebarRow(
              {
                ...sidebarButton(
                  `workspace-conversation:${conversation.id}`,
                  conversation.title,
                  () => {
                    props.onSelectConversation(conversation.id);
                    finishSidebarAction();
                  },
                ),
                indent: indent + (compact ? 36 : 18),
                variant: compact ? "sidebar-conversation" : undefined,
                icon: compact ? undefined : "bubble.left",
                selected: props.conversationId === conversation.id,
              },
              conversation.id,
            ),
          )
        : []),
      ...(expanded && !archived && (!state || (state.loading && visible.length === 0))
        ? [
            {
              id: `workspace-loading:${project.id}`,
              kind: "Text" as const,
              text: t("sidebar.readingHistory"),
              indent: indent + 18,
            },
          ]
        : []),
      ...(expanded && !archived && state?.error
        ? [
            {
              ...sidebarButton(`workspace-retry:${project.id}`, t("presentation.retry"), () =>
                props.sidebarStore.loadWorkspaceHistory(project.path),
              ),
              indent: indent + 18,
            },
          ]
        : []),
      ...(expanded && !archived && (state?.hasMore || conversations.length > visible.length)
        ? [
            {
              ...sidebarButton(`workspace-more:${project.id}`, t("presentation.loadMore"), () =>
                props.sidebarStore.loadWorkspaceHistory(project.path, true),
              ),
              indent: indent + 18,
            },
          ]
        : []),
    ];
  };
  const groupByPath = new Map<string, string>();
  for (const group of props.workspaceProjectGroups ?? []) {
    for (const path of group.projectPaths) {
      const key = workspaceProjectPathKey(path);
      if (!groupByPath.has(key)) groupByPath.set(key, group.id);
    }
  }
  const projectNodes: PresentationNode[] = [
    ...(props.workspaceProjectGroups ?? []).flatMap((group): PresentationNode[] => {
      const members = sidebarProjects.filter(
        (project) =>
          groupByPath.get(workspaceProjectPathKey(project.path)) === group.id &&
          !props.archivedProjectPathKeys?.has(workspaceProjectPathKey(project.path)),
      );
      return [
        {
          ...sidebarButton(`group:${group.id}`, group.name, () =>
            props.onToggleWorkspaceGroupCollapsed?.(group.id),
          ),
          icon: group.collapsed ? "folder" : "folder.fill",
          variant: "sidebar-workspace-row",
          children: [workspaceActions.groupMenu(group)],
        },
        ...(!group.collapsed ? members.flatMap((project) => projectSidebarRows(project, 18)) : []),
      ];
    }),
    ...sidebarProjects
      .filter(
        (project) => !props.archivedProjectPathKeys?.has(workspaceProjectPathKey(project.path)),
      )
      .filter((project) => !groupByPath.has(workspaceProjectPathKey(project.path)))
      .flatMap((project) => projectSidebarRows(project)),
    ...(props.projects.some((project) =>
      props.archivedProjectPathKeys?.has(workspaceProjectPathKey(project.path)),
    )
      ? [
          {
            ...sidebarButton(
              "archived-projects-label",
              t("chat.workspaceArchivedGroup").replace(
                "{count}",
                String(
                  props.projects.filter((project) =>
                    props.archivedProjectPathKeys?.has(workspaceProjectPathKey(project.path)),
                  ).length,
                ),
              ),
              () => setArchivedGroupOpen((current) => !current),
            ),
            icon: archivedGroupOpen ? "chevron.down" : "chevron.right",
            accessibilityValue: t(
              archivedGroupOpen ? "chat.workspaceCollapse" : "chat.workspaceExpand",
            ),
          },
          ...(archivedGroupOpen
            ? sidebarProjects
                .filter((project) =>
                  props.archivedProjectPathKeys?.has(workspaceProjectPathKey(project.path)),
                )
                .flatMap((project) => projectSidebarRows(project))
            : []),
        ]
      : []),
  ];
  for (const [id, handler] of workspaceActions.handlers) sidebarHandlers.set(id, handler);
  sidebarHandlers.set("sidebar-execution-mode", {
    enabled: true,
    accepts: (value) => value === "text" || value === "tools",
    run: (value) => props.onChangeMode(value as "text" | "tools"),
  });
  sidebarHandlers.set("sidebar-search-toggle", {
    enabled: true,
    accepts: (value) => value === null,
    run: () => setWorkspaceSearchOpen(true),
  });
  sidebarHandlers.set("close", {
    enabled: true,
    accepts: (value) => value === null,
    run: () => setSidebarOpen(false),
  });
  const toolsHandlers = new Map<string, PresentationHandler>();
  const toolRow = (
    id: string,
    label: string,
    icon: string,
    run: () => unknown,
  ): PresentationNode => {
    toolsHandlers.set(id, {
      enabled: true,
      accepts: (value) => value === null,
      run: () => {
        setToolsOpen(false);
        return run();
      },
    });
    return { id, kind: "NavigationRow", label, icon, action: id };
  };
  toolsHandlers.set("close", {
    enabled: true,
    accepts: (value) => value === null,
    run: () => setToolsOpen(false),
  });
  const openTrajectory = () => {
    if (compact || !props.trajectoryAvailable) return;
    setSidebarOpen(false);
    setToolsOpen(false);
    setTrajectoryOpen(true);
  };
  const activityControls = presentationControls();
  const soulMenu = createNativeSidebarSoulMenu(
    {
      mobile: compact,
      readSoul: () => soulRef.current,
      request: soulRequest,
      onCreate: props.onCreateSoul
        ? () => {
            finishSidebarAction();
            props.onCreateSoul?.();
          }
        : undefined,
      tools: [
        {
          id: "sidebar-soul-terminal",
          label: t("sidebar.terminal"),
          icon: "terminal",
          run: props.onOpenTerminal,
        },
        {
          id: "sidebar-soul-git",
          label: t("sidebar.gitReview"),
          icon: "arrow.triangle.branch",
          run: props.onOpenGitReview,
        },
        {
          id: "sidebar-soul-ssh",
          label: t("sidebar.sshConnection"),
          icon: "key",
          run: props.onOpenRemote,
        },
        {
          id: "sidebar-soul-background",
          label: t("sidebar.backgroundTasks"),
          icon: "cpu",
          run: props.onOpenBackgroundTasks,
        },
        {
          id: "sidebar-soul-trajectory",
          label: t("chat.trajectory.open"),
          icon: "waveform.path",
          run: openTrajectory,
          enabled: props.trajectoryAvailable,
        },
        {
          id: "sidebar-soul-settings",
          label: t("tooltip.settings"),
          icon: "gearshape",
          run: () => props.onOpenSettings(),
        },
      ],
    },
    t,
  );
  for (const [id, handler] of soulMenu.handlers) sidebarHandlers.set(id, handler);
  const sidebarUpdate = createNativeSidebarUpdate(
    { readController: () => appUpdateRef.current, request: updateRequest, setBusy: setUpdateBusy },
    t,
  );
  for (const [id, handler] of sidebarUpdate.handlers) sidebarHandlers.set(id, handler);
  for (const [id, handler] of questions.handlers) activityControls.handlers.set(id, handler);
  activityControls.handlers.set("close", {
    enabled: true,
    accepts: (value) => value === null,
    run: () => setActivityOpen(false),
  });
  const activityNodes: PresentationNode[] = activityItems.length
    ? activityItems.map(
        (item) =>
          questions.nodes.get(item.toolCall.id) ?? {
            id: `activity:${item.toolCall.id}`,
            kind: "ToolCall",
            label: item.toolCall.name,
            text: summarizeToolCall(item.toolCall, { includeName: false }),
            status: item.running
              ? "running"
              : item.toolResult?.isError
                ? "error"
                : item.toolResult
                  ? "completed"
                  : "pending",
            children: toolEvidenceNodes(
              item.toolResult,
              `activity:${item.toolCall.id}`,
              safeStringify(item.toolCall.arguments),
              contentLabels,
              item.toolCall.arguments,
            ),
          },
      )
    : [
        {
          id: "activity-empty",
          kind: "EmptyState",
          icon: "hammer",
          label: t("chat.mobileActivity.empty"),
          text: t("chat.mobileActivity.emptyDescription"),
        },
      ];
  if (activityItems.some((item) => activityIcon(item.toolCall.name) === "globe")) {
    activityNodes.unshift(
      activityControls.action("activity-browser", t("browser.title"), () => {
        setActivityOpen(false);
        props.onOpenBrowser();
      }),
    );
  }
  const dialogControls = presentationControls();
  const dialogBusy = conversationDialog
    ? sidebar.mutations?.has(conversationDialog.id) === true
    : false;
  const dialogRunning = conversationDialog
    ? sidebar.runningConversationIds?.has(conversationDialog.id) === true
    : false;
  const closeConversationDialog = () => setConversationDialog(null);
  dialogControls.handlers.set("close", {
    enabled: !dialogBusy,
    accepts: (value) => value === null,
    run: closeConversationDialog,
  });
  const dialogNodes: PresentationNode[] = [];
  if (conversationDialog) {
    const { id, kind, title } = conversationDialog;
    dialogNodes.push(
      kind === "rename"
        ? dialogControls.input(
            "conversation-title",
            t("chat.conversationRename"),
            title,
            (value) =>
              setConversationDialog((current) => (current ? { ...current, title: value } : null)),
            false,
            !dialogBusy,
          )
        : {
            id: "delete-warning",
            kind: "Text",
            text: `${t("chat.conversationDeleteConfirm").replace("{title}", title)}\n\n${t("chat.conversationDeleteWarning")}`,
          },
    );
    dialogNodes.push(
      dialogControls.action("cancel", t("chat.cancel"), closeConversationDialog, !dialogBusy),
      {
        ...dialogControls.action(
          "confirm",
          t(kind === "rename" ? "settings.save" : "chat.conversationDelete"),
          async () => {
            const normalized = normalizeConversationTitle(title);
            await mutateNativeConversation(
              props.sidebarStore,
              id,
              kind,
              () =>
                kind === "rename"
                  ? props.sidebarStore.rename(id, normalized)
                  : props.sidebarStore.remove(id),
              t,
            );
            if (kind === "delete") props.onConversationDeleted(id);
            setConversationDialog((current) =>
              current?.id === id && current.kind === kind ? null : current,
            );
          },
          !dialogBusy &&
            !dialogRunning &&
            (kind === "delete" || !!normalizeConversationTitle(title)),
        ),
        destructive: kind === "delete",
        prominent: kind === "rename",
      },
    );
  }
  return (
    <>
      <NativeSurface
        document={{
          mode: "root",
          title: "Xgent",
          appearance: props.settings.theme,
          formFactor: compact ? "mobile" : "desktop",
          theme: createNativePresentationTheme(props.settings, compact, "chat"),
          nodes,
        }}
        handlers={handlers}
        onError={setFailure}
      />
      {sidebarOpen ? (
        <NativeSurface
          document={{
            mode: "sidebar",
            title: "Xgent",
            appearance: props.settings.theme,
            formFactor: compact ? "mobile" : "desktop",
            theme: createNativePresentationTheme(props.settings, compact, "sidebar"),
            dismissAction: "close",
            nodes: [
              {
                id: "sidebar-layout",
                kind: "VStack",
                fill: true,
                padding: 16,
                children: [
                  { id: "sidebar-title", kind: "Heading" as const, text: "Xgent" },
                  ...(!compact
                    ? [
                        {
                          id: "sidebar-close",
                          kind: "IconButton" as const,
                          label: t("sidebar.closeSidebar"),
                          icon: "sidebar.leading",
                          action: "close",
                          variant: "ghost",
                        },
                      ]
                    : []),
                  {
                    id: "sidebar-execution-mode",
                    kind: "Selector",
                    variant: "sidebar-work-mode",
                    label: t("settings.executionMode"),
                    value: props.settings.system.executionMode === "text" ? "text" : "tools",
                    options: [
                      { value: "text", label: "XChat" },
                      { value: "tools", label: "XGent" },
                    ],
                    action: "sidebar-execution-mode",
                  },
                  {
                    id: "sidebar-search-toggle",
                    kind: "IconButton",
                    label: t("search.title"),
                    icon: "magnifyingglass",
                    action: "sidebar-search-toggle",
                  },
                  {
                    id: "sidebar-list",
                    kind: "List",
                    children: [
                      ...(compact
                        ? [
                            {
                              ...sidebarButton("files", t("sidebar.mobile.library"), () => {
                                finishSidebarAction();
                                props.onOpenFiles();
                              }),
                              icon: "folder",
                            },
                            {
                              ...sidebarButton("skills", t("sidebar.mobile.plugins"), () => {
                                finishSidebarAction();
                                props.onOpenSkillsHub();
                              }),
                              icon: "circle.hexagongrid",
                            },
                            {
                              ...sidebarButton("scheduled", t("sidebar.mobile.scheduled"), () => {
                                finishSidebarAction();
                                props.onOpenBackgroundTasks();
                              }),
                              icon: "clock",
                            },
                            {
                              ...sidebarButton("remote", t("sidebar.mobile.remote"), () => {
                                finishSidebarAction();
                                props.onOpenRemote();
                              }),
                              icon: "server.rack",
                            },
                            {
                              ...sidebarButton("mcp", t("sidebar.mobile.more"), () => {
                                finishSidebarAction();
                                props.onOpenMcpHub();
                              }),
                              icon: "ellipsis",
                            },
                          ]
                        : [
                            ...(["skills", "mcp"] as const).map((section) =>
                              sidebarButton(
                                section,
                                t(section === "skills" ? "sidebar.mobile.plugins" : "mcpHub.title"),
                                () => {
                                  finishSidebarAction();
                                  if (section === "skills") props.onOpenSkillsHub();
                                  else props.onOpenMcpHub();
                                },
                              ),
                            ),
                            sidebarButton("files", t("sidebar.myFiles"), () => {
                              finishSidebarAction();
                              props.onOpenFiles();
                            }),
                          ]),
                      ...(!compact && props.trajectoryAvailable
                        ? [sidebarButton("trajectory", t("chat.trajectory.title"), openTrajectory)]
                        : []),
                      sidebarButton("create-project", t("chat.workspaceCreate"), () => {
                        finishSidebarAction();
                        props.onCreateProject();
                      }),
                      {
                        id: "projects-label",
                        kind: "HStack",
                        variant: "sidebar-section-heading",
                        text: t("chat.workspaceSection"),
                        children: [workspaceActions.workspaceMenu],
                      },
                      ...projectNodes,
                      { id: "recents-label", kind: "Heading", text: t("chat.recentConversation") },
                      ...recentChats.map((conversation) =>
                        conversationSidebarRow(
                          {
                            ...sidebarButton(
                              `conversation:${conversation.id}`,
                              conversation.title,
                              () => {
                                props.onSelectConversation(conversation.id);
                                finishSidebarAction();
                              },
                            ),
                            variant: compact ? "sidebar-conversation" : undefined,
                            selected: props.conversationId === conversation.id,
                          },
                          conversation.id,
                        ),
                      ),
                      ...(sidebar.recentHistory.hasMore
                        ? [
                            sidebarButton("more", t("presentation.loadMore"), () =>
                              props.sidebarStore.loadRecentHistory(true),
                            ),
                          ]
                        : []),
                      ...(sidebar.recentHistory.error || sidebar.listErrorDetail
                        ? [
                            {
                              id: "sidebar:error",
                              kind: "Text" as const,
                              text: sidebar.recentHistory.error ?? sidebar.listErrorDetail ?? "",
                            },
                            sidebarButton("retry", t("presentation.retry"), () =>
                              sidebar.recentHistory.error
                                ? props.sidebarStore.loadRecentHistory()
                                : props.sidebarStore.refresh({ reason: "manual" }),
                            ),
                          ]
                        : []),
                    ],
                  },
                  {
                    id: "sidebar-footer",
                    kind: "HStack",
                    children: [
                      {
                        ...sidebarButton(
                          "new-chat",
                          compact ? t("chat.mode.chat") : t("chat.newConversation"),
                          () => {
                            props.onNewConversation();
                            finishSidebarAction();
                          },
                        ),
                        kind: "Button",
                        icon: "square.and.pencil",
                        prominent: true,
                        accessibilityLabel: compact ? t("chat.newConversation") : undefined,
                      },
                      { id: "sidebar-footer-space", kind: "Spacer" },
                      ...(!compact ? [soulMenu.node] : []),
                      {
                        ...sidebarButton("settings", t("tooltip.settings"), () => {
                          finishSidebarAction();
                          props.onOpenSettings();
                        }),
                        kind: "IconButton",
                        icon: "gearshape",
                        ...(compact
                          ? { variant: "sidebar-settings", children: [soulMenu.node] }
                          : {}),
                      },
                      ...(sidebarUpdate.node ? [sidebarUpdate.node] : []),
                    ],
                  },
                ],
              },
            ],
          }}
          handlers={sidebarHandlers}
          onError={setFailure}
        />
      ) : null}
      {toolsOpen ? (
        <NativeSurface
          document={{
            mode: "sheet",
            title: t("chat.mobileMenu.title"),
            appearance: props.settings.theme,
            formFactor: compact ? "mobile" : "desktop",
            theme: createNativePresentationTheme(props.settings, compact, "workspaceTools"),
            dismissAction: "close",
            nodes: [
              {
                id: "tools-list",
                kind: "List",
                children: [
                  toolRow(
                    "tool:terminal",
                    t("chat.mobileMenu.terminal"),
                    "terminal",
                    props.onOpenTerminal,
                  ),
                  ...(compact
                    ? [
                        toolRow("tool:shell", t("chat.mobileMenu.rootfs"), "shippingbox", () =>
                          props.onOpenSettings("mobileExecution"),
                        ),
                      ]
                    : []),
                  toolRow(
                    "tool:browser",
                    t("chat.mobileMenu.browser"),
                    "globe",
                    props.onOpenBrowser,
                  ),
                  toolRow(
                    "tool:browser-settings",
                    t("chat.mobileMenu.browserSettings"),
                    "gearshape",
                    props.onOpenBrowserSettings,
                  ),
                  toolRow(
                    "tool:git",
                    t("chat.mobileMenu.gitReview"),
                    "arrow.triangle.branch",
                    props.onOpenGitReview,
                  ),
                  toolRow("tool:ssh", t("chat.mobileMenu.ssh"), "server.rack", props.onOpenRemote),
                  toolRow(
                    "tool:background",
                    t("chat.mobileMenu.background"),
                    "clock.arrow.circlepath",
                    props.onOpenBackgroundTasks,
                  ),
                  ...(!compact && props.trajectoryAvailable
                    ? [
                        toolRow(
                          "tool:trajectory",
                          t("chat.trajectory.title"),
                          "point.3.connected.trianglepath.dotted",
                          openTrajectory,
                        ),
                      ]
                    : []),
                ],
              },
            ],
          }}
          handlers={toolsHandlers}
          onError={setFailure}
        />
      ) : null}
      {activityOpen ? (
        <NativeSurface
          document={{
            mode: "sheet",
            title: t("chat.activity.title"),
            appearance: props.settings.theme,
            formFactor: compact ? "mobile" : "desktop",
            theme: createNativePresentationTheme(props.settings, compact, "workspaceTools"),
            dismissAction: "close",
            nodes: attachReadOnlySyntax(
              nativeReadOnlyCodeNodes(activityNodes, t),
              activityControls.handlers,
              syntaxPalette,
            ),
          }}
          handlers={activityControls.handlers}
          onError={setFailure}
        />
      ) : null}
      {conversationDialog ? (
        <NativeSurface
          document={{
            mode: "sheet",
            title: t(
              conversationDialog.kind === "rename"
                ? "chat.conversationRename"
                : "chat.conversationDelete",
            ),
            appearance: props.settings.theme,
            formFactor: compact ? "mobile" : "desktop",
            theme: createNativePresentationTheme(props.settings, compact, "sidebar"),
            dismissAction: "close",
            nodes: dialogNodes,
          }}
          handlers={dialogControls.handlers}
          onError={setFailure}
        />
      ) : null}
      {workspaceActions.dialog ? (
        <NativeSurface
          document={{
            mode: "sheet",
            title: workspaceActions.dialog.title,
            appearance: props.settings.theme,
            formFactor: compact ? "mobile" : "desktop",
            theme: createNativePresentationTheme(props.settings, compact, "sidebar"),
            dismissAction: "workspace-dialog-cancel",
            nodes: workspaceActions.dialog.nodes,
          }}
          handlers={workspaceActions.dialog.handlers}
          onError={setFailure}
        />
      ) : null}
      {workspaceSearchOpen ? (
        <NativeWorkspaceSearchPalette
          open
          settings={props.settings}
          workdir={props.uploadWorkdir}
          conversations={searchableConversations}
          onOpenChange={setWorkspaceSearchOpen}
          onSelectConversation={(id) => {
            finishSidebarAction();
            props.onSelectConversation(id);
          }}
          onOpenFile={(path) => {
            finishSidebarAction();
            props.onOpenWorkspaceFile(path);
          }}
          onOpenSettings={(section) => {
            finishSidebarAction();
            props.onOpenSettings(section);
          }}
          onNewConversation={() => {
            finishSidebarAction();
            props.onNewConversation();
          }}
          onCreateProject={() => {
            finishSidebarAction();
            props.onCreateProject();
          }}
        />
      ) : null}
      {!compact && trajectoryOpen ? (
        <Suspense fallback={null}>
          <NativeDesktopTrajectory
            conversationId={props.conversationId}
            settings={props.settings}
            onClose={() => setTrajectoryOpen(false)}
            onError={setFailure}
          />
        </Suspense>
      ) : null}
    </>
  );
}
