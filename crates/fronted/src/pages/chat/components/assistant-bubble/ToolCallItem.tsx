import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { Banner } from "@astryxdesign/core/Banner";
import { ChatToolCalls, type ChatToolCallItem as AstryxToolCallItem } from "@astryxdesign/core/Chat";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { memo, type ReactNode, useCallback } from "react";

import { AskUserQuestionCard } from "../../../../components/chat/AskUserQuestionCard";
import { useLocale } from "../../../../i18n";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  type AskUserQuestionAnswer,
  parseAskUserQuestionResultDetails,
  sanitizeAskUserQuestionItems,
} from "../../../../lib/chat/askUserQuestion";
import { deriveFileChangeStats } from "../../../../lib/chat/messages/fileChangeStats";
import {
  deriveFileToolPreview,
  FILE_TOOL_TEXT_FIELDS,
} from "../../../../lib/chat/messages/toolPreview";
import {
  previewText,
  safeStringify,
  summarizeToolCall,
  type ToolTraceItem,
  toolCallArgsForDisplay,
  toolResultMessageToText,
} from "../../../../lib/chat/messages/uiMessages";
import { isSubagentCardToolCall } from "../../../../lib/subagents/card";
import {
  answerAskUserQuestion,
  getAskUserQuestionDeadlineAt,
} from "../../../../lib/tools/askUserQuestionTools";
import {
  areStableValuesEqual,
  getBuiltinResultKind,
  getSubagentInlineSummary,
  getToolDisplayTitle,
} from "./assistantBubbleUtils";
import { FileToolArgsDisplay } from "./FileToolArgs";
import { sanitizeTodoItems, TodoListView } from "./TodoListView";
import { ToolResultDisplay } from "./ToolResultDisplay";

function ToolDetailSection(props: { label?: string; children: ReactNode }) {
  return (
    <VStack gap={1}>
      {props.label ? (
        <Text type="label" color="secondary">
          {props.label}
        </Text>
      ) : null}
      {props.children}
    </VStack>
  );
}

function getAskQuestions(item: ToolTraceItem) {
  if (item.toolCall.name !== ASK_USER_QUESTION_TOOL_NAME) return [];
  const details = parseAskUserQuestionResultDetails(item.toolResult?.details);
  return details?.questions.length
    ? details.questions
    : sanitizeAskUserQuestionItems(item.toolCall.arguments?.questions);
}

function getArgumentsCode(item: ToolTraceItem) {
  return safeStringify(toolCallArgsForDisplay(item.toolCall));
}

function ToolArguments({ item }: { item: ToolTraceItem }) {
  const preview = deriveFileToolPreview(item.toolCall);
  if (preview) return <FileToolArgsDisplay preview={preview} />;
  if (item.toolCall.name === "TodoWrite") {
    return <TodoListView todos={sanitizeTodoItems(item.toolCall.arguments?.todos)} />;
  }

  const command =
    (item.toolCall.name === "Bash" || item.toolCall.name === "ManagedProcess") &&
    typeof item.toolCall.arguments?.command === "string"
      ? item.toolCall.arguments.command.trim()
      : "";
  return (
    <CodeBlock
      code={command || getArgumentsCode(item)}
      language={command ? "bash" : "json"}
      hasLanguageLabel={false}
      size="sm"
      width="100%"
      maxHeight="var(--xagent-tool-input-max-height)"
      container="section"
    />
  );
}

function shouldShowArguments(item: ToolTraceItem) {
  const isAsk = item.toolCall.name === ASK_USER_QUESTION_TOOL_NAME;
  const isSubagent = isSubagentCardToolCall(item.toolCall);
  const hasResult = Boolean(item.toolResult);
  const hasArgs = Object.keys(item.toolCall.arguments || {}).length > 0;
  const isStreamingFilePreviewTool = FILE_TOOL_TEXT_FIELDS[item.toolCall.name] !== undefined;
  return (
    !isAsk &&
    (!isSubagent || !hasResult) &&
    (item.toolCall.name !== "TodoWrite" || !hasResult) &&
    (isStreamingFilePreviewTool ? !hasResult : hasArgs)
  );
}

function hasToolCallDetail(item: ToolTraceItem) {
  return shouldShowArguments(item) || Boolean(item.toolResult) || getAskQuestions(item).length > 0;
}

function shouldPinToolDetail(item: ToolTraceItem, isRunning?: boolean) {
  const result = item.toolResult;
  const builtinResultKind = getBuiltinResultKind(result);
  if (item.toolCall.name === "Image" || builtinResultKind === "display_image") return true;
  if (item.toolCall.name === ASK_USER_QUESTION_TOOL_NAME) {
    return Boolean(isRunning) && !result && getAskQuestions(item).length > 0;
  }
  if (item.toolCall.name !== "TodoWrite") return false;
  const todos = sanitizeTodoItems(
    builtinResultKind === "todo_write"
      ? (result?.details as { todos?: unknown } | undefined)?.todos
      : item.toolCall.arguments?.todos,
  );
  return (
    Boolean(isRunning) ||
    !result ||
    Boolean(result.isError) ||
    todos.some((todo) => todo.status !== "completed")
  );
}

export function createAstryxToolCall(
  item: ToolTraceItem,
  isRunning: boolean,
  resultDetail?: ReactNode,
  nameOverride?: string,
): AstryxToolCallItem {
  const result = item.toolResult;
  const isCommand = item.toolCall.name === "Bash" || item.toolCall.name === "ManagedProcess";
  const command =
    isCommand && typeof item.toolCall.arguments?.command === "string"
      ? item.toolCall.arguments.command.trim()
      : "";
  const firstLine = command ? command.split("\n")[0] : "";
  const isAsk = item.toolCall.name === ASK_USER_QUESTION_TOOL_NAME;
  const isSubagent = isSubagentCardToolCall(item.toolCall);
  const summary = firstLine
    ? `$ ${firstLine}`
    : isAsk
      ? (getAskQuestions(item)[0]?.prompt ?? "")
      : isSubagent
        ? getSubagentInlineSummary(item)
        : summarizeToolCall(item.toolCall, {
            includeName: false,
            includeManagerAction: false,
          });
  const title = getToolDisplayTitle(item.toolCall);
  const stats = deriveFileChangeStats(item.toolCall);
  const errorText = result?.isError ? toolResultMessageToText(result) : "";

  return {
    key: item.toolCall.id,
    name: nameOverride ?? (title.action ? `${title.name} · ${title.action}` : title.name),
    target: summary || undefined,
    status: isRunning ? "running" : result ? (result.isError ? "error" : "complete") : "pending",
    additions: stats?.added,
    deletions: stats?.removed,
    errorMessage: errorText ? previewText(errorText, 320) : undefined,
    resultDetail,
  };
}

export function ToolCallDetail({ item, isRunning }: { item: ToolTraceItem; isRunning?: boolean }) {
  const { t } = useLocale();
  const result = item.toolResult;
  const builtinResultKind = getBuiltinResultKind(result);
  const isTodo = item.toolCall.name === "TodoWrite";
  const isAsk = item.toolCall.name === ASK_USER_QUESTION_TOOL_NAME;
  const askDetails = isAsk ? parseAskUserQuestionResultDetails(result?.details) : null;
  const askQuestions = getAskQuestions(item);
  const submitAskUserQuestion = useCallback(
    (answers: AskUserQuestionAnswer[]) =>
      Promise.resolve(answerAskUserQuestion(item.toolCall.id, answers)),
    [item.toolCall.id],
  );

  return (
    <VStack gap={3}>
      {shouldShowArguments(item) ? (
        <ToolDetailSection
          label={
            item.toolCall.name === "Bash" || item.toolCall.name === "ManagedProcess"
              ? t("chat.tool.command")
              : t("chat.tool.args")
          }
        >
          <ToolArguments item={item} />
        </ToolDetailSection>
      ) : null}

      {isAsk && askQuestions.length > 0 ? (
        <AskUserQuestionCard
          questions={askQuestions}
          answers={askDetails?.answers}
          cancelled={askDetails?.cancelled === true}
          timedOut={askDetails?.timedOut === true}
          interactive={Boolean(isRunning) && !result}
          deadlineAt={getAskUserQuestionDeadlineAt(item.toolCall.id)}
          onSubmit={submitAskUserQuestion}
        />
      ) : null}

      {result && (!isAsk || !askDetails) ? (
        <ToolDetailSection label={isTodo ? undefined : t("chat.tool.return")}>
          <VStack gap={2}>
            <ToolResultDisplay item={item} result={result} />
            {(() => {
              const resultText = toolResultMessageToText(result);
              if (!/\S/.test(resultText)) return null;
              if (builtinResultKind && builtinResultKind !== "read_image") return null;
              const code = previewText(resultText, 6000);
              if (result.isError) {
                return (
                  <Banner status="error" title={t("chat.tool.error")} collapsible={false}>
                    <CodeBlock
                      code={code}
                      language="plaintext"
                      hasLanguageLabel={false}
                      size="sm"
                      width="100%"
                      maxHeight="var(--xagent-tool-output-max-height)"
                      container="section"
                    />
                  </Banner>
                );
              }
              if (item.toolCall.name === "Bash") {
                return (
                  <CodeBlock
                    code={code}
                    language="bash"
                    hasLanguageLabel={false}
                    size="sm"
                    width="100%"
                    maxHeight="var(--xagent-tool-output-max-height)"
                  />
                );
              }
              return (
                <Collapsible trigger={t("chat.tool.viewReturn")} defaultIsOpen={false}>
                  <CodeBlock
                    code={code}
                    language="plaintext"
                    hasLanguageLabel={false}
                    size="sm"
                    width="100%"
                    maxHeight="var(--xagent-tool-output-max-height)"
                    container="section"
                  />
                </Collapsible>
              );
            })()}
          </VStack>
        </ToolDetailSection>
      ) : null}
    </VStack>
  );
}

function ToolCallItem({ item, isRunning }: { item: ToolTraceItem; isRunning?: boolean }) {
  const { t } = useLocale();
  const pinned = shouldPinToolDetail(item, isRunning);
  const detail = hasToolCallDetail(item) ? (
    <ToolCallDetail item={item} isRunning={isRunning} />
  ) : undefined;
  const name =
    item.toolCall.name === "TodoWrite"
      ? t("chat.tool.todoTitle")
      : item.toolCall.name === ASK_USER_QUESTION_TOOL_NAME
        ? t("chat.tool.askUserTitle")
        : undefined;
  const call = createAstryxToolCall(item, Boolean(isRunning), pinned ? undefined : detail, name);

  return (
    <VStack gap={1}>
      <ChatToolCalls calls={[call]} />
      {pinned ? detail : null}
    </VStack>
  );
}

function areToolResultsEqual(
  previous: ToolResultMessage | undefined,
  next: ToolResultMessage | undefined,
) {
  if (!previous || !next) return previous === next;
  return (
    previous.toolCallId === next.toolCallId &&
    previous.toolName === next.toolName &&
    previous.isError === next.isError &&
    areStableValuesEqual(previous.content, next.content) &&
    areStableValuesEqual(previous.details, next.details)
  );
}

export function areToolTraceItemsEqual(previous: ToolTraceItem, next: ToolTraceItem) {
  return (
    previous.toolCall.id === next.toolCall.id &&
    previous.toolCall.name === next.toolCall.name &&
    areStableValuesEqual(previous.toolCall.arguments, next.toolCall.arguments) &&
    areToolResultsEqual(previous.toolResult, next.toolResult)
  );
}

export const MemoToolCallItem = memo(
  ToolCallItem,
  (previousProps, nextProps) =>
    previousProps.isRunning === nextProps.isRunning &&
    areToolTraceItemsEqual(previousProps.item, nextProps.item),
);
