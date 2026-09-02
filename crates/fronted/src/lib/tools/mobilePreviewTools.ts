import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";
import { invokeFs } from "./fsBackend";

export const MOBILE_PREVIEW_REQUEST_EVENT = "xgent:mobile-preview-request";

export type MobilePreviewRequest = {
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

export function subscribeMobilePreviewRequests(listener: (request: MobilePreviewRequest) => void) {
  const handleEvent = (event: Event) => {
    const detail = (event as CustomEvent<MobilePreviewRequest>).detail;
    if (detail?.workdir && detail.path) listener(detail);
  };
  window.addEventListener(MOBILE_PREVIEW_REQUEST_EVENT, handleEvent);
  return () => window.removeEventListener(MOBILE_PREVIEW_REQUEST_EVENT, handleEvent);
}

export function createMobilePreviewTools(params: {
  workdir: string;
  projectPathKey?: string;
}): BuiltinToolBundle {
  async function executeToolCall(toolCall: ToolCall, signal?: AbortSignal) {
    if (toolCall.name !== "PreviewFile") {
      return toolResult(toolCall, `Unknown tool: ${toolCall.name}`, {}, true);
    }
    if (signal?.aborted) return toolResult(toolCall, "Preview cancelled.", {}, true);

    const args = (toolCall.arguments ?? {}) as Record<string, unknown>;
    const path = typeof args.path === "string" ? args.path.trim() : "";
    if (!path) {
      return toolResult(toolCall, "PreviewFile.path is required.", {}, true);
    }

    try {
      const status = await invokeFs<PathStatusResponse>("fs_path_status", {
        workdir: params.workdir,
        path,
      });
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

      const request: MobilePreviewRequest = {
        workdir: params.workdir,
        projectPathKey: params.projectPathKey?.trim() || params.workdir,
        path: status.path || path,
      };
      window.dispatchEvent(new CustomEvent(MOBILE_PREVIEW_REQUEST_EVENT, { detail: request }));
      return toolResult(toolCall, `Opened ${request.path} in Xgent's mobile preview.`, {
        kind: "mobile_file_preview",
        ...request,
      });
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
