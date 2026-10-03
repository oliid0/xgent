import { useMemo, useSyncExternalStore } from "react";
import { useLocale } from "../i18n";
import { collectActivityItems } from "../lib/chat/activityTimeline";
import { selectLatestTaskProgress } from "../lib/chat/taskProgress";
import type { PendingToolApprovalSummary, ToolApprovalDecision } from "../lib/tools/toolApproval";
import type { SplitConversationPaneProps } from "../pages/chat/components/SplitConversationPane";
import { NativeSurface } from "./NativeSurface";
import { useNativeAskUserQuestions } from "./nativeAskUserQuestions";
import { createNativeChatTranscript } from "./nativeChatTranscript";
import { attachReadOnlySyntax, readOnlySyntaxPalette } from "./nativeReadOnlySyntax";
import { createNativeTaskProgress } from "./nativeTaskProgress";
import { createNativePresentationTheme } from "./nativeTheme";
import { createNativeWorkspacePanel } from "./nativeWorkspacePanel";
import type { PresentationHandler, PresentationNode, PresentationValue } from "./types";

/** Native presentation of the same side-conversation submit, history and runtime controller. */
export function NativeSplitConversationPane(
  props: SplitConversationPaneProps & {
    draft: string;
    onDraftChange: (value: string) => void;
    sendError: string | null;
    submitting: boolean;
    onSubmit: () => Promise<void>;
    onError: (error: string) => void;
    pendingApprovals: PendingToolApprovalSummary[];
    onDecide: (id: string, decision: ToolApprovalDecision) => { ok: boolean; message?: string };
  },
) {
  const { t } = useLocale();
  const live = useSyncExternalStore(
    props.liveTranscriptStore.subscribe,
    props.liveTranscriptStore.getSnapshot,
    props.liveTranscriptStore.getSnapshot,
  );
  const handlers = new Map<string, PresentationHandler>();
  const syntaxPalette = useMemo(
    () => readOnlySyntaxPalette(props.settings, false),
    [props.settings],
  );
  const action = (
    id: string,
    run: (value: PresentationValue) => unknown,
    enabled = true,
    accepts: (value: PresentationValue) => boolean = (value) => value === null,
  ) => {
    handlers.set(id, { enabled, accepts, run });
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
    disabled: !enabled,
    action: action(id, run, enabled),
  });
  action("side-close", props.onClose);
  const title = props.record?.title || t("chat.pendingTitle");
  const history = props.record?.state.transcript.items ?? [];
  const questions = useNativeAskUserQuestions(
    props.conversationId,
    collectActivityItems(history, live),
    t,
  );
  for (const [id, handler] of questions.handlers) handlers.set(id, handler);
  const progress = createNativeTaskProgress(
    selectLatestTaskProgress(history, live.liveRounds, props.record?.state.meta?.taskList),
    props.isRunning,
    t,
  );
  const messages = attachReadOnlySyntax(
    createNativeChatTranscript(
      history,
      live,
      props.settings.customSettings.appearance.showThinking,
      t,
      (id, run) => action(id, run),
      props.onOpenWorkspaceFile,
      questions.nodes,
    ),
    handlers,
    syntaxPalette,
  );
  const content: PresentationNode[] = props.loading
    ? [{ id: "side-loading", kind: "Progress", label: t("chat.split.loading") }]
    : props.error
      ? [
          {
            id: "side-error",
            kind: "Banner",
            label: t("chat.split.loadFailed"),
            text: props.error,
            status: "error",
          },
          button("side-retry", t("chat.split.retry"), props.onRetry),
        ]
      : messages.length
        ? messages
        : [{ id: "side-empty", kind: "Text", text: t("chat.split.empty"), secondary: true }];
  const approvals: PresentationNode[] = props.pendingApprovals.map(
    (approval): PresentationNode => ({
      id: `side-approval:${approval.toolCallId}`,
      kind: "Section",
      label: approval.toolName,
      children: [
        {
          id: `side-approval:${approval.toolCallId}:summary`,
          kind: "Text",
          text: approval.summary,
        },
        ...(["approve", "approve_session", "deny"] as const).map((decision) =>
          button(
            `side-approval:${approval.toolCallId}:${decision}`,
            t(
              decision === "approve"
                ? "chat.toolApproval.approve"
                : decision === "deny"
                  ? "chat.toolApproval.deny"
                  : "chat.toolApproval.approveSession",
            ),
            () => {
              const result = props.onDecide(approval.toolCallId, decision);
              if (!result.ok) throw new Error(result.message || t("chat.toolApproval.failed"));
            },
            approval.deadlineAt > Date.now(),
          ),
        ),
      ],
    }),
  );
  const nodes: PresentationNode[] = [
    {
      id: "side-layout",
      kind: "ChatLayout",
      fill: true,
      children: [
        {
          id: "side-toolbar",
          kind: "TerminalToolbar",
          spacing: 8,
          padding: 12,
          children: [
            { id: "side-title", kind: "Text", text: title },
            button(
              "side-activate",
              t("chat.split.continueHere"),
              props.onActivate,
              !props.loading && !!props.record,
            ),
          ],
        },
        {
          id: "side-transcript",
          kind: "ScrollView",
          value: props.conversationId,
          fill: true,
          children: [...content, ...(progress ? [progress] : []), ...approvals],
        },
        ...(props.onSend
          ? [
              {
                id: "side-composer",
                kind: "Composer" as const,
                children: [
                  ...(props.sendError
                    ? [
                        {
                          id: "side-send-error",
                          kind: "Banner" as const,
                          label: props.sendError,
                          status: "error" as const,
                        },
                      ]
                    : []),
                  {
                    id: "side-draft",
                    kind: "ComposerInput" as const,
                    label: t("chat.sendMessage"),
                    value: props.draft,
                    disabled: props.loading,
                    action: action(
                      "side-draft",
                      (value) => props.onDraftChange(value as string),
                      !props.loading,
                      (value) => typeof value === "string",
                    ),
                  },
                  {
                    id: "side-composer-actions",
                    kind: "TerminalToolbar" as const,
                    children: [
                      props.isRunning
                        ? button(
                            "side-stop",
                            t("chat.stopGeneration"),
                            () => props.onStop?.(),
                            !!props.onStop,
                          )
                        : button(
                            "side-send",
                            t("chat.send"),
                            props.onSubmit,
                            !props.loading && !props.submitting && !!props.draft.trim(),
                          ),
                    ],
                  },
                ],
              },
            ]
          : []),
      ],
    },
  ];
  return (
    <NativeSurface
      document={{
        ...createNativeWorkspacePanel(t, false),
        title,
        appearance: props.settings.theme,
        formFactor: "desktop",
        theme: createNativePresentationTheme(props.settings, false, "chat"),
        dismissAction: "side-close",
        nodes,
      }}
      handlers={handlers}
      onError={(error) => props.onError(error instanceof Error ? error.message : String(error))}
    />
  );
}
