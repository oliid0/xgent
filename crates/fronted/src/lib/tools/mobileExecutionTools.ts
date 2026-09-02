import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { mobileExecutionStatus } from "../mobileExecution";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";

const mobileEnvironmentTool: Tool = {
  name: "MobileEnvironment",
  description:
    "Inspect the installed native mobile Shell backend and its verified capabilities before choosing commands or packages. Returns whether the environment is ready, whether networking and package management work, and the exact installed/installable toolchains. This is read-only; the user prepares the base environment from Mobile execution settings.",
  parameters: Type.Object({}, { additionalProperties: false }),
};

function result(
  toolCall: ToolCall,
  text: string,
  details: Record<string, unknown>,
  isError = false,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text }],
    details,
    isError,
    timestamp: Date.now(),
  };
}

export function createMobileExecutionTools(): BuiltinToolBundle {
  async function executeToolCall(toolCall: ToolCall, signal?: AbortSignal) {
    if (toolCall.name !== "MobileEnvironment") {
      return result(toolCall, `Unknown tool: ${toolCall.name}`, {}, true);
    }
    if (signal?.aborted)
      return result(toolCall, "Mobile environment inspection cancelled.", {}, true);

    try {
      const status = await mobileExecutionStatus();
      if (signal?.aborted) {
        return result(toolCall, "Mobile environment inspection cancelled.", {}, true);
      }
      const toolchains = status.toolchains.map((toolchain) => {
        const state = toolchain.installed
          ? "installed"
          : toolchain.installable
            ? "available to install"
            : "unavailable";
        return `- ${toolchain.id}: ${state}${toolchain.version ? ` (${toolchain.version})` : ""}${
          toolchain.detail ? ` — ${toolchain.detail}` : ""
        }`;
      });
      const text = [
        `backend: ${status.backend}`,
        `available: ${status.available}`,
        `installed: ${status.installed}`,
        `shell: ${status.capabilities.shell}`,
        `network: ${status.capabilities.network}`,
        `package_management: ${status.capabilities.packageManagement}`,
        `child_processes: ${status.capabilities.childProcesses}`,
        status.environmentVersion ? `environment: ${status.environmentVersion}` : null,
        status.detail ? `detail: ${status.detail}` : null,
        "toolchains:",
        ...(toolchains.length > 0 ? toolchains : ["- none reported"]),
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
      return result(toolCall, text, { kind: "mobile_environment", ...status });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return result(toolCall, `Mobile environment inspection failed: ${message}`, {}, true);
    }
  }

  return {
    groupId: "shell",
    tools: [mobileEnvironmentTool],
    executeToolCall,
    metadataByName: createBuiltinMetadataMap([
      [
        "MobileEnvironment",
        {
          groupId: "shell",
          kind: "mobile_environment",
          isReadOnly: true,
          displayCategory: "terminal",
        },
      ],
    ]),
  };
}
