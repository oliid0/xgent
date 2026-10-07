import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { generateDiffFile } from "@git-diff-view/file";
import { readStreamPreviewMeta } from "../lib/chat/messages/toolPreview";
import {
  safeStringify,
  summarizeToolCall,
  type ToolTraceItem,
  toolResultMessageToText,
  type UiRound,
} from "../lib/chat/messages/uiMessages";
import { isTaskToolBlock } from "../lib/chat/taskProgress";
import type { EditResultDetails, WriteResultDetails } from "../lib/tools/builtinTypes";
import {
  groupWorkTools,
  workToolGroupLabel,
  workToolIntegration,
} from "../pages/chat/transcript/workRecord";
import type { PresentationNode } from "./types";

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

export function toolEvidenceNodes(
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

export function roundNodes(
  rounds: UiRound[],
  prefix: string,
  showThinking: boolean,
  labels: {
    thinking: string;
    search: string;
    arguments: string;
    result: string;
    integration?: string;
    integrationCommands?: string;
    toolCalls?: string;
  },
  questionNodes?: ReadonlyMap<string, PresentationNode>,
): PresentationNode[] {
  return rounds.flatMap((round) => {
    const renderBlock = (block: UiRound["blocks"][number]): PresentationNode[] => {
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
        const question = questionNodes?.get(block.item.toolCall.id);
        if (question) return [question];
        const running =
          "runningToolCallIds" in round &&
          Array.isArray(round.runningToolCallIds) &&
          round.runningToolCallIds.includes(block.item.toolCall.id);
        return [
          {
            id: `${id}:tool:${block.item.toolCall.id}`,
            kind: "ToolCall",
            variant: "timeline",
            label: workToolIntegration(block.item)
              ? `${workToolIntegration(block.item)!.label} · ${workToolIntegration(block.item)!.tool}`
              : block.item.toolCall.name,
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
            variant: "timeline",
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
    };
    const nodes: PresentationNode[] = [];
    let pending: ToolTraceItem[] = [];
    const flush = () => {
      for (const group of groupWorkTools(pending)) {
        const children = group.flatMap((item) => renderBlock({ kind: "tool", item }));
        if (children.length <= 1) {
          nodes.push(...children);
          continue;
        }
        const groupId = `${prefix}:${round.key}:group:${group[0].toolCall.id}`;
        const title = workToolGroupLabel(group, (key) =>
          key === "chat.work.integrationCommands"
            ? (labels.integrationCommands ?? "{provider} integration and commands")
            : (labels.integration ?? "{provider} integration"),
        );
        nodes.push({
          id: groupId,
          kind: "ToolCall",
          variant: "timeline",
          label: title ?? group[0].toolCall.name,
          text: (labels.toolCalls ?? "{count} calls").replace("{count}", String(group.length)),
          status: children.some((node) => node.status === "running")
            ? "running"
            : children.some((node) => node.status === "error")
              ? "error"
              : children.every((node) => node.status === "completed")
                ? "completed"
                : "pending",
          children,
        });
      }
      pending = [];
    };
    for (const block of round.blocks) {
      if (
        block.kind === "tool" &&
        !isTaskToolBlock(block) &&
        !questionNodes?.has(block.item.toolCall.id) &&
        !["Image", "Agent", "AskUserQuestion"].includes(block.item.toolCall.name)
      ) {
        pending.push(block.item);
      } else {
        flush();
        nodes.push(...renderBlock(block));
      }
    }
    flush();
    return nodes;
  });
}

export function splitWorkNodes(nodes: PresentationNode[]) {
  let lastWork = -1;
  nodes.forEach((node, index) => {
    if (node.kind === "ToolCall" || node.kind === "Thinking") lastWork = index;
  });
  const work: PresentationNode[] = [];
  const answer: PresentationNode[] = [];
  nodes.forEach((node, index) => {
    const special =
      node.variant === "question-card" ||
      (node.kind === "ToolCall" &&
        ["AskUserQuestion", "Image", "Agent"].includes(node.label ?? ""));
    if (index <= lastWork && !special) work.push(node);
    else answer.push(node);
  });
  return { work, answer };
}
