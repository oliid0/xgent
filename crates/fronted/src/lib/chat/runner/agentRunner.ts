import { Agent, type AgentContext, type AgentTool } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  Context,
  Message,
  ModelThinkingLevel,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { buildStreamRequestDebugPayload, type StreamDebugLogger } from "../../debug/agentDebug";
import { capturePrefixShape, comparePrefixShape } from "../../debug/prefixCacheShape";
import { readPreviousPrefixShape, recordPrefixShape } from "../../debug/prefixShapeStore";
import {
  createHostedSearchEventAggregator,
  createHostedSearchProbeId,
  startHostedSearchFetchProbe,
  withHostedSearchProbeHeader,
} from "../../providers/hostedSearchEvents";
import {
  buildProviderRequestMetadata,
  createModelFromConfig,
  createStreamingTextReconciler,
  describeProviderCacheShape,
  finalizeProviderStreamOptions,
  normalizeErrorMessage,
  type ProviderRuntimeConfig,
  prepareProviderRequest,
  resolveProviderCacheRetention,
  type StreamOptionsEx,
  streamSimpleByApi,
  type ToolChoice,
  toSimpleStreamReasoning,
} from "../../providers/llm";
import {
  buildProviderNativeWebFetchBridgeResult,
  buildProviderNativeWebSearchBridgeResult,
  HIDDEN_PROVIDER_NATIVE_WEB_FETCH_TOOL_NAMES,
  HIDDEN_PROVIDER_NATIVE_WEB_SEARCH_TOOL_NAMES,
  isProviderNativeWebFetchToolName,
  isProviderNativeWebSearchToolName,
} from "../../providers/nativeWebSearch";
import type { PreparedProxyRequest } from "../../providers/proxy";
import { sanitizeAssistantMessage } from "../../providers/runtime/messageUtils";
import {
  failoverBreakerKey,
  type ModelFailoverRuntimeConfig,
  type ProviderFailoverCandidate,
  withProviderFailover,
} from "../../providers/runtime/providerFailover";
import { resolveStreamRetryConfig } from "../../providers/runtime/retryPolicy";
import type { RetryAttemptRecord } from "../../providers/runtime/streamRetry";
import {
  captureTransportSnapshot,
  type TransportSnapshot,
} from "../../providers/runtime/transportSnapshot";
import type { RuntimePlatform } from "../../runtimePlatform";
import type { ProviderId, ReasoningLevel, SelectedModel } from "../../settings";
import { createSubagentScheduler, type SubagentScheduler } from "../../subagents/scheduler";
import { withPowerActivity } from "../../system/powerActivity";
import type { AdditionalProjectRoot } from "../../tools/additionalProjectRoots";
import {
  attachPinnedTailBlocks,
  type PinnedTailBlock,
  resolveTailBlockAnchorId,
} from "../context/contextTailBlock";
import { sanitizeContextForModelRequest } from "../context/requestContextSanitizer";
import {
  appendHostedSearchBlocksToAssistant,
  type HostedSearchBlock,
  type HostedSearchOrderedBlock,
  mergeHostedSearchBlocks,
} from "../messages/hostedSearch";
import { summarizeToolCall } from "../messages/uiMessages";
import {
  createDeferredProviderNativeWebSearchStatus,
  resolveProviderNativeWebSearchStatus,
} from "../search/providerNativeSearchStatus";
import {
  comparableToolCall,
  recoverAssistantSeedToolCalls,
  stripSeedToolCallMarkup,
} from "./seedToolCalls";
import { wrapStreamWithToolCallArgumentGuard } from "./toolCallArgumentGuard";
import { buildToolsSuffix as buildToolExecutionPrompt } from "./toolExecutionPrompt";

function throwIfRunnerCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Cancelled");
}

function createLinkedAbortSignal(signals: Array<AbortSignal | undefined>): {
  signal?: AbortSignal;
  cleanup: () => void;
} {
  const activeSignals = Array.from(
    new Set(signals.filter((signal): signal is AbortSignal => Boolean(signal))),
  );
  if (activeSignals.length <= 1) {
    return { signal: activeSignals[0], cleanup: () => undefined };
  }

  const controller = new AbortController();
  const cleanupFns: Array<() => void> = [];
  const cleanup = () => {
    while (cleanupFns.length > 0) {
      cleanupFns.pop()?.();
    }
  };
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
    cleanup();
  };

  for (const sourceSignal of activeSignals) {
    if (sourceSignal.aborted) {
      abort();
      break;
    }
    sourceSignal.addEventListener("abort", abort, { once: true });
    cleanupFns.push(() => sourceSignal.removeEventListener("abort", abort));
  }

  return { signal: controller.signal, cleanup };
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  if (n === 0) return [];

  const limit = Math.max(1, Math.floor(concurrency || 1));
  const results: R[] = new Array(n);
  let nextIndex = 0;

  async function runLoop() {
    while (true) {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= n) return;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const runners = new Array(Math.min(limit, n)).fill(0).map(() => runLoop());
  await Promise.all(runners);
  return results;
}

export function buildToolsSuffix(
  workdir: string,
  availableToolNames?: readonly string[],
  runtimePlatformInput?: RuntimePlatform,
  additionalRoots?: readonly AdditionalProjectRoot[],
) {
  return buildToolExecutionPrompt(
    workdir,
    availableToolNames,
    runtimePlatformInput,
    additionalRoots,
  );
  /* Legacy inline prompt retained temporarily for an easy semantic comparison
     with the extracted prompt module. It is excluded from compilation. */
  /*
  const runtimePlatform = normalizeRuntimePlatform(runtimePlatformInput) ?? inferRuntimePlatform();
  const platformLabel = runtimePlatformLabel(runtimePlatform);
  const allowAll = availableToolNames === undefined;
  const toolNames = new Set(availableToolNames ?? []);
  const has = (name: string) => allowAll || toolNames.has(name);
  const hasAny = (...names: string[]) => names.some(has);
  const hasDynamicMcp =
    allowAll || (availableToolNames ?? []).some((name) => name.startsWith("mcp_"));

  const fileTools = ["Read", "Image", "Write", "Edit", "Delete", "List", "Grep", "Glob"].filter(
    has,
  );
  const hasFileTool = fileTools.length > 0;
  const hasReadFamily = hasAny("Read", "List", "Grep", "Glob");
  const canWrite = hasAny("Write", "Edit", "Delete");

  const toolGroups: string[] = [];
  if (fileTools.length > 0) toolGroups.push(`file tools (${fileTools.join(" / ")})`);
  if (has("SkillsManager")) toolGroups.push("skill tools (SkillsManager)");
  if (has("MemoryManager")) toolGroups.push("persistent memory (MemoryManager)");
  if (has("McpManager")) toolGroups.push("MCP configuration management (McpManager)");
  if (has("CronTaskManager")) toolGroups.push("scheduled task management (CronTaskManager)");
  if (has("Agent")) toolGroups.push("subagent delegation (Agent)");
  if (has("SendMessage")) toolGroups.push("subagent message bus (SendMessage)");
  if (has("Bash")) toolGroups.push("the command tool (Bash)");
  if (has("ManagedProcess")) toolGroups.push("managed local processes (ManagedProcess)");
  if (has("TodoWrite")) toolGroups.push("task planning checklist (TodoWrite)");
  if (hasDynamicMcp) toolGroups.push("MCP business tools whose names are prefixed with mcp_");

  const sections: string[] = [];

  sections.push(
    [
      "# Tool-Execution Mode",
      "",
      "In this mode you have access to the tools listed under **Available Tools** at the end of this section. Invoke them when the task requires reading, searching, modifying, or coordinating state (files, commands, agents, MCP services). For pure Q&A, explanation, or analysis that does not depend on current state, answer directly without invoking tools.",
      "",
      "## Final Reply",
      "- Your reply to the user is plain text plus Markdown.",
      "- Never include raw tool-call JSON or raw tool arguments in your reply — describe what you did in plain words instead.",
    ].join("\n"),
  );

  if (hasFileTool || hasAny("Bash", "ManagedProcess", "SSHManager", "McpManager", "Agent")) {
    sections.push(
      [
        "## Workspace & Paths",
        `- Workspace root (sandbox): \`${workdir}\``,
        "- Preferred form: workspace-relative paths exactly as tools return them, e.g. `src/App.tsx`. To target the root itself, omit the optional `path` / `cwd` argument.",
        "- Files inside an enabled Skill: use `skill://<skill>/...` exactly as returned by SkillsManager or file tools.",
        "- Absolute paths, `~/...`, and `file://` URLs are also accepted and auto-normalized; never construct one when a returned path is available.",
        "- Write, Edit, and Delete operate only inside the workspace or enabled Skills. Bash `cwd` may point outside the workspace when the task requires it.",
        "- Use `/` as the separator everywhere, including Glob and Grep patterns; Windows `\\` is auto-normalized.",
        '- On a path error, follow its guidance: reuse a "Did you mean" candidate verbatim, or locate the file with Glob/Grep first, then retry with the returned path.',
      ].join("\n"),
    );
  }

  if (hasFileTool) {
    const lines: string[] = ["## File Operations"];
    if (hasReadFamily) {
      lines.push(
        "- When the target path is already known, go straight to Read. When it is not, locate it first with Grep / Glob / List, then Read.",
      );
    }
    if (canWrite) {
      lines.push(
        "- Existing files: Write and Edit check the file's current on-disk state automatically; a separate Read is only needed for very large files (>5000 lines). Stale writes are rejected — re-Read and retry if the file changed underneath you.",
        "- New files: call Write with a file path that includes the filename and the full content; parent directories are created automatically. There is no separate create-directory step — to create a directory, Write a file inside it.",
      );
    }
    if (has("Read")) {
      lines.push(
        [
          "- Read pagination:",
          "  • Text — `start_line` (1-based) + `limit`.",
          "  • PDF — `page_start` + `page_limit`.",
          "  • Notebook (`.ipynb`) — `cell_start` + `cell_limit`.",
          "  • Word/Excel/archive uploads — Read returns a best-effort preview or archive entry listing.",
          "- A re-Read of an unchanged file may return an `unchanged` stub instead of repeating content — treat it as confirmation that your prior read is still valid; do not retry to force the full body.",
        ].join("\n"),
      );
    }
    if (has("Write")) {
      lines.push(
        "- Write fully creates or overwrites one text file. The path must include the intended filename, not just a directory.",
      );
    }
    if (has("Edit")) {
      lines.push(
        "- Edit performs exact-string replacement, with automatic fallbacks for line-ending (CRLF/LF), trailing-whitespace, and uniform-indentation drift — copy old_string from Read output as-is and do not pad it with guessed whitespace. If `old_string` matches multiple places, either narrow it until it is unique or pass `replace_all=true` explicitly.",
      );
    }
    if (has("Delete")) {
      lines.push(
        "- For workspace or Skill deletion, use Delete with the exact path returned by List/Glob/Grep/Read.",
      );
    }
    if (hasAny("Grep", "Glob", "List")) {
      lines.push(
        "- For search, use `Grep.output_mode=content|files|count` with `head_limit`, `offset`, and `context` instead of dumping raw matches.",
      );
    }
    if (has("SkillsManager") && hasReadFamily) {
      lines.push(
        "- For files inside a Skill, call file tools with a path like `skill://<baseDir>/references/guide.md`.",
      );
    }
    if (has("Bash")) {
      const alts: string[] = [];
      if (hasReadFamily) alts.push("read / list / search via `cat`, `ls`, `find`, `grep`, or `rg`");
      if (has("Write")) {
        alts.push(
          "write / create files via heredocs, `tee`, `touch`, `cp`, or `mkdir` just to prepare a parent directory",
        );
      }
      if (has("Delete")) alts.push("delete via `rm`, `rmdir`, `unlink`, or `find -delete`");
      if (alts.length > 0) {
        lines.push(
          `- Do NOT use Bash to ${alts.join(" or ")} workspace or Skill files — use the corresponding file tool above.`,
        );
      }
      if (hasReadFamily) {
        lines.push(
          "- Do not run Bash cat/ls/find/grep to read, list, or search workspace or Skill files.",
        );
      }
      if (has("Delete")) {
        lines.push(
          "- Do not run Bash rm, rmdir, unlink, or find -delete for workspace or Skill files.",
        );
      }
    }
    sections.push(lines.join("\n"));
  }

  if (has("Image")) {
    sections.push(
      [
        "## Showing Images",
        "- To display any image in the chat UI, call the Image tool.",
        "- Do not embed images with Markdown syntax like ![alt](path), HTML <img>, file:// URLs, or local relative image paths in your final text.",
        has("SkillsManager")
          ? [
              "- Local image: pass `path` exactly as seen, including workspace-relative, absolute, or skill:// paths. Remote image: pass `url` / `urls` or `source` / `sources` directly — do not download unless the user asked to save it locally.",
              "- Do not use Bash, open, xdg-open, Markdown, or HTML to display Skill images.",
            ].join("\n")
          : "- Local image: pass `path` exactly as seen. Remote image: pass `url` / `urls` or `source` / `sources` directly — do not download unless the user asked to save it locally.",
        "- For remote images, call Image with url/urls or source/sources directly instead of downloading them, unless the user explicitly asks to save the file locally.",
        "- Whenever an image path or URL appears in the conversation (from the user, a tool result, or earlier context) and the user should see it, call Image with that path/URL before producing the final reply.",
        "- If another tool saves, downloads, screenshots, generates, or returns an image file path or image URL and the user should see it, call Image with that path or URL before the final response.",
        "- Your final text may caption or describe images already shown via Image; it must not try to render them itself.",
        "- Final text may describe or caption images already displayed by Image, but must not attempt to render images directly.",
      ].join("\n"),
    );
  }

  if (has("Bash")) {
    const bashPlatformLines =
      runtimePlatform === "windows"
        ? [
            `- Current platform: ${platformLabel}. Bash runs through Git Bash with POSIX semantics; pwsh, Windows PowerShell, and cmd are fallbacks used only when Git Bash is not installed.`,
            "- Write POSIX/bash-compatible commands by default: `export`, `&&`, `/dev/null`, forward-slash paths.",
            "- Background commands using `&` must redirect stdout and stderr before detaching, for example `nohup command > /tmp/xgent-task.log 2>&1 < /dev/null &`.",
            "- If a Bash result header reports `shell_family: powershell` or `shell_family: cmd`, Git Bash is missing: switch to PowerShell syntax and suggest installing Git for Windows or setting `XGENT_GIT_BASH_PATH`.",
          ]
        : [
            `- Current platform: ${platformLabel}. Bash runs through POSIX shells.`,
            runtimePlatform === "macos"
              ? "- macOS prefers zsh, then Bash, then sh. Use POSIX/zsh-compatible commands."
              : runtimePlatform === "android"
                ? "- Android executes inside the installed Alpine PRoot environment. Use POSIX shell commands and only capability packs reported by Mobile execution settings."
                : runtimePlatform === "ios"
                  ? "- iOS/iPadOS exposes a restricted a-Shell-compatible native command catalog. Arbitrary WASI modules stay disabled until enforceable interruption is available; do not assume Linux process APIs, Node.js/npm, or arbitrary native packages."
                  : "- Linux prefers Bash, then zsh, then sh. Use POSIX/bash-compatible commands.",
            runtimePlatform === "android" || runtimePlatform === "ios"
              ? "- Mobile operating systems may suspend the app. Keep commands foreground and bounded; do not detach background services."
              : "- Background commands using `&` must redirect stdout and stderr before detaching, for example `nohup command > /tmp/xgent-task.log 2>&1 < /dev/null &`.",
          ];
    sections.push(
      [
        "## Bash",
        "- Bash.cwd follows the path rules in **Workspace & Paths**.",
        ...bashPlatformLines,
        '- To run installed Skill scripts, use cwd="skill://<enabled-skill>/scripts" plus a relative command.',
        "- Passing an absolute Skill script path inside the command is also accepted as long as the referenced Skill is enabled in this conversation.",
        "- For endpoint tests with curl, include an explicit timeout such as `--max-time 30` so a stalled local server or upstream request cannot hold the whole turn indefinitely.",
        "- Use ManagedProcess instead of Bash for dev servers, watchers, preview servers, or anything that should keep running.",
        "- For reading, listing, or searching Skill content, always use Read/List/Glob/Grep with skill:// paths — Bash cat/ls/find/grep/rg/sed/awk against ~/.xgent/skills is still routed back to the file tools.",
        "- Do not guess `skills/` paths inside the workspace; if a Skill is needed, enable it in the chat Skills selector first.",
        "- Do not cd into ~/.xgent/skills or workspace skills/ guesses.",
      ].join("\n"),
    );
  }

  if (has("Agent")) {
    sections.push(
      [
        "## Agent Delegation",
        "- Use Agent for bounded, independent jobs that benefit from a fresh context: implementation, research, review, discussion, or verification. Do not delegate trivial work you can finish yourself.",
        "- To run multiple independent jobs in parallel, issue ONE Agent call whose `agents` array lists every job. Use sequential Agent calls only when a later job needs an earlier job's output.",
        "- Default to mode=readonly for research, review, and discussion agents. Use mode=worktree (with apply_policy) only when the subagent is expected to produce file changes or the user explicitly asked for file output.",
        "- To continue with an existing delegated agent or a previously formed team, call Agent again with the same stable id(s) and only the new prompt — do not impersonate those agents from this transcript and do not restate their identity fields.",
        "- If an Agent call is rejected, no subagents were started; fix every listed issue and retry with one corrected call.",
      ].join("\n"),
    );
  }

  if (has("SendMessage")) {
    sections.push(
      [
        "## Subagent Message Bus",
        "- Use SendMessage to send concise Markdown messages to the parent agent, all agents (to=*), or a stable delegated-agent id from the roster. Unknown recipients are rejected.",
        "- Messages sent to parent are private to the parent; send to=* when peer agents need to read a report or summary.",
        "- Message delivery is deferred to the next model turn boundary; do not use workspace files as a mailbox.",
      ].join("\n"),
    );
  }

  if (has("ManagedProcess")) {
    const managedProcessPreference =
      "- Prefer ManagedProcess over Bash for `pnpm dev`, `deno run main.ts`, `vite`, file watchers, local web servers, or commands that otherwise require `nohup` and log redirection.";
    sections.push(
      [
        "## ManagedProcess",
        '- Use ManagedProcess(action="start") for dev servers, preview servers, watchers, or other long-running foreground commands that should continue while you run tests.',
        "- Do not append `&` to ManagedProcess.command. It starts the process in the background, redirects stdout/stderr to a log file, and returns process_id/pid/log_path.",
        '- Use ManagedProcess(action="status") to inspect running processes, action="read_log" to inspect recent output, and action="stop" to terminate the process tree.',
        managedProcessPreference,
      ].join("\n"),
    );
  }

  if (has("TodoWrite")) {
    sections.push(
      [
        "## Task Planning (TodoWrite)",
        "- Proactively use TodoWrite for multi-step tasks (3+ distinct steps) or when the user gives multiple tasks; skip it for a single trivial action.",
        "- Every call replaces the entire list — pass the complete, current set of todos each time, not a delta.",
        "- Every non-empty list with unfinished work must have exactly one item with status=in_progress. Mark it in_progress before starting, and immediately (not batched) mark it completed as soon as it is done, before starting the next.",
        "- Plans with 3+ items must contain a concrete final verification item appropriate to the work (tests, typecheck, build, validation, or review). Do not mark that item completed until its evidence succeeds.",
        '- content is the imperative/declarative form ("Run tests"); activeForm is the present-continuous form shown only while in_progress ("Running tests").',
        "- Keep each item specific and actionable; break vague or large items into smaller ones.",
      ].join("\n"),
    );
  }

  if (has("MemoryManager")) {
    sections.push(buildMemoryToolsSuffixSection());
  }

  if (has("McpManager") || hasDynamicMcp) {
    const lines: string[] = ["## MCP"];
    if (has("McpManager")) {
      lines.push(
        "- **McpManager** is configuration only: manage, validate, test, diagnose, restart, stop, or list MCP servers and their tool inventory. It does NOT execute MCP domain calls.",
      );
    }
    if (hasDynamicMcp) {
      lines.push(
        "- The dynamically loaded `mcp_*` tools are where actual MCP domain actions (database queries, API calls, integrations exposed by MCP servers) happen.",
      );
    }
    sections.push(lines.join("\n"));
  }

  sections.push(
    toolGroups.length > 0
      ? ["## Available Tools", ...toolGroups.map((group) => `- ${group}`)].join("\n")
      : "## Available Tools\n- none.",
  );

  return sections.join("\n\n");
  */
}

function toolNameLookupKey(name: string) {
  return name.trim().toLowerCase();
}

function buildToolNameCanonicalizer(tools: readonly { name: string }[]) {
  const canonicalByKey = new Map<string, string | null>();
  for (const tool of tools) {
    const key = toolNameLookupKey(tool.name);
    if (!key) continue;
    const existing = canonicalByKey.get(key);
    if (existing === undefined) {
      canonicalByKey.set(key, tool.name);
    } else if (existing !== tool.name) {
      canonicalByKey.set(key, null);
    }
  }

  return (name: string) => {
    const canonical = canonicalByKey.get(toolNameLookupKey(name));
    return canonical ?? name;
  };
}

function normalizeToolCallName(toolCall: ToolCall, canonicalizeToolName: (name: string) => string) {
  const canonicalName = canonicalizeToolName(toolCall.name);
  if (canonicalName === toolCall.name) return toolCall;
  return {
    ...toolCall,
    name: canonicalName,
  };
}

function normalizeAssistantToolCallNames(
  assistant: AssistantMessage,
  canonicalizeToolName: (name: string) => string,
) {
  let changed = false;
  const nextContent = assistant.content.map((block) => {
    if (block.type !== "toolCall") return block;
    const nextBlock = normalizeToolCallName(block, canonicalizeToolName);
    if (nextBlock !== block) changed = true;
    return nextBlock;
  });

  if (changed) {
    assistant.content = nextContent;
  }
  return assistant;
}

function getComparableCanonicalToolCall(
  toolCall: ToolCall,
  canonicalizeToolName: (name: string) => string,
) {
  return comparableToolCall(normalizeToolCallName(toolCall, canonicalizeToolName));
}

function dedupeRecoveredToolCallsAgainstExisting(params: {
  existingAssistant: AssistantMessage;
  recoveredToolCalls: ToolCall[];
  canonicalizeToolName: (name: string) => string;
}) {
  const seen = new Set(
    params.existingAssistant.content
      .filter((block): block is ToolCall => block.type === "toolCall")
      .map((toolCall) => getComparableCanonicalToolCall(toolCall, params.canonicalizeToolName)),
  );
  const uniqueToolCalls: ToolCall[] = [];
  const duplicateToolCallIds = new Set<string>();

  for (const toolCall of params.recoveredToolCalls) {
    const normalizedToolCall = normalizeToolCallName(toolCall, params.canonicalizeToolName);
    const comparable = comparableToolCall(normalizedToolCall);
    if (seen.has(comparable)) {
      duplicateToolCallIds.add(normalizedToolCall.id);
      continue;
    }
    seen.add(comparable);
    uniqueToolCalls.push(normalizedToolCall);
  }

  return {
    uniqueToolCalls,
    duplicateToolCallIds,
  };
}

function buildSystemPrompt(base: string | undefined, suffix: string) {
  const head = (base || "").trim();
  if (!head) return suffix;
  return `${head}\n\n${suffix}`;
}

function toSyntheticToolCall(params: {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
}): ToolCall {
  return {
    type: "toolCall",
    id: params.id,
    name: params.name,
    arguments: params.arguments ?? {},
  };
}

function toAssistantThinkingLevel(params: {
  providerId: ProviderId;
  reasoning?: ReasoningLevel;
  api: string;
}): ModelThinkingLevel {
  if (params.providerId === "claude_code") {
    return params.reasoning && params.reasoning !== "off" ? params.reasoning : "off";
  }
  if (params.providerId === "gemini") {
    if (!params.reasoning || params.reasoning === "off") return "off";
    return params.reasoning === "xhigh" || params.reasoning === "max" ? "high" : params.reasoning;
  }
  if (params.api !== "openai-responses" && params.api !== "openai-completions") {
    return "off";
  }
  return params.reasoning && params.reasoning !== "off" ? params.reasoning : "off";
}

function normalizeStreamReasoning(value: unknown): StreamOptionsEx["reasoning"] | undefined {
  switch (value) {
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return value;
    default:
      return undefined;
  }
}

function getAssistantToolCalls(assistant: AssistantMessage): ToolCall[] {
  return assistant.content.filter((block): block is ToolCall => block.type === "toolCall");
}

function findConsecutiveToolGroup(
  assistant: AssistantMessage,
  toolCallId: string,
  toolName: string,
): ToolCall[] | null {
  const toolCalls = getAssistantToolCalls(assistant);
  const idx = toolCalls.findIndex((call) => call.id === toolCallId);
  if (idx < 0 || toolCalls[idx].name !== toolName) return null;

  let start = idx;
  while (start > 0 && toolCalls[start - 1].name === toolName) start -= 1;

  let end = idx;
  while (end + 1 < toolCalls.length && toolCalls[end + 1].name === toolName) end += 1;

  return toolCalls.slice(start, end + 1);
}

function buildParallelToolBatchKey(group: ToolCall[]) {
  return group.map((call) => call.id).join("|");
}

type ParallelToolBatch = {
  toolName: string;
  toolCalls: ToolCall[];
  started: boolean;
  announced: boolean;
  resultPromises: Map<string, Promise<ToolResultMessage>>;
};

function getParallelToolBatch(
  toolCallId: string,
  parallelBatchKeyByToolCallId: Map<string, string>,
  parallelToolBatches: Map<string, ParallelToolBatch>,
) {
  const batchKey = parallelBatchKeyByToolCallId.get(toolCallId);
  if (!batchKey) return null;
  return parallelToolBatches.get(batchKey) ?? null;
}

function getParallelToolBatchStatus(batch: ParallelToolBatch) {
  if (batch.toolName === "Bash") {
    return `正在并行执行 ${batch.toolCalls.length} 个 Bash 命令...`;
  }
  if (batch.toolName === "Agent") {
    return `正在并行执行 ${batch.toolCalls.length} 个 Agent 调用...`;
  }
  return `正在并行执行 ${batch.toolCalls.length} 个 ${batch.toolName} 调用...`;
}

function toMessageToolResult(message: Message, toolCall: ToolCall): ToolResultMessage {
  if (message.role === "toolResult") return message;
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text: "Tool did not return a toolResult message" }],
    details: {},
    isError: true,
    timestamp: Date.now(),
  };
}

type TurnContextOverride = {
  context: Context;
  emittedMessages: Message[];
  wireTailText?: string;
} | null;

type ToolExecutionEventContext = {
  parentToolCall: ToolCall;
  subagentScheduler: SubagentScheduler;
  emitToolCall: (toolCall: ToolCall) => void;
  emitToolExecutionStart: (toolCall: ToolCall) => void;
  emitToolResult: (toolCall: ToolCall, toolResult: ToolResultMessage) => void;
  emitToolStatus: (status: string | null) => void;
};

function getAgentMessages(agent: Agent | null): Message[] {
  return agent ? (agent.state.messages as Message[]) : [];
}

function getMessagesSinceBaseline(agent: Agent | null, baselineIndex: number): Message[] {
  const messages = getAgentMessages(agent);
  if (baselineIndex <= 0) return messages.slice();
  if (baselineIndex >= messages.length) return [];
  return messages.slice(baselineIndex);
}

function findLastAssistantMessage(messages: Message[]): AssistantMessage | null {
  return (
    [...messages]
      .reverse()
      .find((message): message is AssistantMessage => message.role === "assistant") ?? null
  );
}

export type AgentRunnerFailoverTarget = {
  selectedModel: SelectedModel;
  providerId: ProviderId;
  model: string;
  label: string;
  runtime: ProviderRuntimeConfig;
};

export type AgentRunnerFailoverSwitchEvent = {
  target: AgentRunnerFailoverTarget | null;
  round: number;
  errorMessage: string;
};

export type AgentRunnerFailoverParams = {
  config: ModelFailoverRuntimeConfig;
  primary: { selectedModel?: SelectedModel; label: string };
  fallbacks: AgentRunnerFailoverTarget[];
  onSwitched?: (event: AgentRunnerFailoverSwitchEvent) => void;
};

export async function runAssistantWithTools(params: {
  providerId: ProviderId;
  model: string;
  runtime: ProviderRuntimeConfig;
  failover?: AgentRunnerFailoverParams;
  runtimePlatform?: RuntimePlatform;
  context: Context;
  workdir: string;
  additionalRoots?: readonly AdditionalProjectRoot[];
  sessionId?: string;
  nativeWebSearch?: boolean;
  tools: Context["tools"];
  executeToolCall: (
    toolCall: ToolCall,
    signal?: AbortSignal,
    context?: ToolExecutionEventContext,
  ) => Promise<Message>;
  onTurnStart?: (round: number) => void;
  onTextDelta: (delta: string, round: number) => void;
  onThinkingDelta?: (delta: string, round: number) => void;
  onToolCall?: (toolCall: ToolCall, round: number) => void;
  onToolCallDelta?: (toolCall: ToolCall, round: number) => void;
  onHostedSearch?: (hostedSearch: HostedSearchBlock, round: number) => void;
  onToolExecutionStart?: (toolCall: ToolCall, round: number) => void;
  onToolResult?: (toolCall: ToolCall, toolResult: Message, round: number) => void;
  onAssistantMessage?: (assistant: Message, round: number) => void;
  onBeforeNextTurn?: (params: {
    round: number;
    assistant: AssistantMessage;
    toolResults: ToolResultMessage[];
    runtimeContext: Context;
    emittedMessages: Message[];
    signal?: AbortSignal;
  }) => Promise<{
    context: Context;
    emittedMessages: Message[];
    wireTailText?: string;
  } | null>;
  onToolStatus?: (status: string | null) => void;
  onRetryAttempts?: (round: number, attempts: RetryAttemptRecord[]) => void;
  onFailoverAttempt?: (
    round: number,
    event: {
      attempt: number;
      fromLabel: string;
      toLabel: string;
      targetIndex: number;
      errorMessage: string;
    },
  ) => void;
  onTransportAttempt?: (
    round: number,
    snapshot: TransportSnapshot & { providerLabel: string },
  ) => void;
  onRequestStart?: (params: { round: number; context: Context; toolsSuffix: string }) => void;
  signal?: AbortSignal;
  debugLogger?: StreamDebugLogger;
  subagentScheduler?: SubagentScheduler;
  allowEmptyWorkdir?: boolean;
  resolveToolGate?: (
    toolCall: ToolCall,
    signal?: AbortSignal,
  ) => Promise<{ allow: true } | { allow: false; reason: string }>;
  requestToolFilter?: (toolName: string) => boolean;
  resolveToolTermination?: (toolCall: ToolCall) => boolean;
  resolveToolChoice?: (round: number) => ToolChoice | undefined;
  maxRounds?: number;
}) {
  const modelId = params.model.trim();
  if (!modelId) throw new Error("No model selected");
  if (!params.runtime.baseUrl.trim()) throw new Error("Base URL cannot be empty");
  if (params.runtime.authMode !== "oauth-managed" && !params.runtime.apiKey.trim()) {
    throw new Error("API Key cannot be empty");
  }
  if (params.runtime.authMode === "oauth-managed" && !params.runtime.oauthAccountId?.trim()) {
    throw new Error("OpenAI OAuth account is not selected");
  }
  if (!params.workdir.trim() && !params.allowEmptyWorkdir) {
    throw new Error("A working directory must be configured for tool mode");
  }
  if (params.signal?.aborted) throw new Error("Cancelled");

  const subagentScheduler = params.subagentScheduler ?? createSubagentScheduler();

  return withPowerActivity("assistant-tools", `${params.providerId}:${modelId}`, async () => {
    const proxyRequest = await prepareProviderRequest(params.providerId, params.runtime, {
      sessionId: params.sessionId,
    });

    const model = createModelFromConfig(
      params.providerId,
      modelId,
      proxyRequest.baseUrl,
      params.runtime.requestFormat,
      params.runtime.modelConfig,
      params.runtime.baseUrl.trim(),
    );
    const nativeWebSearchStatus = resolveProviderNativeWebSearchStatus({
      providerId: params.providerId,
      api: model.api,
      enabled: params.nativeWebSearch,
      baseUrl: params.runtime.baseUrl,
      modelId,
    });
    const nativeWebSearchStatusController = createDeferredProviderNativeWebSearchStatus({
      status: nativeWebSearchStatus,
      onStatus: (status) => params.onToolStatus?.(status),
    });

    const thinkingLevel = toAssistantThinkingLevel({
      providerId: params.providerId,
      reasoning: params.runtime.reasoning,
      api: model.api,
    });

    // ---- Provider auto-failover targets -----------------------------------
    // Target 0 is the primary (params.providerId/model/runtime); the rest map
    // to params.failover.fallbacks in queue order. Fallback proxy/model
    // preparation is lazy so unused fallbacks never touch the hot path.
    type PreparedFailoverTarget = {
      index: number;
      key: string;
      label: string;
      selectedModel?: SelectedModel;
      providerId: ProviderId;
      modelId: string;
      runtime: ProviderRuntimeConfig;
      proxyRequest: PreparedProxyRequest;
      model: ReturnType<typeof createModelFromConfig>;
    };

    const failoverParams = params.failover;
    const primaryTarget: PreparedFailoverTarget = {
      index: 0,
      key: failoverParams?.primary.selectedModel
        ? failoverBreakerKey(
            failoverParams.primary.selectedModel.customProviderId,
            failoverParams.primary.selectedModel.model,
          )
        : failoverBreakerKey(params.providerId, modelId),
      label: failoverParams?.primary.label ?? `${params.providerId} · ${modelId}`,
      selectedModel: failoverParams?.primary.selectedModel,
      providerId: params.providerId,
      modelId,
      runtime: params.runtime,
      proxyRequest,
      model,
    };

    const preparedFallbackTargets = new Map<number, Promise<PreparedFailoverTarget>>();
    const prepareFallbackTarget = (index: number): Promise<PreparedFailoverTarget> => {
      const existing = preparedFallbackTargets.get(index);
      if (existing) return existing;
      const fallback = failoverParams?.fallbacks[index - 1];
      if (!fallback) {
        return Promise.reject(new Error(`Unknown failover target index: ${index}`));
      }
      const prepared = (async () => {
        const fallbackProxyRequest = await prepareProviderRequest(
          fallback.providerId,
          fallback.runtime,
          { sessionId: params.sessionId },
        );
        return {
          index,
          key: failoverBreakerKey(
            fallback.selectedModel.customProviderId,
            fallback.selectedModel.model,
          ),
          label: fallback.label,
          selectedModel: fallback.selectedModel,
          providerId: fallback.providerId,
          modelId: fallback.model,
          runtime: fallback.runtime,
          proxyRequest: fallbackProxyRequest,
          model: createModelFromConfig(
            fallback.providerId,
            fallback.model,
            fallbackProxyRequest.baseUrl,
            fallback.runtime.requestFormat,
            fallback.runtime.modelConfig,
            fallback.runtime.baseUrl.trim(),
          ),
        } satisfies PreparedFailoverTarget;
      })();
      // A failed preparation must not be cached forever; allow later retries.
      preparedFallbackTargets.set(
        index,
        prepared.catch((error) => {
          preparedFallbackTargets.delete(index);
          throw error;
        }),
      );
      return preparedFallbackTargets.get(index) as Promise<PreparedFailoverTarget>;
    };

    /** Cheap, IO-free model identity for failover bookkeeping/synthesis. */
    const fallbackTargetIdentity = (index: number) => {
      const fallback = failoverParams?.fallbacks[index - 1];
      if (!fallback) return { api: model.api, provider: model.provider, id: modelId };
      const identity = createModelFromConfig(
        fallback.providerId,
        fallback.model,
        fallback.runtime.baseUrl.trim(),
        fallback.runtime.requestFormat,
        fallback.runtime.modelConfig,
        fallback.runtime.baseUrl.trim(),
      );
      return { api: identity.api, provider: identity.provider, id: identity.id };
    };

    // Sticky winner: rounds after a successful failover start on the target
    // that actually answered, mirroring cc-switch's hot switch semantics.
    let activeFailoverTargetIndex = 0;
    let lastFailoverErrorMessage = "";
    // ------------------------------------------------------------------------

    const toolResultErrorFlags = new Map<string, boolean>();
    const toolCallsById = new Map<string, ToolCall>();
    const incompleteToolCallArguments = new Map<string, string>();
    const refusedTruncatedToolCallIds = new Set<string>();
    const buildTruncatedToolCallText = (toolName: string, reason: string) =>
      `${toolName} was not executed: its arguments were truncated in transit (${reason}). ` +
      `This is a transport error, not a mistake in your call — re-issue the complete ${toolName} call with full arguments.`;
    const parallelBatchKeyByToolCallId = new Map<string, string>();
    const parallelToolBatches = new Map<string, ParallelToolBatch>();
    const llmTools = params.tools ?? [];
    const canonicalizeToolName = buildToolNameCanonicalizer(llmTools);
    const normalizeToolCallNameForExecution = (toolCall: ToolCall) =>
      normalizeToolCallName(toolCall, canonicalizeToolName);
    const normalizeAssistantToolCallNamesForExecution = (assistant: AssistantMessage) =>
      normalizeAssistantToolCallNames(assistant, canonicalizeToolName);
    let currentRound = 0;

    const executeSingleToolCall = async (
      toolCall: ToolCall,
      signal?: AbortSignal,
    ): Promise<{ content: ToolResultMessage["content"]; details: unknown }> => {
      throwIfRunnerCancelled(signal ?? params.signal);
      const effectiveToolCall = normalizeToolCallNameForExecution(toolCall);
      if (effectiveToolCall !== toolCall) {
        toolCallsById.set(effectiveToolCall.id, effectiveToolCall);
      }
      let toolResult: ToolResultMessage;
      const linkedSignal = createLinkedAbortSignal([signal, params.signal]);
      try {
        if (shouldSilenceProviderNativeWebSearchToolCall(effectiveToolCall)) {
          toolResult = buildProviderNativeWebSearchBridgeResult({
            toolCall: effectiveToolCall,
            hostedSearchBlocks: hostedSearchBlocksByRound.get(currentRound) ?? [],
            sourcesIntro: "Hosted search sources already captured in this round:",
            fallbackText:
              "No local web_search executor is available. Continue from existing context, or request provider-native web search through the model/tool protocol instead of printing raw tool-call markup.",
            extraInstructions: ["Do not repeat raw tool-call markup in the final answer."],
          });
        } else if (shouldSilenceProviderNativeWebFetchToolCall(effectiveToolCall)) {
          toolResult = buildProviderNativeWebFetchBridgeResult({
            toolCall: effectiveToolCall,
            hostedSearchBlocks: hostedSearchBlocksByRound.get(currentRound) ?? [],
            sourcesIntro: "Hosted search sources already captured in this round:",
            fallbackText:
              "No hosted search sources were captured in this round. Continue from existing context.",
            extraInstructions: ["Do not repeat raw tool-call markup in the final answer."],
          });
        } else {
          const execute = () =>
            params.executeToolCall(effectiveToolCall, linkedSignal.signal, {
              parentToolCall: effectiveToolCall,
              subagentScheduler,
              emitToolCall: (emittedToolCall) => {
                toolCallsById.set(emittedToolCall.id, emittedToolCall);
                params.onToolCall?.(emittedToolCall, currentRound);
              },
              emitToolExecutionStart: (emittedToolCall) => {
                toolCallsById.set(emittedToolCall.id, emittedToolCall);
                params.onToolExecutionStart?.(emittedToolCall, currentRound);
              },
              emitToolResult: (emittedToolCall, emittedToolResult) => {
                toolCallsById.set(emittedToolCall.id, emittedToolCall);
                toolResultErrorFlags.set(emittedToolCall.id, Boolean(emittedToolResult.isError));
                params.onToolResult?.(emittedToolCall, emittedToolResult, currentRound);
              },
              emitToolStatus: (status) => params.onToolStatus?.(status),
            });
          toolResult = toMessageToolResult(
            await (effectiveToolCall.name === "Bash"
              ? subagentScheduler.runBash(execute, linkedSignal.signal)
              : execute()),
            effectiveToolCall,
          );
        }
      } catch (error) {
        toolResult = {
          role: "toolResult",
          toolCallId: effectiveToolCall.id,
          toolName: effectiveToolCall.name,
          content: [
            {
              type: "text",
              text: normalizeErrorMessage(
                error instanceof Error ? error.message : String(error),
                "Tool execution failed",
              ),
            },
          ],
          details: {},
          isError: true,
          timestamp: Date.now(),
        };
      } finally {
        linkedSignal.cleanup();
      }
      throwIfRunnerCancelled(linkedSignal.signal);

      toolResultErrorFlags.set(effectiveToolCall.id, Boolean(toolResult.isError));
      return {
        content: toolResult.content,
        details: toolResult.details ?? {},
      };
    };

    const startParallelToolBatchIfNeeded = (batchKey: string, signal?: AbortSignal) => {
      const batch = parallelToolBatches.get(batchKey);
      if (!batch || batch.started) return batch;

      batch.started = true;
      if (batch.toolCalls.length > 1 && !batch.announced) {
        batch.announced = true;
        params.onToolStatus?.(getParallelToolBatchStatus(batch));
      }

      const allResultsPromise = runWithConcurrency(
        batch.toolCalls,
        subagentScheduler.getParallelToolLimit(batch.toolName),
        async (call) => {
          const result = await executeSingleToolCall(call, signal);
          return {
            role: "toolResult",
            toolCallId: call.id,
            toolName: call.name,
            content: result.content,
            details: result.details,
            isError: toolResultErrorFlags.get(call.id) ?? false,
            timestamp: Date.now(),
          } satisfies ToolResultMessage;
        },
      );

      batch.resultPromises = new Map(
        batch.toolCalls.map((call, index) => [
          call.id,
          allResultsPromise.then((results) => results[index]),
        ]),
      );

      return batch;
    };

    const localToolNames = new Set(llmTools.map((tool) => tool.name));
    const hiddenProviderNativeWebSearchToolNames = new Set<string>(
      nativeWebSearchStatus
        ? HIDDEN_PROVIDER_NATIVE_WEB_SEARCH_TOOL_NAMES.filter((name) => !localToolNames.has(name))
        : [],
    );
    const hiddenProviderNativeWebFetchToolNames = new Set<string>(
      nativeWebSearchStatus
        ? HIDDEN_PROVIDER_NATIVE_WEB_FETCH_TOOL_NAMES.filter((name) => !localToolNames.has(name))
        : [],
    );
    const shouldSilenceProviderNativeWebSearchToolCall = (toolCall: ToolCall) =>
      Boolean(
        nativeWebSearchStatus &&
          !localToolNames.has(toolCall.name) &&
          isProviderNativeWebSearchToolName(toolCall.name),
      );
    const shouldSilenceProviderNativeWebFetchToolCall = (toolCall: ToolCall) =>
      Boolean(
        nativeWebSearchStatus &&
          !localToolNames.has(toolCall.name) &&
          isProviderNativeWebFetchToolName(toolCall.name),
      );
    // Single gate for every tool-event suppression site: bridged web_search and
    // web_fetch calls must never surface as tool rows/status lines in the UI.
    const shouldSilenceProviderNativeToolCall = (toolCall: ToolCall) =>
      shouldSilenceProviderNativeWebSearchToolCall(toolCall) ||
      shouldSilenceProviderNativeWebFetchToolCall(toolCall);
    const filterRequestTools = (
      tools: Context["tools"] | undefined,
    ): Context["tools"] | undefined =>
      tools?.filter(
        (tool) =>
          !hiddenProviderNativeWebSearchToolNames.has(tool.name) &&
          !hiddenProviderNativeWebFetchToolNames.has(tool.name) &&
          (params.requestToolFilter?.(tool.name) ?? true),
      );

    const assistantVisibleAnswerText = (assistant: AssistantMessage) =>
      stripSeedToolCallMarkup(
        assistant.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n"),
      ).trim();

    // Relays that execute Anthropic server tools in-band can leak the original
    // tool_use blocks with stop_reason end_turn *after* the model has already
    // written its final answer (the server results streamed mid-generation, so
    // the answer text follows them in the same message). Bridging those calls
    // and letting pi-agent-core run another model turn makes Claude answer the
    // same question again — duplicate output after every web search. Marking
    // every bridged call of such a batch as terminate keeps the bridge results
    // in history (the next request stays protocol-consistent) but ends the run
    // on the answer the user already has. Guards: the model must have finished
    // normally with visible answer text, and a leaked search call additionally
    // needs completed in-round hosted-search sources — a model that is still
    // waiting for results (raw-markup recovery, relays that execute nothing)
    // keeps its follow-up turn.
    const shouldTerminateBridgedProviderNativeToolCall = async (
      assistant: AssistantMessage,
      toolCall: ToolCall,
    ) => {
      if (!shouldSilenceProviderNativeToolCall(toolCall)) return false;
      if (assistant.stopReason !== "stop") return false;
      if (assistantVisibleAnswerText(assistant).length === 0) return false;
      if (isProviderNativeWebSearchToolName(toolCall.name)) {
        // Await the round's probe finalization (message_end already queued this
        // exact promise) so the coverage decision reads the complete in-band
        // search metadata instead of racing the response-clone parser.
        const blocks = await finishHostedSearchRound(currentRound, "completed");
        return blocks.some((block) => block.status === "completed" && block.sources.length > 0);
      }
      // web_fetch bridges never add new information; once the model has
      // delivered its answer there is nothing for a follow-up turn to do.
      return true;
    };
    const toolsSuffix = buildToolsSuffix(
      params.workdir,
      llmTools.map((tool) => tool.name),
      params.runtimePlatform,
      params.additionalRoots,
    );
    let currentSystemPrompt = params.context.systemPrompt;
    let emittedBaselineIndex = params.context.messages.length;
    let latestAgentEndMessages: Message[] = [];

    let accumulatedWireTailBlocks: PinnedTailBlock[] = [];
    let agentTools: AgentTool[] = [];
    const pendingRecoveredSeedTurnRef: {
      current: {
        round: number;
        assistant: AssistantMessage;
        toolCalls: ToolCall[];
      } | null;
    } = {
      current: null,
    };
    let agent: Agent | null = null;
    const hostedSearchBlocksByRound = new Map<number, HostedSearchBlock[]>();
    const hostedSearchOrderedBlocksByRound = new Map<number, HostedSearchOrderedBlock[]>();
    const hostedSearchProbeByRound = new Map<
      number,
      {
        finishProbe: () => Promise<void>;
        completeAggregator: () => HostedSearchBlock[];
        failAggregator: () => HostedSearchBlock[];
        disposeAggregator: () => HostedSearchBlock[];
        finalization?: Promise<HostedSearchBlock[]>;
      }
    >();
    const hostedSearchFinalizations = new Set<Promise<void>>();

    function upsertHostedSearchBlockForRound(round: number, hostedSearch: HostedSearchBlock) {
      const blocks = hostedSearchBlocksByRound.get(round) ?? [];
      const idx = blocks.findIndex((block) => block.id === hostedSearch.id);
      const next = blocks.slice();
      if (idx >= 0) {
        next[idx] = mergeHostedSearchBlocks(next[idx], hostedSearch);
      } else {
        next.push(hostedSearch);
      }
      hostedSearchBlocksByRound.set(round, next);
    }

    function getHostedSearchOrderedBlocksForRound(round: number) {
      const blocks = hostedSearchOrderedBlocksByRound.get(round) ?? [];
      if (!hostedSearchOrderedBlocksByRound.has(round)) {
        hostedSearchOrderedBlocksByRound.set(round, blocks);
      }
      return blocks;
    }

    function appendHostedSearchOrderedTextForRound(round: number, delta: string) {
      if (!delta) return;
      const blocks = getHostedSearchOrderedBlocksForRound(round);
      const last = blocks[blocks.length - 1];
      if (last?.kind === "text") {
        blocks[blocks.length - 1] = {
          kind: "text",
          text: last.text + delta,
        };
      } else {
        blocks.push({ kind: "text", text: delta });
      }
    }

    function upsertHostedSearchOrderedBlockForRound(
      round: number,
      hostedSearch: HostedSearchBlock,
    ) {
      const blocks = getHostedSearchOrderedBlocksForRound(round);
      const idx = blocks.findIndex(
        (block) => block.kind === "hostedSearch" && block.item.id === hostedSearch.id,
      );
      if (idx >= 0) {
        const existing = blocks[idx];
        if (existing?.kind === "hostedSearch") {
          blocks[idx] = {
            kind: "hostedSearch",
            item: mergeHostedSearchBlocks(existing.item, hostedSearch),
          };
        }
        return;
      }
      blocks.push({ kind: "hostedSearch", item: hostedSearch });
    }

    function getHostedSearchBlocksForRound(round: number) {
      return hostedSearchBlocksByRound.get(round) ?? [];
    }

    function finishHostedSearchRound(
      round: number,
      mode: "completed" | "failed" | "dispose",
    ): Promise<HostedSearchBlock[]> {
      const controller = hostedSearchProbeByRound.get(round);
      if (!controller) return Promise.resolve(getHostedSearchBlocksForRound(round));
      if (!controller.finalization) {
        controller.finalization = (async () => {
          await controller.finishProbe();
          const blocks =
            mode === "completed"
              ? controller.completeAggregator()
              : mode === "failed"
                ? controller.failAggregator()
                : controller.disposeAggregator();
          hostedSearchProbeByRound.delete(round);
          if (blocks.length > 0) {
            hostedSearchBlocksByRound.set(round, blocks);
          }
          return getHostedSearchBlocksForRound(round);
        })();
      }
      return controller.finalization;
    }

    function replaceAgentStateMessage(target: Message, replacement: Message) {
      const currentAgent = agent;
      if (!currentAgent) return false;
      const stateMessages = getAgentMessages(currentAgent);
      let targetIndex = stateMessages.lastIndexOf(target);
      if (targetIndex < 0) {
        for (let index = stateMessages.length - 1; index >= 0; index -= 1) {
          const message = stateMessages[index];
          if (!message) continue;
          if (message.role !== target.role) continue;
          if (message.role !== "assistant" || target.role !== "assistant") continue;
          if (
            typeof message.timestamp === "number" &&
            typeof target.timestamp === "number" &&
            message.timestamp === target.timestamp
          ) {
            targetIndex = index;
            break;
          }
        }
      }
      if (targetIndex < 0) return false;
      currentAgent.state.messages = [
        ...stateMessages.slice(0, targetIndex),
        replacement,
        ...stateMessages.slice(targetIndex + 1),
      ];
      return true;
    }

    function applyHostedSearchBlocksToAssistant(
      assistant: AssistantMessage,
      round: number,
      hostedSearchBlocks: HostedSearchBlock[],
    ) {
      return appendHostedSearchBlocksToAssistant(
        assistant as AssistantMessage & { content: unknown[] },
        hostedSearchBlocks,
        {
          orderedBlocks: hostedSearchOrderedBlocksByRound.get(round),
        },
      ) as AssistantMessage;
    }

    function queueHostedSearchFinalization(
      round: number,
      mode: "completed" | "failed" | "dispose",
      assistantRef?: { current: AssistantMessage },
    ) {
      const finalization = finishHostedSearchRound(round, mode)
        .then((hostedSearchBlocks) => {
          if (!assistantRef) return;
          const nextAssistant = applyHostedSearchBlocksToAssistant(
            assistantRef.current,
            round,
            hostedSearchBlocks,
          );
          if (nextAssistant === assistantRef.current) return;
          if (replaceAgentStateMessage(assistantRef.current, nextAssistant)) {
            assistantRef.current = nextAssistant;
          }
        })
        .catch(() => undefined);
      hostedSearchFinalizations.add(finalization);
      void finalization.finally(() => {
        hostedSearchFinalizations.delete(finalization);
      });
    }

    function queueAllHostedSearchFinalizations(mode: "completed" | "failed" | "dispose") {
      for (const round of [...hostedSearchProbeByRound.keys()]) {
        queueHostedSearchFinalization(round, mode);
      }
    }

    async function waitForHostedSearchFinalizations() {
      while (hostedSearchFinalizations.size > 0) {
        await Promise.allSettled([...hostedSearchFinalizations]);
      }
    }

    function applyTurnContextOverride(
      override: Exclude<TurnContextOverride, null>,
    ): AgentContext | undefined {
      if (!agent) return undefined;
      if (override.wireTailText) {
        const anchorToolCallId = resolveTailBlockAnchorId(override.context.messages);
        if (anchorToolCallId) {
          accumulatedWireTailBlocks = [
            ...accumulatedWireTailBlocks,
            { anchorToolCallId, text: override.wireTailText },
          ];
        }
      } else {
        accumulatedWireTailBlocks = [];
      }
      currentSystemPrompt = override.context.systemPrompt;
      agent.state.systemPrompt = buildSystemPrompt(currentSystemPrompt, toolsSuffix);
      agent.state.messages = override.context.messages.slice();
      agent.state.tools = agentTools;
      emittedBaselineIndex = Math.max(
        0,
        override.context.messages.length - override.emittedMessages.length,
      );
      latestAgentEndMessages = [];
      return {
        systemPrompt: agent.state.systemPrompt,
        messages: agent.state.messages.slice(),
        tools: agentTools,
      };
    }

    const visibleAgentTools: AgentTool[] = llmTools.map((tool) => ({
      ...tool,
      label: tool.name,
      async execute(toolCallId, toolArgs, signal) {
        const toolCall = toSyntheticToolCall({
          id: toolCallId,
          name: tool.name,
          arguments: (toolArgs ?? {}) as Record<string, unknown>,
        });
        toolCallsById.set(toolCall.id, toolCall);

        if (tool.name === "Bash" || tool.name === "Agent") {
          const batchKey = parallelBatchKeyByToolCallId.get(toolCallId);
          if (batchKey) {
            const batch = startParallelToolBatchIfNeeded(batchKey, signal);
            const toolResult = batch?.resultPromises.get(toolCallId);
            if (toolResult) {
              const resolved = await toolResult;
              toolResultErrorFlags.set(toolCallId, Boolean(resolved.isError));
              return {
                content: resolved.content,
                details: resolved.details ?? {},
              };
            }
          }
        }

        return executeSingleToolCall(toolCall, signal);
      },
    }));
    const hiddenProviderNativeWebSearchAgentTools: AgentTool[] = [
      ...hiddenProviderNativeWebSearchToolNames,
    ].map((name) => ({
      name,
      label: name,
      description: "Internal provider-native web search bridge.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          search_query: { type: "string" },
          additionalContext: { type: "string" },
        },
        additionalProperties: true,
      },
      async execute(toolCallId, toolArgs, signal) {
        const toolCall = toSyntheticToolCall({
          id: toolCallId,
          name,
          arguments: (toolArgs ?? {}) as Record<string, unknown>,
        });
        toolCallsById.set(toolCall.id, toolCall);
        return executeSingleToolCall(toolCall, signal);
      },
    }));
    // Registered so pi-agent-core resolves leaked provider-native web_fetch
    // calls instead of erroring with "Tool web_fetch not found"; execution
    // routes into the silent bridge above.
    const hiddenProviderNativeWebFetchAgentTools: AgentTool[] = [
      ...hiddenProviderNativeWebFetchToolNames,
    ].map((name) => ({
      name,
      label: name,
      description: "Internal provider-native web fetch bridge.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
        },
        additionalProperties: true,
      },
      async execute(toolCallId, toolArgs, signal) {
        const toolCall = toSyntheticToolCall({
          id: toolCallId,
          name,
          arguments: (toolArgs ?? {}) as Record<string, unknown>,
        });
        toolCallsById.set(toolCall.id, toolCall);
        return executeSingleToolCall(toolCall, signal);
      },
    }));
    agentTools = [
      ...visibleAgentTools,
      ...hiddenProviderNativeWebSearchAgentTools,
      ...hiddenProviderNativeWebFetchAgentTools,
    ];

    let streamRound = 0;
    const streamFn = (
      streamModel: typeof model,
      streamContext: Context,
      options?: StreamOptionsEx,
    ) => {
      const round = ++streamRound;
      const retryAttemptsForRound: RetryAttemptRecord[] = [];
      let failoverAttemptsForRound = 0;
      params.onRetryAttempts?.(round, retryAttemptsForRound);
      const streamTools =
        streamContext.tools ?? (agent?.state.tools as Context["tools"] | undefined) ?? llmTools;

      const outboundMessages =
        accumulatedWireTailBlocks.length > 0
          ? attachPinnedTailBlocks(streamContext.messages.slice(), accumulatedWireTailBlocks)
          : streamContext.messages.slice();
      const effectiveContext = sanitizeContextForModelRequest({
        ...streamContext,
        // Keep the runtime-only tool rules out of compaction and persistence,
        // then reattach them at the provider boundary on every model round.
        systemPrompt: buildSystemPrompt(currentSystemPrompt, toolsSuffix),
        messages: outboundMessages,
        tools: filterRequestTools(streamTools),
      });
      try {
        params.onRequestStart?.({ round, context: effectiveContext, toolsSuffix });
      } catch (error) {
        // Request observers are diagnostics only and must never break generation.
        console.warn("[agent-runner] request observer threw; request is unaffected", error);
      }

      // pi-agent-core passes the agent-state model; honor it for the primary
      // target so external model swaps keep working through the failover path.
      const primaryRoundTarget: PreparedFailoverTarget =
        streamModel === model ? primaryTarget : { ...primaryTarget, model: streamModel };

      //

      const roundCacheRetention =
        options?.cacheRetention ??
        resolveProviderCacheRetention(
          primaryRoundTarget.providerId,
          primaryRoundTarget.runtime.promptCachingEnabled,
          undefined,
          primaryRoundTarget.runtime.promptCacheRetention,
        );
      const roundSessionId = options?.sessionId ?? params.sessionId;
      const prefixShape = capturePrefixShape({
        systemPrompt: effectiveContext.systemPrompt,
        tools: effectiveContext.tools,
        cacheControl: describeProviderCacheShape({
          providerId: primaryRoundTarget.providerId,
          baseUrl: primaryRoundTarget.runtime.baseUrl,
          promptCacheHintMode:
            primaryRoundTarget.runtime.modelConfig?.promptCacheHintMode ??
            primaryRoundTarget.runtime.promptCacheHintMode,
          modelApi: primaryRoundTarget.model.api,
          sessionId: roundSessionId,
          cacheRetention: roundCacheRetention,

          headers: {
            ...(options?.headers ?? {}),
            ...primaryRoundTarget.proxyRequest.headers,
          },
        }),
      });
      const prefixCacheDiagnostics = comparePrefixShape(
        readPreviousPrefixShape(roundSessionId),
        prefixShape,
      );
      recordPrefixShape(roundSessionId, prefixShape);

      const buildTargetRoundStream = (target: PreparedFailoverTarget) => {
        const targetModel = target.model;
        const fallbackReasoning =
          target.providerId === "claude_code" ||
          target.providerId === "gemini" ||
          target.providerId === "deepseek" ||
          targetModel.api === "openai-responses" ||
          targetModel.api === "openai-completions"
            ? toSimpleStreamReasoning(target.runtime.reasoning)
            : undefined;
        const targetNativeWebSearchStatus =
          target.index === 0
            ? nativeWebSearchStatus
            : resolveProviderNativeWebSearchStatus({
                providerId: target.providerId,
                api: targetModel.api,
                enabled: params.nativeWebSearch,
                baseUrl: target.runtime.baseUrl,
                modelId: target.modelId,
              });
        const shouldProbeHostedSearch = Boolean(targetNativeWebSearchStatus);
        const hostedSearchProbeId = shouldProbeHostedSearch
          ? createHostedSearchProbeId(target.providerId)
          : undefined;
        let streamOptions: StreamOptionsEx = {
          ...(options ?? {}),
          apiKey: options?.apiKey ?? target.runtime.apiKey,
          headers: withHostedSearchProbeHeader(
            {
              ...(options?.headers ?? {}),
              ...target.proxyRequest.headers,
            },
            hostedSearchProbeId,
          ),
          signal: options?.signal,
          sessionId: options?.sessionId ?? params.sessionId,
          cacheRetention:
            options?.cacheRetention ??
            resolveProviderCacheRetention(
              target.providerId,
              target.runtime.promptCachingEnabled,
              undefined,
              target.runtime.promptCacheRetention,
            ),
          metadata: buildProviderRequestMetadata(target.providerId, params.sessionId),
          toolChoice:
            params.resolveToolChoice?.(round) ??
            options?.toolChoice ??
            (effectiveContext.tools?.length ? "auto" : undefined),
          reasoning: normalizeStreamReasoning(options?.reasoning) ?? fallbackReasoning,
          workdir: params.workdir,
          streamRetry: {
            ...resolveStreamRetryConfig(target.runtime.retryPolicy),
            onRetry: (attempt, maxAttempts, errorMessage, plannedDelayMs) => {
              params.onToolStatus?.(
                `第 ${round} 轮：连接已断开，正在重试 (${attempt}/${maxAttempts})...`,
              );
              retryAttemptsForRound.push({
                attempt,
                maxAttempts,
                errorMessage,
                ...(plannedDelayMs === undefined ? {} : { plannedDelayMs }),
                providerLabel: target.label,
              });
              params.onRetryAttempts?.(round, retryAttemptsForRound.slice());
            },
            onRetryRecovered: () => {
              params.onToolStatus?.(`第 ${round} 轮：模型生成中...`);
            },
          },
        };

        streamOptions = finalizeProviderStreamOptions({
          providerId: target.providerId,
          baseUrl: target.runtime.baseUrl,
          options: streamOptions,
          context: effectiveContext,
          model: targetModel,
          workdir: params.workdir,
          nativeWebSearch: params.nativeWebSearch,
          promptCacheHintMode:
            target.runtime.modelConfig?.promptCacheHintMode ?? target.runtime.promptCacheHintMode,
          debugLogger: params.debugLogger,
          extra: {
            round,
            sessionId: params.sessionId,
          },
        });

        try {
          params.onTransportAttempt?.(round, {
            ...captureTransportSnapshot(streamOptions.headers, target.runtime.isFullUrl),
            providerLabel: target.label,
          });
        } catch (error) {
          console.warn("[agent-runner] transport observer threw; request is unaffected", error);
        }

        // A discarded failover attempt for this round may have left a live
        // probe/aggregator behind; finish it quietly and drop its blocks so
        // the winning attempt starts from a clean slate.
        const staleProbe = hostedSearchProbeByRound.get(round);
        if (staleProbe) {
          hostedSearchProbeByRound.delete(round);
          hostedSearchBlocksByRound.delete(round);
          hostedSearchOrderedBlocksByRound.delete(round);
          void staleProbe
            .finishProbe()
            .then(() => staleProbe.disposeAggregator())
            .catch(() => undefined);
        }

        const hostedSearchAggregator = createHostedSearchEventAggregator({
          providerId: target.providerId,
          onHostedSearch: (hostedSearch) => {
            if (hostedSearch.status === "searching") {
              nativeWebSearchStatusController.schedule();
            } else {
              nativeWebSearchStatusController.pause();
            }
            upsertHostedSearchBlockForRound(round, hostedSearch);
            upsertHostedSearchOrderedBlockForRound(round, hostedSearch);
            params.onHostedSearch?.(hostedSearch, round);
          },
        });
        const hostedSearchProbe = startHostedSearchFetchProbe({
          providerId: target.providerId,
          sessionId: params.sessionId,
          requestId: hostedSearchProbeId,
          enabled: shouldProbeHostedSearch,
          onRawEvent: hostedSearchAggregator.accept,
        });
        hostedSearchProbeByRound.set(round, {
          finishProbe: hostedSearchProbe.finish,
          completeAggregator: hostedSearchAggregator.complete,
          failAggregator: hostedSearchAggregator.fail,
          disposeAggregator: hostedSearchAggregator.dispose,
        });

        params.debugLogger?.logRequest(
          buildStreamRequestDebugPayload({
            runtime: target.runtime,
            context: effectiveContext,
            options: streamOptions,
            round,
            prefixCache: prefixCacheDiagnostics,
          }),
        );

        return streamSimpleByApi(targetModel, effectiveContext, streamOptions);
      };

      const wrapWithGuard = (stream: ReturnType<typeof streamSimpleByApi>) =>
        wrapStreamWithToolCallArgumentGuard(stream, (toolCall, reason) => {
          incompleteToolCallArguments.set(toolCall.id, reason);
        });

      if (!failoverParams || failoverParams.fallbacks.length === 0) {
        return wrapWithGuard(buildTargetRoundStream(primaryRoundTarget));
      }

      // Candidate order: sticky active target first, then the rest in
      // primary→queue order. Breaker-open targets are skipped inside
      // withProviderFailover.
      const totalTargets = failoverParams.fallbacks.length + 1;
      const targetOrder = [
        activeFailoverTargetIndex,
        ...Array.from({ length: totalTargets }, (_, i) => i).filter(
          (i) => i !== activeFailoverTargetIndex,
        ),
      ];
      const candidates = targetOrder.map((targetIndex) => {
        const fallback = targetIndex === 0 ? null : failoverParams.fallbacks[targetIndex - 1];
        return {
          key:
            targetIndex === 0
              ? primaryTarget.key
              : failoverBreakerKey(
                  fallback?.selectedModel.customProviderId ?? "",
                  fallback?.selectedModel.model ?? "",
                ),
          label: targetIndex === 0 ? primaryTarget.label : (fallback?.label ?? ""),
          model:
            targetIndex === 0
              ? { api: model.api, provider: model.provider, id: model.id }
              : fallbackTargetIdentity(targetIndex),
          start: async () => {
            const target =
              targetIndex === 0 ? primaryRoundTarget : await prepareFallbackTarget(targetIndex);
            return buildTargetRoundStream(target);
          },
        } satisfies ProviderFailoverCandidate;
      });

      const failoverStream = withProviderFailover(candidates, {
        config: failoverParams.config,
        signal: options?.signal,
        onFailover: ({ fromLabel, toLabel, toIndex, errorMessage }) => {
          lastFailoverErrorMessage = errorMessage;
          failoverAttemptsForRound += 1;
          params.onFailoverAttempt?.(round, {
            attempt: failoverAttemptsForRound,
            fromLabel,
            toLabel,
            targetIndex: targetOrder[toIndex] ?? toIndex,
            errorMessage,
          });
          params.onToolStatus?.(`第 ${round} 轮：${fromLabel} 不可用，正在切换到 ${toLabel}...`);
        },
        onCommitted: (candidateIndex) => {
          const targetIndex = targetOrder[candidateIndex] ?? activeFailoverTargetIndex;
          if (targetIndex === activeFailoverTargetIndex) return;
          activeFailoverTargetIndex = targetIndex;
          failoverParams.onSwitched?.({
            target: targetIndex === 0 ? null : (failoverParams.fallbacks[targetIndex - 1] ?? null),
            round,
            errorMessage: lastFailoverErrorMessage,
          });
        },
      });
      return wrapWithGuard(failoverStream);
    };

    // A truncated call whose repaired arguments also fail schema validation
    // never reaches beforeToolCall (pi-agent-core validates first), so the
    // model would see a schema error blaming its own call. Rewrite such tool
    // results into the truthful transport-error teaching before the next turn.
    const reconcileTruncatedToolResults = () => {
      if (incompleteToolCallArguments.size === 0) return false;
      const messages = getAgentMessages(agent);
      let changed = false;
      const next = messages.map((message) => {
        if (message.role !== "toolResult" || !message.isError) return message;
        const reason = incompleteToolCallArguments.get(message.toolCallId);
        if (!reason) return message;
        incompleteToolCallArguments.delete(message.toolCallId);
        refusedTruncatedToolCallIds.add(message.toolCallId);
        changed = true;
        return {
          ...message,
          content: [
            { type: "text" as const, text: buildTruncatedToolCallText(message.toolName, reason) },
          ],
        };
      });
      if (changed && agent) {
        agent.state.messages = next;
      }
      return changed;
    };

    agent = new Agent({
      initialState: {
        systemPrompt: buildSystemPrompt(currentSystemPrompt, toolsSuffix),
        model,
        thinkingLevel,
        tools: agentTools,
        messages: params.context.messages.slice(),
      },
      sessionId: params.sessionId,
      streamFn,
      toolExecution: "sequential",
      afterToolCall: async ({ assistantMessage, toolCall }) => ({
        isError: toolResultErrorFlags.get(toolCall.id) ?? false,
        // The batch only terminates when *every* call terminates. A terminating
        // call (ExitPlanMode) can arrive batched with ordinary parallel calls,
        // so the predicate must spread across the whole batch: every sibling
        // still executes and keeps its result in history, then the run ends —
        // otherwise one Read next to ExitPlanMode would silently void the
        // "submitting ends this turn" guarantee and run a wrap-up round.
        // maxRounds is the run-level circuit breaker: once the cap is reached
        // the current batch finishes normally, then the run ends gracefully.
        terminate:
          (params.maxRounds !== undefined && currentRound >= params.maxRounds) ||
          (params.resolveToolTermination
            ? getAssistantToolCalls(assistantMessage).some((call) =>
                params.resolveToolTermination?.(call),
              )
            : false) ||
          (await shouldTerminateBridgedProviderNativeToolCall(assistantMessage, toolCall)),
      }),
      beforeToolCall: async ({ assistantMessage, toolCall }) => {
        const effectiveToolCall = normalizeToolCallNameForExecution(toolCall);
        const effectiveAssistantMessage =
          normalizeAssistantToolCallNamesForExecution(assistantMessage);
        toolCallsById.set(effectiveToolCall.id, effectiveToolCall);
        const truncationReason = incompleteToolCallArguments.get(effectiveToolCall.id);
        if (truncationReason) {
          refusedTruncatedToolCallIds.add(effectiveToolCall.id);
          incompleteToolCallArguments.delete(effectiveToolCall.id);
          return {
            block: true,
            reason: buildTruncatedToolCallText(effectiveToolCall.name, truncationReason),
          };
        }
        if (params.resolveToolGate) {
          const gate = await params.resolveToolGate(effectiveToolCall, params.signal);
          if (!gate.allow) {
            return { block: true, reason: gate.reason };
          }
        }
        if (effectiveToolCall.name !== "Agent") {
          return undefined;
        }
        const rawGroup = findConsecutiveToolGroup(
          effectiveAssistantMessage,
          effectiveToolCall.id,
          effectiveToolCall.name,
        );
        if (!rawGroup || rawGroup.length <= 1) return undefined;
        // A member with truncated arguments must not ride into execution on a
        // sibling's batch — it is refused individually by the guard above.
        const group = rawGroup
          .map(normalizeToolCallNameForExecution)
          .filter(
            (call) =>
              !incompleteToolCallArguments.has(call.id) &&
              !refusedTruncatedToolCallIds.has(call.id),
          );
        if (group.length <= 1) return undefined;

        const batchKey = buildParallelToolBatchKey(group);
        if (!parallelToolBatches.has(batchKey)) {
          parallelToolBatches.set(batchKey, {
            toolName: effectiveToolCall.name,
            toolCalls: group,
            started: false,
            announced: false,
            resultPromises: new Map(),
          });
        }
        for (const call of group) {
          parallelBatchKeyByToolCallId.set(call.id, batchKey);
        }
        return undefined;
      },

      prepareNextTurnWithContext: async ({ message, toolResults, context }, signal) => {
        const reconciled = reconcileTruncatedToolResults();

        const stateMessages = getAgentMessages(agent);
        const currentContext: AgentContext =
          agent && stateMessages.length === context.messages.length
            ? { ...context, messages: stateMessages.slice() }
            : reconciled
              ? { ...context, messages: agent ? stateMessages.slice() : context.messages }
              : context;
        const contextChanged = currentContext !== context;
        if (
          !params.onBeforeNextTurn ||
          message.stopReason !== "toolUse" ||
          toolResults.length === 0
        ) {
          return contextChanged ? { context: currentContext } : undefined;
        }

        const runtimeMessages = currentContext.messages as Message[];
        const override = await params.onBeforeNextTurn({
          round: currentRound,
          assistant: message,
          toolResults,
          runtimeContext: {
            systemPrompt: currentSystemPrompt,
            messages: runtimeMessages.slice(),
            tools: llmTools,
          },
          emittedMessages:
            emittedBaselineIndex <= 0
              ? runtimeMessages.slice()
              : runtimeMessages.slice(emittedBaselineIndex),
          signal: signal ?? params.signal,
        });
        if (!override) {
          return contextChanged ? { context: currentContext } : undefined;
        }
        const nextContext = applyTurnContextOverride(override);
        return nextContext ? { context: nextContext } : undefined;
      },
    });

    const textReconciler = createStreamingTextReconciler();

    const unsubscribe = agent.subscribe((event) => {
      switch (event.type) {
        case "turn_start":
          currentRound += 1;
          params.onTurnStart?.(currentRound);
          params.onToolStatus?.(`第 ${currentRound} 轮：模型生成中...`);
          break;
        case "message_update": {
          const streamEvent = event.assistantMessageEvent;
          if (streamEvent.type === "text_delta") {
            nativeWebSearchStatusController.noteVisibleActivity();
            const delta = textReconciler.appendDelta(
              `${currentRound}:${streamEvent.contentIndex}`,
              streamEvent.delta,
            );
            if (delta) {
              appendHostedSearchOrderedTextForRound(currentRound, delta);
              params.onTextDelta(delta, currentRound);
            }
          } else if (streamEvent.type === "text_end") {
            const delta = textReconciler.reconcileFinalText(
              `${currentRound}:${streamEvent.contentIndex}`,
              streamEvent.content,
            );
            nativeWebSearchStatusController.pause();
            if (delta) {
              appendHostedSearchOrderedTextForRound(currentRound, delta);
              params.onTextDelta(delta, currentRound);
            }
          } else if (streamEvent.type === "thinking_delta") {
            nativeWebSearchStatusController.noteVisibleActivity();
            params.onThinkingDelta?.(streamEvent.delta, currentRound);
          } else if (streamEvent.type === "thinking_end") {
            nativeWebSearchStatusController.pause();
          } else if (streamEvent.type === "toolcall_start") {
            nativeWebSearchStatusController.pause();
            const block = streamEvent.partial.content[streamEvent.contentIndex];
            if (block && block.type === "toolCall") {
              const effectiveToolCall = normalizeToolCallNameForExecution(block);
              if (effectiveToolCall !== block) {
                streamEvent.partial.content[streamEvent.contentIndex] = effectiveToolCall;
              }
              toolCallsById.set(effectiveToolCall.id, effectiveToolCall);
              if (!shouldSilenceProviderNativeToolCall(effectiveToolCall)) {
                params.onToolCall?.(effectiveToolCall, currentRound);
              }
            }
          } else if (streamEvent.type === "toolcall_delta") {
            nativeWebSearchStatusController.pause();
            const block = streamEvent.partial.content[streamEvent.contentIndex];
            if (block && block.type === "toolCall") {
              const effectiveToolCall = normalizeToolCallNameForExecution(block);
              if (effectiveToolCall !== block) {
                streamEvent.partial.content[streamEvent.contentIndex] = effectiveToolCall;
              }
              toolCallsById.set(effectiveToolCall.id, effectiveToolCall);
              if (!shouldSilenceProviderNativeToolCall(effectiveToolCall)) {
                params.onToolCallDelta?.(effectiveToolCall, currentRound);
              }
            }
          } else if (streamEvent.type === "toolcall_end") {
            nativeWebSearchStatusController.pause();
            const effectiveToolCall = normalizeToolCallNameForExecution(streamEvent.toolCall);
            toolCallsById.set(effectiveToolCall.id, effectiveToolCall);
            if (!shouldSilenceProviderNativeToolCall(effectiveToolCall)) {
              params.onToolCall?.(effectiveToolCall, currentRound);
            }
          }
          break;
        }
        case "message_end":
          if (event.message.role === "assistant") {
            const hostedSearchFinishMode =
              event.message.stopReason === "aborted"
                ? "dispose"
                : event.message.stopReason === "error"
                  ? "failed"
                  : "completed";
            const hostedSearchBlocks = getHostedSearchBlocksForRound(currentRound);
            const assistantWithCanonicalToolNames = normalizeAssistantToolCallNamesForExecution(
              sanitizeAssistantMessage(event.message as AssistantMessage),
            );
            const assistantWithHostedSearch = applyHostedSearchBlocksToAssistant(
              assistantWithCanonicalToolNames,
              currentRound,
              hostedSearchBlocks,
            );
            const normalizedSeedTurn = recoverAssistantSeedToolCalls(assistantWithHostedSearch);
            let recoveredSeedToolCalls: ToolCall[] = [];
            let assistantWithRecoveredToolCalls =
              normalizedSeedTurn?.assistant ?? assistantWithHostedSearch;
            if (normalizedSeedTurn) {
              const deduped = dedupeRecoveredToolCallsAgainstExisting({
                existingAssistant: assistantWithHostedSearch,
                recoveredToolCalls: normalizedSeedTurn.toolCalls,
                canonicalizeToolName,
              });
              recoveredSeedToolCalls = deduped.uniqueToolCalls;
              if (deduped.duplicateToolCallIds.size > 0) {
                assistantWithRecoveredToolCalls = {
                  ...assistantWithRecoveredToolCalls,
                  content: assistantWithRecoveredToolCalls.content.filter(
                    (block) =>
                      block.type !== "toolCall" || !deduped.duplicateToolCallIds.has(block.id),
                  ),
                };
              }
            }
            const assistantMessage = normalizeAssistantToolCallNamesForExecution(
              assistantWithRecoveredToolCalls,
            );
            if (
              normalizedSeedTurn ||
              assistantMessage !== event.message ||
              assistantWithHostedSearch !== event.message
            ) {
              const stateMessages = getAgentMessages(agent);
              if (stateMessages.length > 0) {
                agent.state.messages = [...stateMessages.slice(0, -1), assistantMessage];
              }
            }
            if (normalizedSeedTurn && recoveredSeedToolCalls.length > 0) {
              pendingRecoveredSeedTurnRef.current = {
                round: currentRound,
                assistant: assistantMessage,
                toolCalls: recoveredSeedToolCalls,
              };
              params.debugLogger?.logResponse({
                type: "seed_tool_call_recovery",
                round: currentRound,
                toolCalls: recoveredSeedToolCalls,
              });
            }
            queueHostedSearchFinalization(currentRound, hostedSearchFinishMode, {
              current: assistantMessage,
            });
            params.debugLogger?.logResult({
              round: currentRound,
              assistant: assistantMessage,
            });
            const toolCallCount = getAssistantToolCalls(assistantMessage).filter(
              (toolCall) => !shouldSilenceProviderNativeToolCall(toolCall),
            ).length;
            if (toolCallCount > 0) {
              nativeWebSearchStatusController.pause();
              params.onToolStatus?.(`第 ${currentRound} 轮：准备执行 ${toolCallCount} 个工具...`);
            }
            params.onAssistantMessage?.(assistantMessage, currentRound);
          } else if (event.message.role === "toolResult") {
            const toolCall =
              toolCallsById.get(event.message.toolCallId) ??
              toSyntheticToolCall({
                id: event.message.toolCallId,
                name: event.message.toolName,
              });
            if (!shouldSilenceProviderNativeToolCall(toolCall)) {
              params.onToolResult?.(toolCall, event.message, currentRound);
            }
          }
          break;
        case "tool_execution_start": {
          nativeWebSearchStatusController.pause();
          const toolCall =
            toolCallsById.get(event.toolCallId) ??
            toSyntheticToolCall({
              id: event.toolCallId,
              name: event.toolName,
              arguments: event.args ?? {},
            });
          toolCallsById.set(toolCall.id, toolCall);
          if (shouldSilenceProviderNativeToolCall(toolCall)) {
            break;
          }
          const parallelBatch = getParallelToolBatch(
            toolCall.id,
            parallelBatchKeyByToolCallId,
            parallelToolBatches,
          );
          if (parallelBatch && parallelBatch.toolCalls.length > 1) {
            params.onToolStatus?.(getParallelToolBatchStatus(parallelBatch));
          } else {
            params.onToolStatus?.(`正在执行：${summarizeToolCall(toolCall)}`);
          }
          params.onToolExecutionStart?.(toolCall, currentRound);
          break;
        }
        case "agent_end":
          latestAgentEndMessages = event.messages as Message[];
          {
            const assistant = findLastAssistantMessage(latestAgentEndMessages);
            const hostedSearchFinishMode =
              assistant?.stopReason === "aborted"
                ? "dispose"
                : assistant?.stopReason === "error"
                  ? "failed"
                  : "completed";
            queueAllHostedSearchFinalizations(hostedSearchFinishMode);
          }
          nativeWebSearchStatusController.finish();
          params.onToolStatus?.(null);
          break;
      }
    });

    let abortListener: (() => void) | undefined;
    if (params.signal) {
      const onAbort = () => agent.abort();
      params.signal.addEventListener("abort", onAbort, { once: true });
      abortListener = () => params.signal?.removeEventListener("abort", onAbort);
    }

    try {
      let recoveredSeedTurnCount = 0;
      while (true) {
        throwIfRunnerCancelled(params.signal);
        await agent.continue();
        throwIfRunnerCancelled(params.signal);

        const recoveredSeedTurn = pendingRecoveredSeedTurnRef.current;
        pendingRecoveredSeedTurnRef.current = null;
        if (recoveredSeedTurn === null) {
          break;
        }
        const recoveredSeedRound = recoveredSeedTurn.round;
        const recoveredSeedAssistant = recoveredSeedTurn.assistant;
        const recoveredSeedToolCalls = recoveredSeedTurn.toolCalls;

        recoveredSeedTurnCount += 1;
        if (recoveredSeedTurnCount > 8) {
          throw new Error("Too many seed tool-call recovery attempts");
        }

        const visibleRecoveredSeedToolCalls = recoveredSeedToolCalls.filter(
          (toolCall) => !shouldSilenceProviderNativeToolCall(toolCall),
        );
        if (visibleRecoveredSeedToolCalls.length > 0) {
          params.onToolStatus?.(
            `第 ${recoveredSeedRound} 轮：恢复执行 ${visibleRecoveredSeedToolCalls.length} 个工具...`,
          );
        }

        const syntheticToolResults: ToolResultMessage[] = [];
        for (const toolCall of recoveredSeedToolCalls) {
          throwIfRunnerCancelled(params.signal);
          toolCallsById.set(toolCall.id, toolCall);
          const shouldSilenceToolCall = shouldSilenceProviderNativeToolCall(toolCall);
          if (!shouldSilenceToolCall) {
            params.onToolCall?.(toolCall, recoveredSeedRound);
            params.onToolStatus?.(`正在执行：${summarizeToolCall(toolCall)}`);
            params.onToolExecutionStart?.(toolCall, recoveredSeedRound);
          }

          const result = await executeSingleToolCall(toolCall, params.signal);
          throwIfRunnerCancelled(params.signal);
          const toolResult = {
            role: "toolResult",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: result.content,
            details: result.details,
            isError: toolResultErrorFlags.get(toolCall.id) ?? false,
            timestamp: Date.now(),
          } satisfies ToolResultMessage;

          syntheticToolResults.push(toolResult);
          if (!shouldSilenceToolCall) {
            params.onToolResult?.(toolCall, toolResult, recoveredSeedRound);
          }
        }

        if (syntheticToolResults.length > 0) {
          agent.state.messages = [...getAgentMessages(agent), ...syntheticToolResults];
        }

        if (params.onBeforeNextTurn) {
          throwIfRunnerCancelled(params.signal);
          const override = await params.onBeforeNextTurn({
            round: recoveredSeedRound,
            assistant: recoveredSeedAssistant,
            toolResults: syntheticToolResults,
            runtimeContext: {
              systemPrompt: currentSystemPrompt,
              messages: getAgentMessages(agent).slice(),
              tools: llmTools,
            },
            emittedMessages: getMessagesSinceBaseline(agent, emittedBaselineIndex),
            signal: params.signal,
          });
          throwIfRunnerCancelled(params.signal);
          if (override) {
            applyTurnContextOverride(override);
          }
        }
      }

      throwIfRunnerCancelled(params.signal);
      await waitForHostedSearchFinalizations();
      throwIfRunnerCancelled(params.signal);

      const messages = getAgentMessages(agent).slice();
      const assistant =
        findLastAssistantMessage(messages) ?? findLastAssistantMessage(latestAgentEndMessages);

      if (!assistant) {
        throw new Error("Model did not return an assistant message");
      }

      if (assistant.stopReason === "error") {
        throw new Error(normalizeErrorMessage(assistant.errorMessage, "Request failed"));
      }
      if (assistant.stopReason === "aborted") {
        throw new Error(normalizeErrorMessage(assistant.errorMessage, "Cancelled"));
      }

      await params.debugLogger?.flush();
      return {
        messages,
        assistant,
        emittedMessages: getMessagesSinceBaseline(agent, emittedBaselineIndex),
      };
    } catch (error) {
      queueAllHostedSearchFinalizations(params.signal?.aborted ? "dispose" : "failed");
      await waitForHostedSearchFinalizations();
      nativeWebSearchStatusController.finish();
      params.onToolStatus?.(null);
      params.debugLogger?.logError(error);
      await params.debugLogger?.flush();
      throw error;
    } finally {
      queueAllHostedSearchFinalizations("dispose");
      await waitForHostedSearchFinalizations();
      nativeWebSearchStatusController.finish();
      abortListener?.();
      unsubscribe();
    }
  });
}
