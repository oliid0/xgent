import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";
import { invokeFs } from "./fsBackend";
import { ToolPathResolver } from "./pathUtils";
import { bindPreviewExecution, type PreviewExecution } from "./previewExecution";
import type { ToolCommandPort } from "./toolCommandPort";
import { readWorkspaceFileSource } from "./workspaceFileSource";

export const MOBILE_PREVIEW_REQUEST_EVENT = "xgent:mobile-preview-request";

export type MobilePreviewRequest = PreviewExecution & {
  ownerId: string;
  workdir: string;
  projectPathKey: string;
  path: string;
};

type PathStatusResponse = {
  path: string;
  exists: boolean;
  kind?: string | null;
};

const previewFileTool: Tool = {
  name: "PreviewFile",
  description:
    "Open a file that already exists in the current mobile workspace in Xgent's visible preview. Use this after creating or updating HTML, Markdown, PDF, image, audio, video, Word, or spreadsheet output that the user should inspect. This does not create the file; use Write/Edit first.",
  parameters: Type.Object({
    path: Type.String({
      minLength: 1,
      description: 'Workspace-relative file path such as "index.html" or "README.md".',
    }),
  }),
};

function toolResult(
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

type PreviewEventDetail = MobilePreviewRequest & { accept: () => void };

export function subscribeMobilePreviewRequests(
  listener: (request: MobilePreviewRequest) => boolean,
) {
  const handleEvent = (event: Event) => {
    const detail = (event as CustomEvent<PreviewEventDetail>).detail;
    if (detail?.workdir && detail.path && detail.ownerId && listener(detail)) detail.accept();
  };
  window.addEventListener(MOBILE_PREVIEW_REQUEST_EVENT, handleEvent);
  return () => window.removeEventListener(MOBILE_PREVIEW_REQUEST_EVENT, handleEvent);
}

export function createMobilePreviewTools(params: {
  workdir: string;
  shellWorkspaceRoot?: string;
  projectPathKey?: string;
  conversationId?: string;
  commandPort?: ToolCommandPort;
}): BuiltinToolBundle {
  const execution = bindPreviewExecution({ commandPort: params.commandPort });
  const pathResolver = new ToolPathResolver({
    ...params,
    resolveHomeDir: params.commandPort?.homeDir,
  });
  async function executeToolCall(toolCall: ToolCall, signal?: AbortSignal) {
    if (toolCall.name !== "PreviewFile") {
      return toolResult(toolCall, `Unknown tool: ${toolCall.name}`, {}, true);
    }
    if (signal?.aborted) return toolResult(toolCall, "Preview cancelled.", {}, true);
    if (!params.conversationId) {
      return toolResult(toolCall, "PreviewFile requires an owning conversation.", {}, true);
    }

    const args = (toolCall.arguments ?? {}) as Record<string, unknown>;
    const path = typeof args.path === "string" ? args.path.trim() : "";
    if (!path) {
      return toolResult(toolCall, "PreviewFile.path is required.", {}, true);
    }

    try {
      const resolved = await pathResolver.resolvePath(path, {
        label: "PreviewFile.path",
        intent: "read",
        required: true,
      });
      if (resolved.scope !== "workspace") {
        throw new Error("PreviewFile requires a file in the current workspace.");
      }
      const status = await invokeFs<PathStatusResponse>(
        "fs_path_status",
        { workdir: params.workdir, path: resolved.relativePath ?? "." },
        execution.commandPort?.invoke,
      );
      if (!status.exists) {
        return toolResult(toolCall, `PreviewFile could not find ${path}.`, { path }, true);
      }
      if (status.kind !== "file") {
        return toolResult(
          toolCall,
          `PreviewFile requires a file, but ${status.path || path} is ${status.kind || "not a file"}.`,
          { path: status.path || path, kind: status.kind ?? null },
          true,
        );
      }
      if (signal?.aborted) return toolResult(toolCall, "Preview cancelled.", {}, true);

      // Older/custom transports can still show a live preview, but cannot
      // manufacture durable source authority from a path or the UI selection.
      const fileSource = readWorkspaceFileSource(
        await execution.commandPort?.resolveFileSource?.(params.workdir).catch(() => null),
      );
      if (signal?.aborted) return toolResult(toolCall, "Preview cancelled.", {}, true);
      const request: MobilePreviewRequest = bindPreviewExecution({
        ...execution,
        commandPort:
          fileSource && execution.commandPort
            ? { ...execution.commandPort, fileSource }
            : execution.commandPort,
        fileSource,
        ownerId: params.conversationId,
        workdir: params.workdir,
        projectPathKey: params.projectPathKey?.trim() || params.workdir,
        path: status.path || path,
      });
      let accepted = false;
      const detail: PreviewEventDetail = {
        ...request,
        accept: () => {
          accepted = true;
        },
      };
      window.dispatchEvent(new CustomEvent(MOBILE_PREVIEW_REQUEST_EVENT, { detail }));
      if (!accepted) {
        return toolResult(
          toolCall,
          "Preview was not accepted by the active conversation. The file remains available in its workspace.",
          { path: request.path },
          true,
        );
      }
      return toolResult(
        toolCall,
        `Submitted ${request.path} to Xgent's mobile preview. The viewer reports loading errors.`,
        {
          kind: "mobile_file_preview",
          ownerId: request.ownerId,
          workdir: request.workdir,
          projectPathKey: request.projectPathKey,
          path: request.path,
          fileSource,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolResult(toolCall, `PreviewFile failed: ${message}`, { path }, true);
    }
  }

  return {
    groupId: "browser",
    tools: [previewFileTool],
    executeToolCall,
    metadataByName: createBuiltinMetadataMap([
      [
        "PreviewFile",
        {
          groupId: "browser",
          kind: "mobile_file_preview",
          isReadOnly: true,
          displayCategory: "browser",
        },
      ],
    ]),
  };
}
