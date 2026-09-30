import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { generateDiffFile } from "@git-diff-view/file";
import { invoke } from "@xgent/runtime";
import {
  lazy,
  type MutableRefObject,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  MentionComposerHandle,
  MentionComposerSkill,
} from "../components/chat/MentionComposer";
import { useLocale } from "../i18n";
import { collectActivityItems } from "../lib/chat/activityTimeline";
import { contextUsageRatio } from "../lib/chat/contextUsage";
import type { RenderTimelineItem } from "../lib/chat/conversation/conversationState";
import type { LiveTranscriptStore } from "../lib/chat/conversation/liveTranscriptStore";
import { executionActivityStore } from "../lib/chat/executionActivityStore";
import {
  readChatLayoutPreferences,
  saveChatLayoutPreferences,
} from "../lib/chat/layoutPreferences";
import { collectChangedFiles } from "../lib/chat/messages/changedFiles";
import { collectCloudArtifacts } from "../lib/chat/messages/cloudArtifacts";
import { normalizeLogicalLineEndings } from "../lib/chat/messages/composerText";
import { collectPreviewedFiles } from "../lib/chat/messages/previewedFiles";
import { readStreamPreviewMeta } from "../lib/chat/messages/toolPreview";
import {
  safeStringify,
  summarizeToolCall,
  toolResultMessageToText,
  type UiRound,
} from "../lib/chat/messages/uiMessages";
import type { PendingUploadedFile } from "../lib/chat/messages/uploadedFiles";
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
  ReasoningLevel,
  SelectedModel,
  WorkspaceProject,
} from "../lib/settings";
import { workspaceProjectPathKey } from "../lib/settings";
import { sortSidebarConversations } from "../lib/sidebar/reconcile";
import type { SidebarStore } from "../lib/sidebar/store";
import { type DesktopSttCapture, startDesktopSttCapture } from "../lib/stt/desktopAudioCapture";
import type {
  EditResultDetails,
  TaskListState,
  WriteResultDetails,
} from "../lib/tools/builtinTypes";
import type { PendingToolApprovalSummary, ToolApprovalDecision } from "../lib/tools/toolApproval";
import type { ChatQueueTurnPreview } from "../pages/chat/components/ChatComposerBar";
import { createNativeComposerStore } from "./composerStore";
import { presentationControls } from "./controls";
import { NativeSurface } from "./NativeSurface";
import { createNativeChatRuntimeControls } from "./nativeChatRuntimeControls";
import { decodeNativeFiles } from "./nativeFiles";
import { createNativePresentationTheme } from "./nativeTheme";
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

function toolResultPreviewNodes(result: unknown, prefix: string): PresentationNode[] {
  if (!result || typeof result !== "object") return [];
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((raw, index): PresentationNode[] => {
    if (!raw || typeof raw !== "object") return [];
    const block = raw as Record<string, unknown>;
    if (
      block.type !== "image" ||
      typeof block.data !== "string" ||
      typeof block.mimeType !== "string" ||
      !/^image\/(?:png|jpeg|webp|gif)$/.test(block.mimeType)
    ) {
      return [];
    }
    return [
      {
        id: `${prefix}:preview:${index}`,
        kind: "MediaPreview",
        label: `Image ${index + 1}`,
        value: `data:${block.mimeType};base64,${block.data}`,
        language: block.mimeType,
      },
    ];
  });
}

function toolEvidenceNodes(
  result: ToolResultMessage | undefined,
  prefix: string,
  argumentsText: string,
  labels: { arguments: string; result: string },
  args?: Record<string, unknown>,
): PresentationNode[] {
  const text = result ? toolResultMessageToText(result) : "";
  const nodes: PresentationNode[] = argumentsText
    ? [
        {
          id: `${prefix}:arguments`,
          kind: "CodeBlock",
          label: labels.arguments,
          language: "json",
          text: argumentsText,
        },
      ]
    : [];
  nodes.push(...toolResultPreviewNodes(result, prefix));
  if (text) {
    nodes.push({
      id: `${prefix}:result`,
      kind: "CodeBlock",
      label: labels.result,
      language: "text",
      text,
    });
  }
  if (!result || result.isError) return nodes;
  const details = result.details;
  if (details && typeof details === "object" && "kind" in details && details.kind === "edit") {
    const edit = details as EditResultDetails;
    if (edit.oldPreview || edit.newPreview) {
      const path = edit.displayPath || edit.path;
      const exactSnapshot =
        typeof edit.beforeContent === "string" &&
        typeof edit.afterContent === "string" &&
        edit.beforeContent.length + edit.afterContent.length <= 200_000;
      const previewMeta = args ? readStreamPreviewMeta(args) : undefined;
      const oldText = exactSnapshot
        ? edit.beforeContent
        : typeof args?.old_string === "string" && previewMeta?.fields.old_string?.truncated !== true
          ? args.old_string
          : args?.old_string === undefined && edit.oldPreview.length <= 500
            ? edit.oldPreview
            : undefined;
      const newText = exactSnapshot
        ? edit.afterContent
        : typeof args?.new_string === "string" && previewMeta?.fields.new_string?.truncated !== true
          ? args.new_string
          : args?.new_string === undefined && edit.newPreview.length <= 500
            ? edit.newPreview
            : undefined;
      if (
        oldText !== undefined &&
        newText !== undefined &&
        oldText.length + newText.length <= 200_000 &&
        (exactSnapshot ||
          ((edit.matchStrategy === undefined || edit.matchStrategy === "exact") &&
            edit.replaceAll !== true &&
            (edit.replacements ?? 1) === 1))
      ) {
        const diff = generateDiffFile(path, oldText, path, newText, "txt", "txt");
        diff.initRaw();
        nodes.push({
          id: `${prefix}:diff`,
          kind: "CodeBlock",
          label: path,
          language: "diff",
          text: diff._diffList.join("\n"),
        });
      } else {
        nodes.push({
          id: `${prefix}:edit-preview`,
          kind: "CodeBlock",
          label: path,
          language: "text",
          text: `${edit.oldPreview}\n→\n${edit.newPreview}`,
        });
      }
    }
  } else if (
    details &&
    typeof details === "object" &&
    "kind" in details &&
    details.kind === "write"
  ) {
    const write = details as WriteResultDetails;
    const content =
      typeof args?.content === "string" &&
      readStreamPreviewMeta(args)?.fields.content?.truncated !== true
        ? args.content
        : undefined;
    if (
      typeof write.beforeContent === "string" &&
      content !== undefined &&
      write.beforeContent.length + content.length <= 200_000
    ) {
      const path = write.displayPath || write.path;
      const diff = generateDiffFile(path, write.beforeContent, path, content, "txt", "txt");
      diff.initRaw();
      nodes.push({
        id: `${prefix}:diff`,
        kind: "CodeBlock",
        label: path,
        language: "diff",
        text: diff._diffList.join("\n"),
      });
    } else if (write.preview) {
      nodes.push({
        id: `${prefix}:content`,
        kind: "CodeBlock",
        label: write.displayPath || write.path,
        language: "text",
        text: write.preview,
      });
    }
  }
  return nodes;
}

export type NativeChatPageProps = {
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
  inputDisabled: boolean;
  inputPlaceholder: string;
  isSending: boolean;
  errorMessage: string | null;
  hasMoreHistory: boolean;
  pendingApprovals: PendingToolApprovalSummary[];
  projects: WorkspaceProject[];
  attachmentsEnabled: boolean;
  trajectoryAvailable: boolean;
  uploads: PendingUploadedFile[];
  taskList?: TaskListState;
  isUploading: boolean;
  onSend: () => void;
  onStop: () => void;
  queuedTurns: ChatQueueTurnPreview[];
  onRunQueuedTurnNow: (id: string) => void;
  onMoveQueuedTurnUp: (id: string) => void;
  onEditQueuedTurn: (id: string) => void;
  onRemoveQueuedTurn: (id: string) => void;
  onSelectModel: (selection: SelectedModel) => void;
  onSelectConversation: (id: string) => void;
  onSelectProject: (project: WorkspaceProject) => void;
  onNewConversation: () => void;
  onOpenSettings: (
    section?: "skills" | "cron" | "ssh" | "mcp" | "mobileExecution" | "providers",
  ) => void;
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
  onLoadEarlierHistory: () => Promise<unknown> | void;
  onDecide: (id: string, decision: ToolApprovalDecision) => { ok: boolean; message?: string };
  onCreateProject: () => void;
  onOpenTerminal: () => void;
  onImportFiles: (files: File[]) => Promise<void>;
  onRemoveUpload: (path: string) => void;
};

function roundNodes(
  rounds: UiRound[],
  prefix: string,
  showThinking: boolean,
  labels: { thinking: string; search: string; arguments: string; result: string },
): PresentationNode[] {
  return rounds.flatMap((round) =>
    round.blocks.flatMap((block): PresentationNode[] => {
      const id = `${prefix}:${round.key}`;
      if (block.kind === "text") {
        return [
          {
            id: `${id}:${block.id}`,
            kind: "Markdown",
            text: block.text,
          },
        ];
      }
      if (block.kind === "thinking") {
        if (!showThinking) return [];
        const running = "thinkingOpen" in round && round.thinkingOpen;
        return [
          {
            id: `${id}:${block.id}`,
            kind: "Thinking",
            label: labels.thinking,
            text: block.text,
            status: running ? "running" : "completed",
          },
        ];
      }
      if (block.kind === "tool") {
        if (isTaskToolBlock(block)) return [];
        const running =
          "runningToolCallIds" in round &&
          Array.isArray(round.runningToolCallIds) &&
          round.runningToolCallIds.includes(block.item.toolCall.id);
        return [
          {
            id: `${id}:tool:${block.item.toolCall.id}`,
            kind: "ToolCall",
            label: block.item.toolCall.name,
            text: summarizeToolCall(block.item.toolCall, { includeName: false }),
            status: running
              ? "running"
              : block.item.toolResult?.isError
                ? "error"
                : block.item.toolResult
                  ? "completed"
                  : "pending",
            children: toolEvidenceNodes(
              block.item.toolResult,
              `${id}:tool:${block.item.toolCall.id}`,
              safeStringify(block.item.toolCall.arguments),
              labels,
              block.item.toolCall.arguments,
            ),
          },
        ];
      }
      if (block.kind === "hostedSearch") {
        const sourceText = block.item.sources
          .map((source) => `${source.title || source.url}\n${source.url}`)
          .join("\n\n");
        return [
          {
            id: `${id}:search:${block.item.id}`,
            kind: "ToolCall",
            label: labels.search,
            text: block.item.queries.join(", "),
            status:
              block.item.status === "searching"
                ? "running"
                : block.item.status === "failed"
                  ? "error"
                  : "completed",
            children: sourceText
              ? [
                  {
                    id: `${id}:search:${block.item.id}:sources`,
                    kind: "Text",
                    text: sourceText,
                    secondary: true,
                  },
                ]
              : [],
          },
        ];
      }
      return [];
    }),
  );
}

export function NativeChatPage(props: NativeChatPageProps) {
  const { t } = useLocale();
  const compact = isNativeMobileRuntime();
  const [composer] = useState(createNativeComposerStore);
  useSyncExternalStore(composer.subscribe, composer.getSnapshot, composer.getSnapshot);
  const sidebar = useSyncExternalStore(
    props.sidebarStore.subscribe,
    props.sidebarStore.getSnapshot,
  );
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
  const [query, setQuery] = useState("");
  const [sidebarSearchVisible, setSidebarSearchVisible] = useState(false);
  const [sidebarProjectsOpen, setSidebarProjectsOpen] = useState(true);
  const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  useEffect(() => {
    if (!sidebarOpen || !sidebarProjectsOpen) return;
    for (const project of props.projects) {
      if (
        expandedProjectIds.has(project.id) &&
        !sidebar.workspaceHistory.has(workspaceProjectPathKey(project.path))
      ) {
        void props.sidebarStore.loadWorkspaceHistory(project.path);
      }
    }
  }, [
    expandedProjectIds,
    props.projects,
    props.sidebarStore,
    sidebar.workspaceHistory,
    sidebarOpen,
    sidebarProjectsOpen,
  ]);
  const recentChats = sortSidebarConversations(
    Array.from(sidebar.byId.values()).filter((item) => !item.cwd?.trim()),
  ).slice(0, sidebar.recentHistory.limit);
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
  const messages: PresentationNode[] = props.historyItems.flatMap((item): PresentationNode[] => {
    if (item.kind === "assistant") {
      const artifacts = collectCloudArtifacts(item.rounds);
      const changedSummary = collectChangedFiles(item.rounds);
      const changedFiles = changedSummary?.files.filter((file) => !file.deleted) ?? [];
      const previewedFiles = collectPreviewedFiles(item.rounds, changedSummary);
      return [
        {
          id: item.key,
          kind: "ChatMessage",
          role: "assistant",
          children: [
            ...roundNodes(item.rounds, item.key, showThinking, contentLabels),
            ...changedFiles.map((file): PresentationNode => {
              const id = `${item.key}:changed-file:${file.lastToolCallId}`;
              return {
                id,
                kind: "Button",
                label: file.path,
                icon: "doc",
                variant: "secondary",
                size: "small",
                accessibilityHint: t("projectTools.fileTree.openFile"),
                action: action(id, () => props.onOpenWorkspaceFile(file.path)),
              };
            }),
            ...previewedFiles.map((file): PresentationNode => {
              const id = `${item.key}:previewed-file:${file.toolCallId}`;
              return {
                id,
                kind: "Button",
                label: file.path,
                icon: "doc",
                variant: "secondary",
                size: "small",
                accessibilityHint: t("projectTools.fileTree.openFile"),
                action: action(id, () => props.onOpenWorkspaceFile(file.path)),
              };
            }),
            ...artifacts.map((artifact): PresentationNode => {
              const id = `${item.key}:cloud-artifact:${artifact.taskId}:${artifact.artifactId}`;
              const name =
                artifact.localPath.replaceAll("\\", "/").split("/").pop() || artifact.artifactName;
              return {
                id,
                kind: "Button",
                label: name,
                icon: "doc",
                variant: "secondary",
                size: "small",
                accessibilityHint: t("chat.cloudArtifacts.inline"),
                action: action(id, () =>
                  invoke("cloud_task_open_artifact", { localPath: artifact.localPath }),
                ),
              };
            }),
          ],
        },
      ];
    }
    if (item.kind === "summary") {
      return [
        {
          id: item.key,
          kind: "ChatMessage",
          role: "system",
          children: [{ id: `${item.key}:text`, kind: "Markdown", text: item.content }],
        },
      ];
    }
    return [
      {
        id: item.key,
        kind: "ChatMessage",
        role: "user",
        children: [
          {
            id: `${item.key}:text`,
            kind: "Markdown",
            text: item.text,
          },
          ...item.attachments.map(
            (attachment): PresentationNode => ({
              id: `${item.key}:attachment:${attachment.relativePath}`,
              kind: "Badge",
              label: attachment.fileName,
              status: "completed",
            }),
          ),
        ],
      },
    ];
  });
  if (!live.isSettled) {
    const liveChildren = roundNodes(live.liveRounds, "live", showThinking, contentLabels);
    if (live.liveRounds.length === 0 && live.draftAssistantText) {
      liveChildren.push({ id: "live:draft", kind: "Markdown", text: live.draftAssistantText });
    }
    if (live.toolStatus)
      liveChildren.push({
        id: "live:status",
        kind: "StatusDot",
        label: live.toolStatus,
        status: "running",
      });
    if (liveChildren.length > 0) {
      messages.push({
        id: "live:assistant",
        kind: "ChatMessage",
        role: "assistant",
        children: liveChildren,
      });
    }
  }
  const taskProgress = selectLatestTaskProgress(
    props.historyItems,
    live.liveRounds,
    props.taskList,
  );
  const taskProgressNode: PresentationNode | undefined = taskProgress?.tasks.length
    ? {
        id: `task-progress:${taskProgress.runId}`,
        kind: "TaskProgress",
        label:
          taskProgress.tasks.find((task) => task.status === "in_progress")?.activeForm ||
          taskProgress.tasks.find((task) => task.status !== "completed")?.subject ||
          t("chat.tasks.completed"),
        text: `${taskProgress.tasks.filter((task) => task.status === "completed").length}/${taskProgress.tasks.length}`,
        current: taskProgress.tasks.filter((task) => task.status === "completed").length,
        total: taskProgress.tasks.length,
        status: taskProgress.tasks.every((task) => task.status === "completed")
          ? "completed"
          : props.isSending
            ? "running"
            : "paused",
        children: taskProgress.tasks.map((task) => ({
          id: `task-progress:${taskProgress.runId}:${task.id}`,
          kind: "TaskStep",
          label: task.subject,
          text: task.status === "in_progress" ? task.activeForm : task.description,
          status:
            task.status === "in_progress" ? (props.isSending ? "running" : "paused") : task.status,
        })),
      }
    : undefined;
  const activityItems = collectActivityItems(props.historyItems, live).filter(
    (item) => !isTaskToolBlock({ kind: "tool", item }),
  );
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
  const canSend =
    !props.inputDisabled &&
    !props.isUploading &&
    props.modelOptions.length > 0 &&
    (!draft.isEmpty || props.uploads.length > 0);
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
  const contextWindow =
    typeof props.contextWindow === "number" && Number.isFinite(props.contextWindow)
      ? Math.max(0, Math.floor(props.contextWindow))
      : 0;
  const usedTokens = Math.max(0, contextUsedTokens ?? 0);
  const contextRatio = contextUsageRatio(usedTokens, contextWindow);
  const contextUsageNode: PresentationNode | null =
    contextWindow > 0 && usedTokens > 0
      ? {
          id: "context-usage",
          kind: "ProgressBar",
          label: t("chat.contextUsage"),
          current: usedTokens,
          total: contextWindow,
          status: contextRatio >= 0.8 ? "error" : contextRatio >= 0.5 ? "paused" : "completed",
          accessibilityValue: `${usedTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${Math.round(contextRatio * 100)}%)`,
        }
      : null;
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
      fill: true,
      children: [
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
            ...(compact
              ? [
                  {
                    id: "execution-mode",
                    kind: "Selector" as const,
                    variant: "compact",
                    label: t("settings.executionMode"),
                    value: props.settings.system.executionMode === "text" ? "text" : "tools",
                    options: [
                      { value: "text", label: t("chat.mode.chat") },
                      { value: "tools", label: t("chat.mode.agent") },
                    ],
                    action: change(
                      "execution-mode",
                      (value) => props.onChangeMode(value as "text" | "tools"),
                      (value) => value === "text" || value === "tools",
                    ),
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
            {
              id: "draft",
              kind: "ComposerInput",
              focusRequest: composer.getFocusRevision(),
              label: props.inputPlaceholder,
              value: draft.text,
              disabled: props.inputDisabled,
              action: change(
                "draft",
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
                  id: "skill-mentions",
                  kind: "Menu",
                  variant: "compact",
                  icon: "at",
                  label: t("chat.composer.plugins"),
                  disabled: props.inputDisabled,
                  children: [
                    ...(props.enabledSkills ?? []).map((skill) => ({
                      ...button(
                        `mention-skill:${skill.name}`,
                        skill.name,
                        () => composer.handle.insertSkillMention(skill),
                        !props.inputDisabled,
                      ),
                      icon: "sparkles",
                      text: skill.description,
                    })),
                    ...(props.enabledSkills?.length
                      ? [{ id: "skill-menu-divider", kind: "Divider" as const }]
                      : []),
                    {
                      ...button(
                        "manage-skills",
                        t("settings.navSkills"),
                        props.onOpenSkillsHub,
                        !props.inputDisabled,
                      ),
                      icon: "slider.horizontal.3",
                    },
                  ],
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
  const sidebarButton = (id: string, label: string, run: () => unknown): PresentationNode => {
    sidebarHandlers.set(id, { enabled: true, accepts: (value) => value === null, run });
    return {
      id,
      kind: "NavigationRow",
      label,
      action: id,
      variant: compact ? "sidebar" : undefined,
    };
  };
  sidebarHandlers.set("search", {
    enabled: true,
    accepts: (value) => typeof value === "string",
    run: (value) => setQuery(value as string),
  });
  sidebarHandlers.set("sidebar-execution-mode", {
    enabled: true,
    accepts: (value) => value === "text" || value === "tools",
    run: (value) => props.onChangeMode(value as "text" | "tools"),
  });
  sidebarHandlers.set("sidebar-search-toggle", {
    enabled: true,
    accepts: (value) => value === null,
    run: () => setSidebarSearchVisible(!sidebarSearchVisible),
  });
  sidebarHandlers.set("sidebar-projects-toggle", {
    enabled: true,
    accepts: (value) => value === null,
    run: () => setSidebarProjectsOpen(!sidebarProjectsOpen),
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
  activityControls.handlers.set("close", {
    enabled: true,
    accepts: (value) => value === null,
    run: () => setActivityOpen(false),
  });
  const activityNodes: PresentationNode[] = activityItems.length
    ? activityItems.map((item) => ({
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
      }))
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
                  {
                    id: "sidebar-execution-mode",
                    kind: compact ? "Selector" : "SegmentedControl",
                    variant: compact ? "compact" : undefined,
                    label: t("settings.executionMode"),
                    value: props.settings.system.executionMode === "text" ? "text" : "tools",
                    options: [
                      { value: "text", label: t("chat.mode.chat") },
                      { value: "tools", label: t("chat.mode.agent") },
                    ],
                    action: "sidebar-execution-mode",
                  },
                  ...(compact
                    ? [
                        {
                          id: "sidebar-search-toggle",
                          kind: "IconButton" as const,
                          label: t("chat.history.search"),
                          icon: "magnifyingglass",
                          action: "sidebar-search-toggle",
                        },
                        ...(sidebarSearchVisible
                          ? [
                              {
                                id: "sidebar-search",
                                kind: "TextInput" as const,
                                label: t("chat.history.searchPlaceholder"),
                                value: query,
                                action: "search",
                              },
                            ]
                          : []),
                      ]
                    : [
                        {
                          id: "sidebar-search",
                          kind: "TextInput" as const,
                          label: t("chat.history.searchPlaceholder"),
                          value: query,
                          action: "search",
                        },
                      ]),
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
                              ...sidebarButton(
                                "sidebar-projects-toggle",
                                t("sidebar.mobile.projects"),
                                () => setSidebarProjectsOpen(!sidebarProjectsOpen),
                              ),
                              icon: "folder.fill",
                              selected: sidebarProjectsOpen,
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
                      ...(!compact || sidebarProjectsOpen
                        ? [
                            sidebarButton("create-project", t("chat.workspaceCreate"), () => {
                              finishSidebarAction();
                              props.onCreateProject();
                            }),
                            {
                              id: "projects-label",
                              kind: "Heading" as const,
                              text: t("chat.workspaceSection"),
                            },
                            ...props.projects
                              .filter((project) =>
                                project.name
                                  .toLocaleLowerCase()
                                  .includes(query.toLocaleLowerCase()),
                              )
                              .flatMap((project): PresentationNode[] => {
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
                                    ...sidebarButton(`project:${project.id}`, project.name, () => {
                                      setExpandedProjectIds((current) => {
                                        const next = new Set(current);
                                        if (next.has(project.id)) next.delete(project.id);
                                        else next.add(project.id);
                                        return next;
                                      });
                                      props.onSelectProject(project);
                                    }),
                                    icon: expanded ? "folder.fill" : "folder",
                                    selected: expanded,
                                  },
                                  ...(expanded
                                    ? visible.map((conversation) => ({
                                        ...sidebarButton(
                                          `workspace-conversation:${conversation.id}`,
                                          conversation.title,
                                          () => {
                                            props.onSelectConversation(conversation.id);
                                            finishSidebarAction();
                                          },
                                        ),
                                        indent: 18,
                                        icon: "bubble.left",
                                        selected: props.conversationId === conversation.id,
                                      }))
                                    : []),
                                  ...(expanded &&
                                  (!state || (state.loading && visible.length === 0))
                                    ? [
                                        {
                                          id: `workspace-loading:${project.id}`,
                                          kind: "Text" as const,
                                          text: t("sidebar.readingHistory"),
                                          indent: 18,
                                        },
                                      ]
                                    : []),
                                  ...(expanded && state?.error
                                    ? [
                                        sidebarButton(
                                          `workspace-retry:${project.id}`,
                                          t("presentation.retry"),
                                          () =>
                                            props.sidebarStore.loadWorkspaceHistory(project.path),
                                        ),
                                      ]
                                    : []),
                                  ...(expanded &&
                                  (state?.hasMore || conversations.length > visible.length)
                                    ? [
                                        {
                                          ...sidebarButton(
                                            `workspace-more:${project.id}`,
                                            t("presentation.loadMore"),
                                            () =>
                                              props.sidebarStore.loadWorkspaceHistory(
                                                project.path,
                                                true,
                                              ),
                                          ),
                                          indent: 18,
                                        },
                                      ]
                                    : []),
                                ];
                              }),
                          ]
                        : []),
                      { id: "recents-label", kind: "Heading", text: t("chat.recentConversation") },
                      ...recentChats
                        .filter((conversation) =>
                          conversation.title
                            .toLocaleLowerCase()
                            .includes(query.toLocaleLowerCase()),
                        )
                        .map((conversation) =>
                          sidebarButton(
                            `conversation:${conversation.id}`,
                            conversation.title,
                            () => {
                              props.onSelectConversation(conversation.id);
                              finishSidebarAction();
                            },
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
                      {
                        ...sidebarButton("settings", t("tooltip.settings"), () => {
                          finishSidebarAction();
                          props.onOpenSettings();
                        }),
                        kind: "IconButton",
                        icon: "gearshape",
                      },
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
            nodes: activityNodes,
          }}
          handlers={activityControls.handlers}
          onError={setFailure}
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
