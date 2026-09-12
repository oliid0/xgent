import {
  type MutableRefObject,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { MentionComposerHandle } from "../components/chat/MentionComposer";
import { useLocale } from "../i18n";
import type { RenderTimelineItem } from "../lib/chat/conversation/conversationState";
import type { LiveTranscriptStore } from "../lib/chat/conversation/liveTranscriptStore";
import { toolResultMessageToText, type UiRound } from "../lib/chat/messages/uiMessages";
import type { PendingUploadedFile } from "../lib/chat/messages/uploadedFiles";
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
import type { PendingToolApprovalSummary, ToolApprovalDecision } from "../lib/tools/toolApproval";
import { createNativeComposerStore } from "./composerStore";
import { NativeSurface } from "./NativeSurface";
import { decodeNativeFiles } from "./nativeFiles";
import type { PresentationHandler, PresentationNode, PresentationValue } from "./types";

export type NativeChatPageProps = {
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
  isUploading: boolean;
  onSend: () => void;
  onStop: () => void;
  onSelectModel: (selection: SelectedModel) => void;
  onSelectConversation: (id: string) => void;
  onSelectProject: (project: WorkspaceProject) => void;
  onNewConversation: () => void;
  onOpenSettings: () => void;
  onChangeMode: (mode: "text" | "tools") => void;
  onLoadEarlierHistory: () => Promise<unknown> | void;
  onDecide: (id: string, decision: ToolApprovalDecision) => { ok: boolean; message?: string };
  onCreateProject: () => void;
  onOpenTerminal: () => void;
  onImportFiles: (files: File[]) => Promise<void>;
  onRemoveUpload: (path: string) => void;
};

function roundNodes(rounds: UiRound[], prefix: string, showThinking: boolean): PresentationNode[] {
  return rounds.flatMap((round) =>
    round.blocks.flatMap((block): PresentationNode[] => {
      const id = `${prefix}:${round.key}`;
      if (block.kind === "text" || block.kind === "thinking") {
        if (block.kind === "thinking" && !showThinking) return [];
        return [
          {
            id: `${id}:${block.id}`,
            kind: "Text",
            text: block.text,
            secondary: block.kind === "thinking",
          },
        ];
      }
      if (block.kind === "tool") {
        return [
          {
            id: `${id}:tool:${block.item.toolCall.id}`,
            kind: "Section",
            label: block.item.toolCall.name,
            children: [
              {
                id: `${id}:tool:${block.item.toolCall.id}:result`,
                kind: "Text",
                text: block.item.toolResult
                  ? toolResultMessageToText(block.item.toolResult)
                  : JSON.stringify(block.item.toolCall.arguments, null, 2),
              },
            ],
          },
        ];
      }
      return [];
    }),
  );
}

export function NativeChatPage(props: NativeChatPageProps) {
  const { t } = useLocale();
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  useEffect(() => {
    if (!isNativeMobileRuntime()) return;
    let active = true;
    void mobileAssistantStatus()
      .then((status) => {
        if (active) setVoiceAvailable(status.available && status.voiceInputAvailable);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
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
  const messages: PresentationNode[] = props.historyItems.flatMap((item) => {
    if (item.kind === "assistant") return roundNodes(item.rounds, item.key, showThinking);
    return [
      {
        id: item.key,
        kind: "Section",
        label: t(item.kind === "user" ? "presentation.you" : "presentation.context"),
        children: [
          {
            id: `${item.key}:text`,
            kind: "Text",
            text: item.kind === "user" ? item.text : item.content,
          },
        ],
      },
    ];
  });
  if (!live.isSettled) {
    messages.push(...roundNodes(live.liveRounds, "live", showThinking));
    if (live.liveRounds.length === 0 && live.draftAssistantText) {
      messages.push({ id: "live:draft", kind: "Text", text: live.draftAssistantText });
    }
    if (live.toolStatus)
      messages.push({ id: "live:status", kind: "Text", text: live.toolStatus, secondary: true });
  }
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
              ...button("sidebar", t("tooltip.openSidebar"), () => setSidebarOpen(true)),
              kind: "IconButton",
              icon: "line.3.horizontal",
            },
            { id: "toolbar-space-start", kind: "Spacer" },
            {
              id: "execution-mode",
              kind: "SegmentedControl",
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
            { id: "toolbar-space-end", kind: "Spacer" },
            {
              ...button("new", t("chat.newConversation"), props.onNewConversation),
              kind: "IconButton",
              icon: "square.and.pencil",
            },
          ],
        },
        ...(props.errorMessage
          ? [{ id: "error", kind: "Text" as const, text: props.errorMessage }]
          : []),
        ...(props.modelOptions.length === 0
          ? [{ id: "no-model", kind: "Text" as const, text: t("chat.noModelSelected") }]
          : []),
        ...(props.hasMoreHistory
          ? [button("earlier", t("presentation.loadEarlier"), props.onLoadEarlierHistory)]
          : []),
        { id: "transcript", kind: "ScrollView", fill: true, children: messages },
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
          fill: true,
          children: [
            {
              id: "model",
              kind: "Selector",
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
            {
              id: "draft",
              kind: "ComposerInput",
              label: props.inputPlaceholder,
              value: draft.text,
              disabled: props.inputDisabled,
              action: change("draft", composer.replaceEditorText, undefined, !props.inputDisabled),
            },
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
                          !props.inputDisabled && !voiceActive,
                        ),
                        kind: "IconButton" as const,
                        icon: "mic",
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
  const sidebarButton = (id: string, label: string, run: () => unknown): PresentationNode => {
    sidebarHandlers.set(id, { enabled: true, accepts: (value) => value === null, run });
    return { id, kind: "NavigationRow", label, action: id };
  };
  sidebarHandlers.set("search", {
    enabled: true,
    accepts: (value) => typeof value === "string",
    run: (value) => setQuery(value as string),
  });
  sidebarHandlers.set("close", {
    enabled: true,
    accepts: (value) => value === null,
    run: () => setSidebarOpen(false),
  });
  return (
    <>
      <NativeSurface
        document={{ mode: "root", title: "Xgent", appearance: props.settings.theme, nodes }}
        handlers={handlers}
        onError={setFailure}
      />
      {sidebarOpen ? (
        <NativeSurface
          document={{
            mode: "sidebar",
            title: "Xgent",
            appearance: props.settings.theme,
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
                      sidebarButton("create-project", t("chat.workspaceCreate"), () => {
                        setSidebarOpen(false);
                        props.onCreateProject();
                      }),
                      sidebarButton("open-terminal", t("chat.mobileTerminal.title"), () => {
                        setSidebarOpen(false);
                        props.onOpenTerminal();
                      }),
                      { id: "projects-label", kind: "Heading", text: t("chat.workspaceSection") },
                      ...props.projects
                        .filter((project) =>
                          project.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
                        )
                        .map((project) =>
                          sidebarButton(`project:${project.id}`, project.name, () => {
                            props.onSelectProject(project);
                            setSidebarOpen(false);
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
                              setSidebarOpen(false);
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
                          setSidebarOpen(false);
                        }),
                        kind: "Button",
                        icon: "square.and.pencil",
                        prominent: true,
                      },
                      { id: "sidebar-footer-space", kind: "Spacer" },
                      {
                        ...sidebarButton("settings", t("tooltip.settings"), () => {
                          setSidebarOpen(false);
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
    </>
  );
}
