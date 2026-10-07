import { invoke } from "@xgent/runtime";
import type { RenderTimelineItem } from "../lib/chat/conversation/conversationState";
import type { LiveTranscriptState } from "../lib/chat/conversation/liveTranscriptStore";
import { collectChangedFiles } from "../lib/chat/messages/changedFiles";
import { collectCloudArtifacts } from "../lib/chat/messages/cloudArtifacts";
import { collectPreviewedFiles } from "../lib/chat/messages/previewedFiles";
import { workDuration } from "../pages/chat/transcript/workRecord";
import { roundNodes, splitWorkNodes } from "./nativeChatEvidence";
import { nativeReadOnlyCodeNodes } from "./nativeReadOnlyCode";
import type { PresentationNode } from "./types";

/** Shared native transcript for main and auxiliary conversations. */
export function createNativeChatTranscript(
  historyItems: RenderTimelineItem[],
  live: LiveTranscriptState,
  showThinking: boolean,
  t: (key: string) => string,
  action: (id: string, run: () => unknown) => string,
  onOpenWorkspaceFile: (path: string) => void,
  questionNodes?: ReadonlyMap<string, PresentationNode>,
): PresentationNode[] {
  const contentLabels = {
    thinking: t("chat.thinking"),
    search: t("chat.search.webSearch"),
    arguments: t("chat.toolDetails.arguments"),
    result: t("chat.toolDetails.result"),
    integration: t("chat.work.integration"),
    integrationCommands: t("chat.work.integrationCommands"),
    toolCalls: t("chat.work.calls"),
  };
  let lastUserAt: number | undefined;
  const messages: PresentationNode[] = historyItems.flatMap((item): PresentationNode[] => {
    if (item.kind === "assistant") {
      const artifacts = collectCloudArtifacts(item.rounds);
      const changedSummary = collectChangedFiles(item.rounds);
      const changedFiles = changedSummary?.files.filter((file) => !file.deleted) ?? [];
      const previewedFiles = collectPreviewedFiles(item.rounds, changedSummary);
      const { work, answer } = splitWorkNodes(
        roundNodes(item.rounds, item.key, showThinking, contentLabels, questionNodes),
      );
      const duration = workDuration(lastUserAt, item.timestamp);
      const changedFileNodes: PresentationNode[] = changedFiles.map((file) => {
        const id = `${item.key}:changed-file:${file.lastToolCallId}`;
        return {
          id,
          kind: "Button",
          label: file.path,
          icon: "doc",
          variant: "secondary",
          size: "small",
          accessibilityHint: t("projectTools.fileTree.openFile"),
          action: action(id, () => onOpenWorkspaceFile(file.path)),
        };
      });
      return [
        {
          id: item.key,
          kind: "ChatMessage",
          role: "assistant",
          children: [
            ...(work.length > 0
              ? [
                  {
                    id: `${item.key}:work`,
                    kind: "Collapsible" as const,
                    variant: "work",
                    label: duration
                      ? t("chat.activity.worked").replace("{duration}", duration)
                      : t("chat.activity.tools"),
                    children: [...work, ...changedFileNodes],
                  },
                ]
              : []),
            ...answer,
            ...(work.length > 0 ? [] : changedFileNodes),
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
                action: action(id, () => onOpenWorkspaceFile(file.path)),
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
    lastUserAt = item.timestamp;
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
    const liveChildren = roundNodes(
      live.liveRounds,
      "live",
      showThinking,
      contentLabels,
      questionNodes,
    );
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
      const { work, answer } = splitWorkNodes(liveChildren);
      const liveChangedFiles =
        collectChangedFiles(live.liveRounds)?.files.filter((file) => !file.deleted) ?? [];
      messages.push({
        id: "live:assistant",
        kind: "ChatMessage",
        role: "assistant",
        children: [
          ...(work.length > 0
            ? [
                {
                  id: "live:work",
                  kind: "Section" as const,
                  label: t("chat.mobileActivity.working"),
                  children: [
                    ...work,
                    ...liveChangedFiles.map((file): PresentationNode => {
                      const id = `live:changed-file:${file.lastToolCallId}`;
                      return {
                        id,
                        kind: "Button",
                        label: file.path,
                        icon: "doc",
                        variant: "secondary",
                        size: "small",
                        action: action(id, () => onOpenWorkspaceFile(file.path)),
                      };
                    }),
                  ],
                },
              ]
            : []),
          ...answer,
        ],
      });
    }
  }
  return nativeReadOnlyCodeNodes(messages, t);
}
