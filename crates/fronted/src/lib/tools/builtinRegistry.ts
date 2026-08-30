import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { homeDir } from "@xagent/runtime";
import type { RuntimePlatform } from "../runtimePlatform";
import {
  type AccessSettings,
  type McpSettings,
  type McpSettingsOp,
  type ProviderId,
  type SshHostConfig,
  selectEnabledMcpServers,
} from "../settings";
import {
  createSendMessageTools,
  createSubagentTools,
  SUBAGENT_PARENT_ID,
  type SubagentRuntimeConfig,
} from "../subagents";
import type { AdditionalProjectRoot } from "./additionalProjectRoots";
import { createAskUserQuestionTools } from "./askUserQuestionTools";
import { createBrowserUseTools } from "./browserUseTools";
import type {
  BuiltinToolBundle,
  BuiltinToolExecutionContext,
  BuiltinToolMetadata,
} from "./builtinTypes";
import { createCloudTaskTools } from "./cloudTaskTools";
import { createCronTools } from "./cronTools";
import { createCustomSystemTools } from "./customSystemTools";
import { createFileToolState, type FileToolState } from "./fileToolState";
import { createFsTools } from "./fsTools";
import { createMcpManagerTools } from "./mcpManagerTools";
import { createMcpTools } from "./mcpTools";
import { createMemoryTools } from "./memoryTools";
import { createMobilePersonalAssistantTools } from "./mobilePersonalAssistantTools";
import { createExitPlanModeTools, isPlanModeAllowedTool } from "./planModeTools";
import { resolveRuntimeToolCapabilities, resolveRuntimeToolHost } from "./runtimeToolCapabilities";
import { createShellTools, type ShellSandboxSettings } from "./shellTools";
import type { SkillAccessPolicy } from "./skillAccessPolicy";
import { createSkillTools } from "./skillTools";
import { createSSHManagerTools, type SshManagerSessionChange } from "./sshManagerTools";
import type { SystemToolId, SystemToolRuntimeScope } from "./systemToolOptions";
import { createTaskTools, type TaskStateStore } from "./taskTools";
import { createTerminalTools } from "./terminalTools";
import { createTodoTools, type TodoToolState } from "./todoTools";
import { createToolSearchTools, shouldDeferMcpTools } from "./toolSearchTools";

export type BuiltinToolRegistry = {
  tools: BuiltinToolBundle["tools"];
  executeToolCall: (
    toolCall: ToolCall,
    signal?: AbortSignal,
    context?: BuiltinToolExecutionContext,
  ) => Promise<ToolResultMessage>;
  metadataByName: Map<string, BuiltinToolMetadata>;
  hasTool: (toolName: string) => boolean;
  /** MCP 懒加载已启用:调用方应给 runner 挂 requestToolFilter(未激活的 MCP
   * 工具不进模型请求)。工具仍全量在 tools 里——执行层必须找得到它们。 */
  mcpToolDeferralActive?: boolean;
};

// 第三方来源(MCP server / 插件)的工具名不受我们控制,可能撞车。撞车时不能像
// 内置工具那样 throw 打断整轮——那等于让一个坏插件废掉整个对话。改为:先到先
// 得、跳过后来者并告警;仅当两侧都是可信内置组时才 throw(那是编译期的开发 bug)。
const UNTRUSTED_TOOL_GROUPS: ReadonlySet<BuiltinToolBundle["groupId"]> = new Set(["mcp"]);
// 不再给内置工具声明 JSON-schema 约束采样(strict)。曾经声明过 "prefer"
// (pi 0.84.2 升级时引入),但部分 OpenAI 兼容 provider(如 Moonshot/Kimi)在
// strict 模式下按白名单校验 schema 关键字,内置工具常用的 minimum / maxItems
// 等一律 400,一个工具的 schema 就打死整轮请求;而 pi-ai 的本地预检
// (makeStrictJsonSchema)只拦结构性问题,拦不住这类关键字白名单差异,
// "prefer" 的降级判定在这里完全失效。v1.2.4 及之前不声明 strict,各家都能用
// ——回到那个行为。约束采样能消灭的"参数名写错、必填漏传"坏调用,由工具
// 实现自身的参数校验兜底。

function createBuiltinToolRegistry(bundles: BuiltinToolBundle[]): BuiltinToolRegistry {
  const tools: BuiltinToolBundle["tools"] = [];
  const metadataByName = new Map<string, BuiltinToolMetadata>();
  const executorsByName = new Map<string, BuiltinToolBundle["executeToolCall"]>();
  const groupIdByToolName = new Map<string, BuiltinToolBundle["groupId"]>();
  const canonicalToolNameByLookupKey = new Map<string, string | null>();

  const registerCanonicalToolName = (toolName: string) => {
    const key = toolName.trim().toLowerCase();
    if (!key) return;
    const existing = canonicalToolNameByLookupKey.get(key);
    if (existing === undefined) {
      canonicalToolNameByLookupKey.set(key, toolName);
    } else if (existing !== toolName) {
      canonicalToolNameByLookupKey.set(key, null);
    }
  };

  const resolveToolName = (toolName: string) => {
    if (executorsByName.has(toolName)) return toolName;
    const canonical = canonicalToolNameByLookupKey.get(toolName.trim().toLowerCase());
    return canonical && executorsByName.has(canonical) ? canonical : null;
  };

  for (const bundle of bundles) {
    for (const tool of bundle.tools) {
      if (executorsByName.has(tool.name)) {
        const existingGroup = groupIdByToolName.get(tool.name);
        const bothTrusted =
          !UNTRUSTED_TOOL_GROUPS.has(bundle.groupId) &&
          existingGroup !== undefined &&
          !UNTRUSTED_TOOL_GROUPS.has(existingGroup);
        if (bothTrusted) {
          // 两个内置工具同名:编译期就该修的开发 bug,继续保持强失败。
          throw new Error(`Duplicate builtin tool name detected: ${tool.name}`);
        }
        // 涉及 MCP/插件的撞车:先到先得,跳过后来者,绝不打断整轮。
        console.warn(
          `[tools] Tool name "${tool.name}" from group "${bundle.groupId}" collides with an ` +
            `already-registered tool (group "${existingGroup ?? "unknown"}"); skipping the newcomer.`,
        );
        continue;
      }
      tools.push(tool);
      executorsByName.set(tool.name, bundle.executeToolCall);
      groupIdByToolName.set(tool.name, bundle.groupId);
      registerCanonicalToolName(tool.name);
      const metadata = bundle.metadataByName.get(tool.name);
      if (metadata) {
        metadataByName.set(tool.name, metadata);
      }
    }
  }

  return {
    tools,
    metadataByName,
    hasTool: (toolName) => resolveToolName(toolName) !== null,
    async executeToolCall(toolCall, signal, context) {
      const resolvedToolName = resolveToolName(toolCall.name);
      if (!resolvedToolName) {
        return {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: `Unknown tool: ${toolCall.name}` }],
          details: {},
          isError: true,
          timestamp: Date.now(),
        };
      }
      const execute = executorsByName.get(resolvedToolName);
      if (!execute) {
        return {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: `Unknown tool: ${toolCall.name}` }],
          details: {},
          isError: true,
          timestamp: Date.now(),
        };
      }
      const effectiveToolCall =
        resolvedToolName === toolCall.name ? toolCall : { ...toolCall, name: resolvedToolName };
      return execute(effectiveToolCall, signal, context);
    },
  };
}

type BuildBuiltinBaseToolRegistryParams = {
  workdir: string;
  additionalRoots?: readonly AdditionalProjectRoot[];
  providerId: ProviderId;
  runtimePlatform?: RuntimePlatform;
  nativeMobileRuntime?: boolean;
  lanPcCommandHostReady?: boolean;
  fileState: FileToolState;
  sandbox?: ShellSandboxSettings;
  checkpoint?: { conversationId: string; turnId: string };
  skillsEnabled: boolean;
  skillsRootDir?: string;
  skillAccessPolicy?: SkillAccessPolicy;
  onManagedSkillsChanged?: (change: {
    action: "install" | "create" | "delete";
    names: string[];
    baseDirs: string[];
  }) => void | Promise<void>;
  runtimeScope: SystemToolRuntimeScope;
  currentChatModel?: {
    customProviderId: string;
    model: string;
  };
  selectedSystemToolIds: SystemToolId[];
  cloudExecution?: AccessSettings;
  /** Live read of the authoritative MCP settings (never a turn-level snapshot). */
  getMcpSettings: () => McpSettings;
  /** Id-keyed merge commit into the authoritative settings; absent in read-only scopes. */
  applyMcpOps?: (ops: McpSettingsOp[]) => void;
  onMcpLoadError?: (message: string) => void;
  mcpLoadFailureMode?: "continue" | "throw";
  memoryToolMode?: "rw" | "ro";
  projectPathKey?: string;
  sshHosts?: SshHostConfig[];
  associatedSshHostIds?: string[];
  sshManagerRemoteAllowed?: boolean;
  onSshSessionsChanged?: (change: SshManagerSessionChange) => void | Promise<void>;
};

const resolveHomeDir = () => homeDir();

async function buildBaseBuiltinToolBundles(params: BuildBuiltinBaseToolRegistryParams) {
  const runtimeToolHost = resolveRuntimeToolHost(
    params.nativeMobileRuntime === true,
    params.lanPcCommandHostReady === true,
  );
  const capabilities = resolveRuntimeToolCapabilities(runtimeToolHost);
  const baseBundles: BuiltinToolBundle[] = [
    createFsTools({
      workdir: params.workdir,
      additionalRoots: params.additionalRoots,
      checkpoint: params.checkpoint,
      fileState: params.fileState,
      skillsRootEnabled: params.skillsEnabled,
      skillsRootDir: params.skillsRootDir,
      skillAccessPolicy: params.skillAccessPolicy,
      resolveHomeDir,
    }),
    createShellTools({
      workdir: params.workdir,
      providerId: params.providerId,
      runtimePlatform: params.runtimePlatform,
      skillsRootEnabled: params.skillsEnabled,
      skillsRootDir: params.skillsRootDir,
      skillAccessPolicy: params.skillAccessPolicy,
      managedProcessEnabled: capabilities.managedProcess && params.runtimeScope === "chat",
      sandbox: params.sandbox,
      resolveHomeDir,
    }),
    ...(params.skillsEnabled
      ? [
          createSkillTools({
            workdir: params.workdir,
            skillAccessPolicy: params.skillAccessPolicy,
            onManagedSkillsChanged: params.onManagedSkillsChanged,
          }),
        ]
      : []),
    ...(capabilities.cron
      ? [
          createCronTools({
            currentChatModel: params.currentChatModel,
            workdir: params.workdir,
          }),
        ]
      : []),
    ...(capabilities.mcp
      ? [
          createMcpManagerTools({
            workdir: params.workdir,
            getMcpSettings: params.getMcpSettings,
            applyMcpOps: params.applyMcpOps,
            runtimeScope: params.runtimeScope,
            sandbox: params.sandbox,
            resolveHomeDir,
            localStdioSupported: capabilities.localMcpStdio,
          }),
        ]
      : []),
    ...(capabilities.customSystemTools
      ? [
          createCustomSystemTools({
            selectedToolIds: params.selectedSystemToolIds,
            runtimeScope: params.runtimeScope,
            currentChatModel: params.currentChatModel,
          }),
        ]
      : []),
    createMemoryTools({
      workdir: params.workdir,
      mode: params.memoryToolMode ?? "rw",
    }),
    ...(runtimeToolHost === "native-mobile" ? [createMobilePersonalAssistantTools()] : []),
    createBrowserUseTools({
      delegateToLanPc: {
        enabled:
          params.nativeMobileRuntime === true &&
          params.cloudExecution?.preferLanPcExecution === true,
        baseUrl: params.cloudExecution?.lanControlUrl ?? "",
      },
    }),
    ...(params.cloudExecution?.cloudExecutionEnabled
      ? [createCloudTaskTools(params.cloudExecution, params.workdir)]
      : []),
    ...(capabilities.ssh
      ? [
          createSSHManagerTools({
            enabled:
              params.runtimeScope === "chat" &&
              params.sshManagerRemoteAllowed !== false &&
              (params.associatedSshHostIds?.length ?? 0) > 0,
            runtimeScope: params.runtimeScope,
            workdir: params.workdir,
            projectPathKey: params.projectPathKey,
            hosts: params.sshHosts,
            associatedHostIds: params.associatedSshHostIds,
            mobileCommandMode: runtimeToolHost === "native-mobile",
            resolveHomeDir,
            onSshSessionsChanged: params.onSshSessionsChanged,
          }),
        ]
      : []),
    ...(capabilities.terminal && params.runtimeScope === "chat"
      ? [
          createTerminalTools({
            workdir: params.workdir,
          }),
        ]
      : []),
  ];

  const enabledServers = capabilities.mcp
    ? selectEnabledMcpServers(params.getMcpSettings()).filter(
        (server) => capabilities.localMcpStdio || server.transport !== "stdio",
      )
    : [];
  if (enabledServers.length > 0) {
    baseBundles.push(
      await createMcpTools({
        servers: enabledServers,
        onLoadError: params.onMcpLoadError,
        loadFailureMode: params.mcpLoadFailureMode,
      }),
    );
  }

  return baseBundles;
}

export async function buildBuiltinToolRegistry(
  params: BuildBuiltinBaseToolRegistryParams & {
    subagentRuntime?: SubagentRuntimeConfig;
    todoState?: TodoToolState;
    taskStateStore?: TaskStateStore;
    askUserQuestionConversationId?: string;
    planMode?: { conversationId: string };
    toolSearch?: { conversationId: string };
  },
) {
  const runtimeToolHost = resolveRuntimeToolHost(
    params.nativeMobileRuntime === true,
    params.lanPcCommandHostReady === true,
  );
  const capabilities = resolveRuntimeToolCapabilities(runtimeToolHost);
  const baseBundles = await buildBaseBuiltinToolBundles(params);
  const mcpBusinessBundle = baseBundles.find((bundle) =>
    bundle.tools.some((tool) => bundle.metadataByName.get(tool.name)?.kind === "mcp"),
  );
  const planModeActive = params.planMode !== undefined;
  const mcpToolDeferralActive = Boolean(
    params.toolSearch &&
      params.runtimeScope === "chat" &&
      !planModeActive &&
      mcpBusinessBundle &&
      shouldDeferMcpTools(mcpBusinessBundle.tools),
  );
  const todoBundles =
    params.runtimeScope === "chat" && params.todoState
      ? [createTodoTools({ state: params.todoState })]
      : [];
  const askUserQuestionBundles =
    params.runtimeScope === "chat" && params.askUserQuestionConversationId
      ? [createAskUserQuestionTools({ conversationId: params.askUserQuestionConversationId })]
      : [];
  const taskBundles =
    params.runtimeScope === "chat" && params.taskStateStore
      ? [createTaskTools(params.taskStateStore)]
      : [];
  const planModeBundles =
    params.runtimeScope === "chat" && params.planMode
      ? [createExitPlanModeTools({ conversationId: params.planMode.conversationId })]
      : [];
  const toolSearchBundles =
    mcpToolDeferralActive && params.toolSearch && mcpBusinessBundle
      ? [
          createToolSearchTools({
            conversationId: params.toolSearch.conversationId,
            entries: mcpBusinessBundle.tools.map((tool) => ({
              tool,
              serverLabel: mcpBusinessBundle.metadataByName.get(tool.name)?.serverId ?? "MCP",
            })),
          }),
        ]
      : [];
  const chatBundles = [
    ...todoBundles,
    ...taskBundles,
    ...askUserQuestionBundles,
    ...planModeBundles,
    ...toolSearchBundles,
  ];

  const finalizeRegistry = (registry: BuiltinToolRegistry): BuiltinToolRegistry => {
    const withFlags = { ...registry, mcpToolDeferralActive };
    if (!planModeActive) return withFlags;
    return {
      ...withFlags,
      tools: withFlags.tools.filter((tool) =>
        isPlanModeAllowedTool(tool.name, withFlags.metadataByName.get(tool.name)),
      ),
    };
  };

  const subagentRuntime = capabilities.subagents ? params.subagentRuntime : undefined;
  if (!subagentRuntime) {
    return finalizeRegistry(createBuiltinToolRegistry([...baseBundles, ...chatBundles]));
  }

  const baseRegistry = createBuiltinToolRegistry(baseBundles);
  // The Agent tool description embeds the roster, so the store must be
  // hydrated before the bundle is created. Roster load failures degrade to an
  // empty roster instead of blocking the whole registry.
  try {
    await subagentRuntime.store.ready();
  } catch (error) {
    console.warn("Failed to load subagent roster for the Agent tool", error);
  }
  const parentMessageBundle = subagentRuntime.store.conversationId
    ? createSendMessageTools({
        store: subagentRuntime.store,
        senderId: SUBAGENT_PARENT_ID,
        senderName: "Parent Agent",
      })
    : null;
  const parentBundles = parentMessageBundle ? [...baseBundles, parentMessageBundle] : baseBundles;
  return finalizeRegistry(
    createBuiltinToolRegistry([
      ...parentBundles,
      ...chatBundles,
      createSubagentTools({
        providerId: subagentRuntime.providerId,
        model: subagentRuntime.model,
        runtime: subagentRuntime.runtime,
        runtimePlatform: params.runtimePlatform,
        workdir: params.workdir,
        resolveHomeDir,
        sessionId: subagentRuntime.sessionId,
        templates: subagentRuntime.templates,
        store: subagentRuntime.store,
        scheduler: subagentRuntime.scheduler,
        forceReadonly: planModeActive,
        baseTools: baseRegistry.tools,
        executeToolCall: baseRegistry.executeToolCall,
        metadataByName: baseRegistry.metadataByName,
        createSubagentToolRegistry: async (workdir) =>
          createBuiltinToolRegistry(
            await buildBaseBuiltinToolBundles({
              ...params,
              workdir,
              checkpoint: undefined,
              fileState: createFileToolState(),
              skillsEnabled: false,
              applyMcpOps: undefined,
              selectedSystemToolIds: [],
              mcpLoadFailureMode: "continue",
              memoryToolMode: "ro",
            }),
          ),
      }),
    ]),
  );
}
