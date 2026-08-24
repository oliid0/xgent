import type {
  AssistantMessage,
  Context,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { HostedSearchBlock } from "@xagent/ui/lib/chat/hostedSearch";
import {
  buildProviderNativeWebFetchBridgeResult,
  buildProviderNativeWebSearchBridgeResult,
  isProviderNativeWebFetchToolName as isProviderNativeWebFetchToolCallName,
  isProviderNativeWebSearchToolName as isProviderNativeWebSearchToolCallName,
} from "../nativeWebSearch";

function buildTextModeUnsupportedToolResult(toolCall: ToolCall): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [
      {
        type: "text",
        text: "Tool execution result is unavailable for this recovered tool call. Continue without using this tool and do not repeat raw tool-call markup.",
      },
    ],
    details: { unsupportedTextModeTool: true },
    isError: true,
    timestamp: Date.now(),
  };
}

export function buildTextModeToolResultsForAssistant(
  assistant: AssistantMessage,
  hostedSearchBlocks: HostedSearchBlock[],
): ToolResultMessage[] {
  if (assistant.stopReason !== "toolUse") return [];
  const toolCalls = assistant.content.filter(
    (block): block is ToolCall => block.type === "toolCall",
  );
  return toolCalls.map((toolCall) =>
    buildTextModeToolResultForToolCall(toolCall, hostedSearchBlocks),
  );
}

/**
 * Repair persisted tool-use turns before sending them back to a strict
 * Anthropic-compatible endpoint.  Every tool call must be followed by exactly
 * one result before the next user turn; persisted/canceled DSML recovery can
 * otherwise leave a structurally invalid history that fails every retry.
 */
export function normalizeTextModeToolResultHistory(context: Context): Context {
  let changed = false;
  const messages: Context["messages"] = [];

  for (let index = 0; index < context.messages.length; index += 1) {
    const message = context.messages[index];
    if (!message) continue;
    if (message.role !== "assistant" || message.stopReason !== "toolUse") {
      messages.push(message);
      continue;
    }

    const toolCalls = message.content.filter(
      (block): block is ToolCall => block.type === "toolCall",
    );
    if (toolCalls.length === 0) {
      messages.push(message);
      continue;
    }

    const followingResults: ToolResultMessage[] = [];
    let cursor = index + 1;
    while (context.messages[cursor]?.role === "toolResult") {
      followingResults.push(context.messages[cursor] as ToolResultMessage);
      cursor += 1;
    }
    const resultsById = new Map(followingResults.map((result) => [result.toolCallId, result]));
    const orderedResults = toolCalls.map(
      (toolCall) =>
        resultsById.get(toolCall.id) ?? buildTextModeToolResultForToolCall(toolCall, []),
    );
    const knownIds = new Set(toolCalls.map((toolCall) => toolCall.id));
    const unrelatedResults = followingResults.filter((result) => !knownIds.has(result.toolCallId));

    messages.push(message, ...orderedResults, ...unrelatedResults);
    if (
      orderedResults.length !== followingResults.length ||
      orderedResults.some((result, resultIndex) => result !== followingResults[resultIndex])
    ) {
      changed = true;
    }
    index = cursor - 1;
  }

  return changed ? { ...context, messages } : context;
}

function buildTextModeToolResultForToolCall(
  toolCall: ToolCall,
  hostedSearchBlocks: HostedSearchBlock[],
): ToolResultMessage {
  if (isProviderNativeWebSearchToolCallName(toolCall.name)) {
    return buildProviderNativeWebSearchBridgeResult({
      toolCall,
      hostedSearchBlocks,
      sourcesIntro: "Hosted search sources already captured in this response:",
      fallbackText:
        "No hosted search result was returned for this recovered request. Continue from existing context without repeating raw tool-call markup.",
    });
  }
  if (isProviderNativeWebFetchToolCallName(toolCall.name)) {
    return buildProviderNativeWebFetchBridgeResult({
      toolCall,
      hostedSearchBlocks,
      sourcesIntro: "Hosted search sources already captured in this response:",
      fallbackText:
        "No hosted search sources were captured for this response. Continue from existing context without repeating raw tool-call markup.",
    });
  }
  return buildTextModeUnsupportedToolResult(toolCall);
}
