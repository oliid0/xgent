import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { invoke } from "@xagent/runtime";
import { Type } from "typebox";

import type { AccessSettings } from "../settings";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";

type CloudTaskAction = "start" | "status" | "wait" | "failure_log" | "download_artifact";

type CloudTaskStartResult = {
  taskId: string;
  owner: string;
  repository: string;
  runner: string;
  repositoryUrl: string;
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
  runner?: "ubuntu-latest" | "windows-latest" | "macos-latest";
  label?: string;
  script?: string;
  files?: Array<{
    path?: string;
    content?: string;
    encoding?: "utf8" | "base64";
  }>;
  max_wait_seconds?: number;
};

const CLOUD_TASK_PARAMETERS = Type.Object({
  action: Type.Union([
    Type.Literal("start"),
    Type.Literal("status"),
    Type.Literal("wait"),
    Type.Literal("failure_log"),
    Type.Literal("download_artifact"),
  ]),
  task_id: Type.Optional(Type.String({ description: "Task id returned by action=start." })),
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

function locator(settings: AccessSettings, taskId: string) {
  return {
    owner: settings.githubOwner.trim(),
    repository: settings.githubRepository.trim() || "agent-temp",
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
      "Use action=wait with this task_id until state=completed, then action=download_artifact.",
    ].join("\n");
  }
  if (action === "download_artifact") {
    const artifact = result as CloudTaskArtifact;
    return [
      `Cloud task artifact downloaded: ${artifact.artifactName}`,
      `local path: ${artifact.localPath}`,
      `size: ${artifact.sizeBytes} bytes`,
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

export function createCloudTaskTools(settings: AccessSettings, workdir: string): BuiltinToolBundle {
  const tool: Tool = {
    name: "CloudTaskManager",
    description:
      "Run a complex build or media/document task in a public GitHub Actions workspace. Use it when the local environment is unavailable or unsuitable, for example IPA/APK/EXE builds, PDF/PPT generation, or video processing. Each task is isolated under tasks/<task-id>, and committed task files are public. Repository Actions Variables/Secrets provide task environment values. Put every output in ../output, wait for completion, then download the artifact. On failure, inspect action=failure_log and create a new corrected task.",
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

      let result:
        | CloudTaskStartResult
        | CloudTaskStatus
        | CloudTaskFailureReport
        | CloudTaskArtifact;
      if (action === "start") {
        const runner = requiredRunner(args.runner);
        const script = requiredString(args.script, "script");
        const files = (args.files ?? []).map((file, index) => ({
          path: requiredString(file.path, `files[${index}].path`),
          content: typeof file.content === "string" ? file.content : "",
          encoding: file.encoding ?? "utf8",
        }));
        result = await invoke<CloudTaskStartResult>("cloud_task_start", {
          input: {
            owner: settings.githubOwner.trim(),
            repository: settings.githubRepository.trim() || "agent-temp",
            runner,
            label: args.label?.trim() ?? "",
            script,
            files,
            retentionDays: settings.cloudArtifactRetentionDays,
          },
        });
      } else {
        const taskId = requiredString(args.task_id, "task_id");
        if (action === "status") {
          result = await invoke<CloudTaskStatus>("cloud_task_status", {
            locator: locator(settings, taskId),
          });
        } else if (action === "wait") {
          result = await invoke<CloudTaskStatus>("cloud_task_wait", {
            locator: locator(settings, taskId),
            maxWaitSeconds: Math.min(55, Math.max(1, Math.floor(args.max_wait_seconds ?? 45))),
          });
        } else if (action === "failure_log") {
          result = await invoke<CloudTaskFailureReport>("cloud_task_failure_log", {
            locator: locator(settings, taskId),
          });
        } else {
          result = await invoke<CloudTaskArtifact>("cloud_task_download_artifact", {
            locator: locator(settings, taskId),
            destinationDir: workdir.trim() || undefined,
          });
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
        details: { action, ...result },
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
