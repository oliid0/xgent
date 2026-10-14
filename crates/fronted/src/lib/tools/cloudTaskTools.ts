import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { invoke } from "@xgent/runtime";
import { Type } from "typebox";

import type { AccessSettings } from "../settings";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";
import type { WorkspaceFileSource } from "./workspaceFileSource";

type CloudTaskAction =
  | "start"
  | "status"
  | "wait"
  | "failure_log"
  | "download_artifact"
  | "extract_artifact";

type CloudTaskStartResult = {
  taskId: string;
  owner: string;
  repository: string;
  runner: string;
  repositoryUrl: string;
  repositoryVisibility?: "private" | "public";
};

type CloudTaskStatus = {
  taskId: string;
  state: string;
  conclusion?: string | null;
  runId?: number | null;
  runUrl?: string | null;
  updatedAt?: string | null;
};

type CloudTaskArtifact = {
  taskId: string;
  artifactId: number;
  artifactName: string;
  localPath: string;
  sizeBytes: number;
  runId?: number;
  runConclusion?: string;
};

type CloudTaskExtracted = CloudTaskArtifact & {
  outputDirectory: string;
  fileSource: WorkspaceFileSource;
  files: Array<{ path: string; bytes: number; contentHash: string }>;
};

type CloudTaskFailureReport = {
  taskId: string;
  runId: number;
  runUrl: string;
  conclusion?: string | null;
  logTail: string;
};

type CloudTaskArguments = {
  action?: CloudTaskAction;
  task_id?: string;
  owner?: string;
  repository?: string;
  runner?: "ubuntu-latest" | "windows-latest" | "macos-latest";
  label?: string;
  script?: string;
  agent?: {
    prompt: string;
    provider: "openai" | "anthropic";
    model: string;
    maxTurns?: number;
    maxToolCalls?: number;
    maxOutputTokens?: number;
    timeoutSeconds?: number;
  };
  files?: Array<{
    path?: string;
    content?: string;
    encoding?: "utf8" | "base64";
  }>;
  max_wait_seconds?: number;
  include_partial?: boolean;
};

const CLOUD_TASK_PARAMETERS = Type.Object({
  action: Type.Union([
    Type.Literal("start"),
    Type.Literal("status"),
    Type.Literal("wait"),
    Type.Literal("failure_log"),
    Type.Literal("download_artifact"),
    Type.Literal("extract_artifact"),
  ]),
  task_id: Type.Optional(Type.String({ description: "Task id returned by action=start." })),
  owner: Type.Optional(
    Type.String({
      description: "For reading an existing task only: owner from its start receipt.",
    }),
  ),
  repository: Type.Optional(
    Type.String({
      description:
        "For reading an existing task only: repository from its start receipt, especially after Settings change.",
    }),
  ),
  runner: Type.Optional(
    Type.Union([
      Type.Literal("ubuntu-latest"),
      Type.Literal("windows-latest"),
      Type.Literal("macos-latest"),
    ]),
  ),
  label: Type.Optional(Type.String({ description: "Short user-facing task purpose." })),
  script: Type.Optional(
    Type.String({
      description:
        "Bash for ubuntu/macos or PowerShell for windows. Write every deliverable into ../output.",
    }),
  ),
  agent: Type.Optional(
    Type.Object(
      {
        prompt: Type.String({
          description:
            "Public autonomous task prompt. Provide criteria and real input file paths; credentials must never be included.",
        }),
        provider: Type.Union([Type.Literal("openai"), Type.Literal("anthropic")]),
        model: Type.String({
          description:
            "Exact model ID in Pi 0.85.1 provider catalog. Actions XGENT_AGENT_PROVIDER must match; API key comes from XGENT_AGENT_API_KEY in repository secret environment.",
        }),
        maxTurns: Type.Optional(Type.Integer({ minimum: 1, maximum: 128 })),
        maxToolCalls: Type.Optional(Type.Integer({ minimum: 1, maximum: 256 })),
        maxOutputTokens: Type.Optional(Type.Integer({ minimum: 128, maximum: 16384 })),
        timeoutSeconds: Type.Optional(Type.Integer({ minimum: 30, maximum: 3600 })),
      },
      { additionalProperties: false },
    ),
  ),
  files: Type.Optional(
    Type.Array(
      Type.Object({
        path: Type.String({ description: "Relative path inside the isolated task workspace." }),
        content: Type.String(),
        encoding: Type.Optional(Type.Union([Type.Literal("utf8"), Type.Literal("base64")])),
      }),
      { maxItems: 100 },
    ),
  ),
  max_wait_seconds: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 55,
      description: "Long-poll duration for action=wait.",
    }),
  ),
  include_partial: Type.Optional(
    Type.Boolean({
      description:
        "For download/extract only: explicitly allow outputs of a completed failed/cancelled/timed-out job. Partial files do not verify task completion.",
    }),
  ),
});

function asObject(value: unknown): CloudTaskArguments {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as CloudTaskArguments;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`CloudTaskManager ${label} is required.`);
  }
  return value.trim();
}

function requiredRunner(value: unknown): NonNullable<CloudTaskArguments["runner"]> {
  const runner = requiredString(value, "runner");
  if (runner !== "ubuntu-latest" && runner !== "windows-latest" && runner !== "macos-latest") {
    throw new Error("CloudTaskManager runner is invalid.");
  }
  return runner;
}

function cloudAgent(value: CloudTaskArguments["agent"]) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("CloudTaskManager agent is invalid.");
  const allowed = [
    "prompt",
    "provider",
    "model",
    "maxTurns",
    "maxToolCalls",
    "maxOutputTokens",
    "timeoutSeconds",
  ];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(
      "Cloud agent credentials and unknown fields are not accepted; use Actions secret environment.",
    );
  const prompt = requiredString(value.prompt, "agent.prompt"),
    model = requiredString(value.model, "agent.model");
  if (
    new TextEncoder().encode(prompt).length > 128 * 1024 ||
    model.length > 256 ||
    !["openai", "anthropic"].includes(value.provider)
  )
    throw new Error("Cloud agent prompt/provider/model is invalid.");
  for (const [key, minimum, maximum] of [
    ["maxTurns", 1, 128],
    ["maxToolCalls", 1, 256],
    ["maxOutputTokens", 128, 16384],
    ["timeoutSeconds", 30, 3600],
  ] as const) {
    const limit = value[key];
    if (limit !== undefined && (!Number.isInteger(limit) || limit < minimum || limit > maximum))
      throw new Error(`Cloud agent ${key} is invalid.`);
  }
  return { ...value, prompt, model };
}

function locator(settings: AccessSettings, taskId: string, args: CloudTaskArguments) {
  return {
    owner:
      args.owner === undefined ? settings.githubOwner.trim() : requiredString(args.owner, "owner"),
    repository:
      args.repository === undefined
        ? settings.githubRepository.trim() || "agent-temp"
        : requiredString(args.repository, "repository"),
    taskId,
  };
}

function resultText(action: CloudTaskAction, result: unknown) {
  if (action === "start") {
    const task = result as CloudTaskStartResult;
    return [
      `Cloud task started: ${task.taskId}`,
      `runner: ${task.runner}`,
      `repository: ${task.owner}/${task.repository}`,
      `repository URL: ${task.repositoryUrl}`,
      ...(task.repositoryVisibility ? [`repository visibility: ${task.repositoryVisibility}`] : []),
      "Use this task_id, owner and repository for action=wait, then action=extract_artifact to import and inspect actual deliverables without a local shell (or download_artifact for only a ZIP). Job success alone does not verify them.",
    ].join("\n");
  }
  if (action === "extract_artifact") {
    const extracted = result as CloudTaskExtracted;
    return [
      `Cloud artifact extracted into: ${extracted.outputDirectory}`,
      `Original execution device: ${extracted.fileSource.hostId}; workspace: ${extracted.fileSource.workdir}`,
      `Observed job conclusion: ${extracted.runConclusion ?? "unknown"}. File extraction does not verify task criteria.`,
      "Actual extracted files (path relative to the source workspace, bytes, SHA-256):",
      ...extracted.files.map((file) => `${file.path}\t${file.bytes}\t${file.contentHash}`),
      "Read .xgent-agent/result.json for agent final/partial state and inspect requested deliverables before publishing outcome evidence.",
    ].join("\n");
  }
  if (action === "download_artifact") {
    const artifact = result as CloudTaskArtifact;
    return [
      `Cloud task artifact downloaded: ${artifact.artifactName}`,
      `local path: ${artifact.localPath}`,
      `size: ${artifact.sizeBytes} bytes`,
      ...(artifact.runConclusion
        ? [
            `observed job conclusion: ${artifact.runConclusion}; downloaded bytes are not task completion evidence`,
          ]
        : []),
      "Use extract_artifact to import actual files without requiring a local shell, then inspect them.",
    ].join("\n");
  }
  if (action === "failure_log") {
    const report = result as CloudTaskFailureReport;
    return [
      `Cloud task failed: ${report.taskId}`,
      report.conclusion ? `conclusion: ${report.conclusion}` : "",
      report.runUrl ? `run URL: ${report.runUrl}` : "",
      "Failure log tail:",
      report.logTail,
    ]
      .filter(Boolean)
      .join("\n");
  }
  const status = result as CloudTaskStatus;
  return [
    `Cloud task ${status.taskId}: ${status.state}`,
    status.conclusion ? `conclusion: ${status.conclusion}` : "",
    status.runUrl ? `run URL: ${status.runUrl}` : "",
    status.updatedAt ? `updated: ${status.updatedAt}` : "",
    status.state === "completed" && status.conclusion && status.conclusion !== "success"
      ? "Call action=failure_log for the diagnostic tail, then create a new corrected task."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function createCloudTaskTools(
  settings: AccessSettings,
  workdir: string,
  startBackground?: (callId: string) => Promise<ToolResultMessage>,
): BuiltinToolBundle {
  const tool: Tool = {
    name: "CloudTaskManager",
    description:
      "Run a complex build or media/document task in a public GitHub Actions workspace. Use it when the local environment is unavailable or unsuitable, for example IPA/APK/EXE builds, PDF/PPT generation, or video processing. For start choose exactly one: script, or agent for a real bounded model/tool loop that continues on the runner after the sender goes offline. Agent reads/writes task files and runs commands, but cannot operate the sender's mobile connectors; split those into original-device branches. Actions XGENT_AGENT_PROVIDER must match agent.provider and XGENT_AGENT_API_KEY must be configured in the repository secret environment; local chat credentials are never uploaded. Each task is isolated under tasks/<task-id>. An unused configured repository name creates a public workspace; existing repositories must be public and Xgent-managed to start new tasks. Prompts, inputs and scripts are public and remain in repository history; artifacts follow the configured retention. Repository Actions Variables/Secrets provide task environment values; never commit credentials. Put every output in ../output, wait for completion, then use extract_artifact to import actual files without a local shell (download_artifact returns only a ZIP). Import uses the captured task workspace, or the native artifact cache when no workspace is configured; background publication requires the pinned workspace. Inspect .xgent-agent/result.json and actual files using the returned source workspace. Both import/download require a completed run; explicitly set include_partial=true to recover failed-run outputs, which remain partial and do not prove task success. Agent turn/tool/time limits are task-local, not the parent task's shared budget. For background execution, record a wait bound to this successful start tool call instead of replaying it. On failure, inspect action=failure_log before deciding whether to create a corrected task within the original authority and budgets.",
    parameters: CLOUD_TASK_PARAMETERS,
  };

  async function executeToolCall(
    toolCall: ToolCall,
    signal?: AbortSignal,
  ): Promise<ToolResultMessage> {
    const now = Date.now();
    try {
      if (signal?.aborted) throw new Error("Cancelled");
      if (toolCall.name !== "CloudTaskManager") {
        throw new Error(`Unknown tool: ${toolCall.name}`);
      }
      const args = asObject(toolCall.arguments);
      const action = args.action;
      if (!action) throw new Error("CloudTaskManager action is required.");
      if (
        ![
          "start",
          "status",
          "wait",
          "failure_log",
          "download_artifact",
          "extract_artifact",
        ].includes(action)
      ) {
        throw new Error("CloudTaskManager action is invalid.");
      }
      if (args.include_partial !== undefined && typeof args.include_partial !== "boolean")
        throw new Error("include_partial must be a boolean.");
      if (
        args.include_partial !== undefined &&
        action !== "download_artifact" &&
        action !== "extract_artifact"
      )
        throw new Error("include_partial is only valid for artifact download/extraction.");

      let result:
        | CloudTaskStartResult
        | CloudTaskStatus
        | CloudTaskFailureReport
        | CloudTaskArtifact
        | CloudTaskExtracted;
      if (action === "start") {
        if (args.owner !== undefined || args.repository !== undefined) {
          throw new Error(
            "Choose the repository for new cloud tasks in Settings. owner/repository arguments only read existing tasks.",
          );
        }
        const runner = requiredRunner(args.runner);
        const agent = args.agent === undefined ? undefined : cloudAgent(args.agent);
        if (agent && args.script?.trim())
          throw new Error("Cloud start must choose either agent or script.");
        const script = agent ? "" : requiredString(args.script, "script");
        const files = (args.files ?? []).map((file, index) => ({
          path: requiredString(file.path, `files[${index}].path`),
          content: typeof file.content === "string" ? file.content : "",
          encoding: file.encoding ?? "utf8",
        }));
        // Only the host supplies this port. The native journal derives inputs
        // from the already persisted original call, never from new parameters.
        if (startBackground) return await startBackground(toolCall.id);
        result = await invoke<CloudTaskStartResult>("cloud_task_start", {
          input: {
            owner: settings.githubOwner.trim(),
            repository: settings.githubRepository.trim() || "agent-temp",
            runner,
            label: args.label?.trim() ?? "",
            script,
            ...(agent ? { agent } : {}),
            files,
            retentionDays: settings.cloudArtifactRetentionDays,
          },
        });
      } else {
        const taskId = requiredString(args.task_id, "task_id");
        const taskLocator = locator(settings, taskId, args);
        if (action === "status") {
          result = await invoke<CloudTaskStatus>("cloud_task_status", {
            locator: taskLocator,
          });
        } else if (action === "wait") {
          result = await invoke<CloudTaskStatus>("cloud_task_wait", {
            locator: taskLocator,
            maxWaitSeconds: Math.min(55, Math.max(1, Math.floor(args.max_wait_seconds ?? 45))),
          });
        } else if (action === "failure_log") {
          result = await invoke<CloudTaskFailureReport>("cloud_task_failure_log", {
            locator: taskLocator,
          });
        } else {
          result = await invoke<CloudTaskExtracted | CloudTaskArtifact>(
            action === "extract_artifact"
              ? "cloud_task_extract_artifact"
              : "cloud_task_download_artifact",
            {
              locator: taskLocator,
              destinationDir: workdir.trim() || undefined,
              ...(args.include_partial === undefined
                ? {}
                : { includePartial: args.include_partial }),
            },
          );
        }
      }

      const failed =
        "state" in result &&
        result.state === "completed" &&
        Boolean(result.conclusion && result.conclusion !== "success");
      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: resultText(action, result) }],
        details: { kind: "cloud_task_manager", action, ...result },
        isError: failed,
        timestamp: now,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: `CloudTaskManager failed: ${message}` }],
        details: {},
        isError: true,
        timestamp: now,
      };
    }
  }

  return {
    groupId: "cloud",
    tools: [tool],
    executeToolCall,
    metadataByName: createBuiltinMetadataMap([
      [
        "CloudTaskManager",
        {
          groupId: "cloud",
          kind: "cloud_task_manager",
          isReadOnly: false,
          displayCategory: "system",
        },
      ],
    ]),
  };
}
