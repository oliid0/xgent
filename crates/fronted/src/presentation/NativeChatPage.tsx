import {
  type MutableRefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { MentionComposerHandle } from "../components/chat/MentionComposer";
import { useLocale } from "../i18n";
import { collectActivityItems } from "../lib/chat/activityTimeline";
import type { RenderTimelineItem } from "../lib/chat/conversation/conversationState";
import type { LiveTranscriptStore } from "../lib/chat/conversation/liveTranscriptStore";
import { executionActivityStore } from "../lib/chat/executionActivityStore";
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
import type { AppSettings, SelectedModel, WorkspaceProject } from "../lib/settings";
import type { SidebarStore } from "../lib/sidebar/store";
import { type DesktopSttCapture, startDesktopSttCapture } from "../lib/stt/desktopAudioCapture";
import type { TaskListState } from "../lib/tools/builtinTypes";
import type { PendingToolApprovalSummary, ToolApprovalDecision } from "../lib/tools/toolApproval";
import { createNativeComposerStore } from "./composerStore";
import { presentationControls } from "./controls";
import { NativeSurface } from "./NativeSurface";
import { decodeNativeFiles } from "./nativeFiles";
import { createNativePresentationTheme } from "./nativeTheme";
import type { PresentationHandler, PresentationNode, PresentationValue } from "./types";

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

export type NativeChatPageProps = {
  conversationId: string;
  settings: AppSettings;
  composerRef: MutableRefObject<MentionComposerHandle | null>;
  sidebarStore: SidebarStore;
  historyItems: RenderTimelineItem[];
  liveTranscriptStore: LiveTranscriptStore;
  modelOptions: ModelOption[];
  selectedValue?: string;
  inputDisabled: boolean;
  inputPlaceholder: string;
  isSending: boolean;
  errorMessage: string | null;
  hasMoreHistory: boolean;
  pendingApprovals: PendingToolApprovalSummary[];
  projects: WorkspaceProject[];
  attachmentsEnabled: boolean;
  uploads: PendingUploadedFile[];
  taskList?: TaskListState;
  isUploading: boolean;
  onSend: () => void;
  onStop: () => void;
  onSelectModel: (selection: SelectedModel) => void;
  onSelectConversation: (id: string) => void;
  onSelectProject: (project: WorkspaceProject) => void;
  onNewConversation: () => void;
  onOpenSettings: (
    section?: "skills" | "cron" | "ssh" | "mcp" | "mobileExecution" | "providers",
  ) => void;
  onOpenRemote: () => void;
  onOpenBrowser: () => void;
  onOpenBrowserSettings: () => void;
  onOpenGitReview: () => void;
  onOpenBackgroundTasks: () => void;
  onOpenFiles: () => void;
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
  labels: { thinking: string; search: string },
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
        const resultText = block.item.toolResult
          ? toolResultMessageToText(block.item.toolResult)
          : safeStringify(block.item.toolCall.arguments);
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
            children: [
              ...toolResultPreviewNodes(
                block.item.toolResult,
                `${id}:tool:${block.item.toolCall.id}`,
              ),
              ...(resultText
                ? [
                    {
                      id: `${id}:tool:${block.item.toolCall.id}:result`,
                      kind: "CodeBlock" as const,
                      label: block.item.toolCall.name,
                      language: /edit|write/i.test(block.item.toolCall.name) ? "diff" : "text",
                      text: resultText,
                    },
                  ]
                : []),
            ],
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
  const activityFrames = useSyncExternalStore(
    executionActivityStore.subscribe,
    () => executionActivityStore.getSnapshot(props.conversationId),
    () => executionActivityStore.getSnapshot(props.conversationId),
  );
  const [sidebarOpen, setSidebarOpen] = useState(!compact);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voicePartial, setVoicePartial] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const desktopVoiceCapture = useRef<DesktopSttCapture | null>(null);
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
  ) => {
    handlers.set(id, {
      enabled,
      accepts: (value: PresentationValue) => typeof value === "string" && accepts(value),
      run: (value) => run(value as string),
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
  };
  const messages: PresentationNode[] = props.historyItems.flatMap((item): PresentationNode[] => {
    if (item.kind === "assistant") {
      return [
        {
          id: item.key,
          kind: "ChatMessage",
          role: "assistant",
          children: roundNodes(item.rounds, item.key, showThinking, contentLabels),
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
  const taskProgressNode: PresentationNode | undefined = taskProgress
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
            },
            { id: "toolbar-space", kind: "Spacer" },
            {
              ...button("tools", t("chat.mobileMenu.title"), () => setToolsOpen(true)),
              kind: "IconButton",
              icon: "ellipsis",
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
              label: props.inputPlaceholder,
              value: draft.text,
              disabled: props.inputDisabled,
              action: change("draft", composer.replaceEditorText, undefined, !props.inputDisabled),
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
                  })),
                  disabled: !props.attachmentsEnabled || props.isUploading || props.inputDisabled,
                  action: change(
                    "attach",
                    async (value) => props.onImportFiles(decodeNativeFiles(value)),
                    undefined,
                    props.attachmentsEnabled && !props.isUploading && !props.inputDisabled,
                  ),
                },
                {
                  id: "model",
                  kind: "Selector",
                  variant: "compact",
                  icon: "sparkles",
                  label: t("chat.trajectory.lane.model"),
                  value: props.selectedValue ?? "",
                  disabled: props.modelOptions.length === 0,
                  options: props.modelOptions.map((option) => ({
                    value: option.value,
                    label: `${option.providerName} · ${option.label}`,
                  })),
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
                {
                  ...button(
                    "send",
                    t("chat.send"),
                    props.onSend,
                    !props.inputDisabled &&
                      !props.isUploading &&
                      props.modelOptions.length > 0 &&
                      (!draft.isEmpty || props.uploads.length > 0),
                  ),
                  prominent: true,
                  kind: "IconButton",
                  icon: "arrow.up",
                },
                ...(props.isSending
                  ? [button("stop", t("chat.stopGeneration"), props.onStop)]
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
    return { id, kind: "NavigationRow", label, action: id };
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
        children: [
          {
            id: `activity:${item.toolCall.id}:detail`,
            kind: "CodeBlock",
            language: item.toolCall.name.toLowerCase().includes("edit") ? "diff" : "text",
            text: item.toolResult
              ? toolResultMessageToText(item.toolResult)
              : safeStringify(item.toolCall.arguments),
          },
        ],
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
                  { id: "sidebar-title", kind: "Heading", text: "Xgent" },
                  {
                    id: "sidebar-execution-mode",
                    kind: "SegmentedControl",
                    label: t("settings.executionMode"),
                    value: props.settings.system.executionMode === "text" ? "text" : "tools",
                    options: [
                      { value: "text", label: t("chat.mode.chat") },
                      { value: "tools", label: t("chat.mode.agent") },
                    ],
                    action: "sidebar-execution-mode",
                  },
                  {
                    id: "sidebar-search",
                    kind: "TextInput",
                    label: t("chat.history.searchPlaceholder"),
                    value: query,
                    action: "search",
                  },
                  {
                    id: "sidebar-list",
                    kind: "List",
                    children: [
                      ...(["skills", "mcp"] as const).map((section) =>
                        sidebarButton(
                          section,
                          t(section === "skills" ? "sidebar.mobile.plugins" : "mcpHub.title"),
                          () => {
                            finishSidebarAction();
                            props.onOpenSettings(section);
                          },
                        ),
                      ),
                      sidebarButton("files", t("sidebar.myFiles"), () => {
                        finishSidebarAction();
                        props.onOpenFiles();
                      }),
                      sidebarButton("create-project", t("chat.workspaceCreate"), () => {
                        finishSidebarAction();
                        props.onCreateProject();
                      }),
                      { id: "projects-label", kind: "Heading", text: t("chat.workspaceSection") },
                      ...props.projects
                        .filter((project) =>
                          project.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
                        )
                        .map((project) =>
                          sidebarButton(`project:${project.id}`, project.name, () => {
                            props.onSelectProject(project);
                            finishSidebarAction();
                          }),
                        ),
                      { id: "recents-label", kind: "Heading", text: t("chat.recentConversation") },
                      ...sidebar.conversations
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
                      ...(sidebar.hasMore
                        ? [
                            sidebarButton("more", t("presentation.loadMore"), () =>
                              props.sidebarStore.loadMore(),
                            ),
                          ]
                        : []),
                      ...(sidebar.listErrorDetail
                        ? [
                            {
                              id: "sidebar:error",
                              kind: "Text" as const,
                              text: sidebar.listErrorDetail,
                            },
                            sidebarButton("retry", t("presentation.retry"), () =>
                              props.sidebarStore.refresh({ reason: "manual" }),
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
                        ...sidebarButton("new-chat", t("chat.newConversation"), () => {
                          props.onNewConversation();
                          finishSidebarAction();
                        }),
                        kind: "Button",
                        icon: "square.and.pencil",
                        prominent: true,
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
    </>
  );
}
