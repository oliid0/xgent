import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { estimateToolsTokens } from "../chat/compaction/tokenLedger";
import {
  type BuiltinToolBundle,
  type BuiltinToolMetadata,
  createBuiltinMetadataMap,
} from "./builtinTypes";

export const TOOL_SEARCH_TOOL_NAME = "ToolSearch";

export const MCP_TOOL_DEFERRAL_THRESHOLD_TOKENS = 12_000;

export const TOOL_SEARCH_MAX_RESULTS = 10;
const TOOL_SEARCH_DEFAULT_RESULTS = 5;

const activationByConversation = new Map<string, Set<string>>();

export function getMcpToolActivation(conversationId: string): Set<string> {
  const key = conversationId.trim();
  let set = activationByConversation.get(key);
  if (!set) {
    set = new Set();
    activationByConversation.set(key, set);
  }
  return set;
}

export function clearMcpToolActivation(conversationId: string) {
  activationByConversation.delete(conversationId.trim());
}

export type DeferredMcpToolEntry = {
  tool: Tool;
  serverLabel: string;
};

function normalizeQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,;/|]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function scoreEntry(entry: DeferredMcpToolEntry, terms: string[]): number {
  const name = entry.tool.name.toLowerCase();
  const description = (entry.tool.description ?? "").toLowerCase();
  const server = entry.serverLabel.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (name.includes(term)) score += 3;
    if (server.includes(term)) score += 2;
    if (description.includes(term)) score += 1;
  }
  return score;
}

export type ToolSearchResultDetails = {
  kind: "tool_search";
  query: string;

  activated: string[];
  totalDeferred: number;
};

function buildErrorResult(toolCall: ToolCall, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text }],
    details: {},
    isError: true,
    timestamp: Date.now(),
  };
}

export function shouldDeferMcpTools(
  mcpTools: readonly Tool[],
  thresholdTokens = MCP_TOOL_DEFERRAL_THRESHOLD_TOKENS,
): boolean {
  if (mcpTools.length === 0) return false;
  return estimateToolsTokens(mcpTools as Tool[]) > thresholdTokens;
}

export function createToolSearchTools(params: {
  conversationId: string;

  entries: readonly DeferredMcpToolEntry[];
}): BuiltinToolBundle {
  const activation = getMcpToolActivation(params.conversationId);
  const serverLabels = [...new Set(params.entries.map((entry) => entry.serverLabel))];
  const toolSearch: Tool = {
    name: TOOL_SEARCH_TOOL_NAME,
    description: [
      `Search the deferred MCP tool catalog and activate matching tools. ${params.entries.length} MCP tools (from: ${serverLabels.join(", ")}) are NOT in your tool list yet to save context.`,
      'Call this with a task-oriented query (e.g. "create issue", "query database", "send message") BEFORE assuming a capability is missing. Matched tools are returned with their full schemas and become directly callable from the next step on.',
      "Results are ranked by name/server/description match. Broaden the query if nothing relevant comes back; activation persists for this conversation.",
    ].join("\n"),
    parameters: Type.Object({
      query: Type.String({
        description: "Task-oriented keywords to match against tool names and descriptions.",
      }),
      max_results: Type.Optional(
        Type.Number({
          description: `How many tools to return and activate (default ${TOOL_SEARCH_DEFAULT_RESULTS}, max ${TOOL_SEARCH_MAX_RESULTS}).`,
        }),
      ),
    }),
  };

  async function executeToolCall(toolCall: ToolCall): Promise<ToolResultMessage> {
    if (toolCall.name !== TOOL_SEARCH_TOOL_NAME) {
      return buildErrorResult(toolCall, `Unknown tool: ${toolCall.name}`);
    }
    const args = (toolCall.arguments || {}) as Record<string, unknown>;
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      return buildErrorResult(toolCall, "query is required: pass task-oriented keywords.");
    }
    const requested =
      typeof args.max_results === "number" && Number.isFinite(args.max_results)
        ? Math.floor(args.max_results)
        : TOOL_SEARCH_DEFAULT_RESULTS;
    const limit = Math.min(Math.max(requested, 1), TOOL_SEARCH_MAX_RESULTS);

    const terms = normalizeQueryTerms(query);
    const ranked = params.entries
      .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (ranked.length === 0) {
      const details: ToolSearchResultDetails = {
        kind: "tool_search",
        query,
        activated: [],
        totalDeferred: params.entries.length,
      };
      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: `No deferred MCP tools matched "${query}". ${params.entries.length} tools available from: ${serverLabels.join(", ")}. Try broader or different keywords.`,
          },
        ],
        details,
        isError: false,
        timestamp: Date.now(),
      };
    }

    const activated: string[] = [];
    for (const { entry } of ranked) {
      if (!activation.has(entry.tool.name)) {
        activation.add(entry.tool.name);
        activated.push(entry.tool.name);
      }
    }
    const lines = ranked.map(({ entry }) =>
      [
        `## ${entry.tool.name}`,
        entry.tool.description ?? "",
        "```json",
        JSON.stringify(entry.tool.parameters ?? {}),
        "```",
      ].join("\n"),
    );
    const details: ToolSearchResultDetails = {
      kind: "tool_search",
      query,
      activated,
      totalDeferred: params.entries.length,
    };
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [
        {
          type: "text",
          text: [
            `Activated ${ranked.length} tool(s) — callable directly from now on:`,
            "",
            ...lines,
          ].join("\n"),
        },
      ],
      details,
      isError: false,
      timestamp: Date.now(),
    };
  }

  return {
    groupId: "system",
    tools: [toolSearch],
    executeToolCall,
    metadataByName: createBuiltinMetadataMap([
      [
        TOOL_SEARCH_TOOL_NAME,
        {
          groupId: "system",
          kind: "tool_search",

          isReadOnly: true,
          displayCategory: "system",
        },
      ],
    ]),
  };
}

export function buildMcpRequestToolFilter(params: {
  conversationId: string;
  metadataByName: Map<string, BuiltinToolMetadata>;
}): (toolName: string) => boolean {
  const activation = getMcpToolActivation(params.conversationId);
  return (toolName: string) => {
    const metadata = params.metadataByName.get(toolName);
    if (metadata?.groupId !== "mcp" || metadata.kind !== "mcp") return true;
    return activation.has(toolName);
  };
}
