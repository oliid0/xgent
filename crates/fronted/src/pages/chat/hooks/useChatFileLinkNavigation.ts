import { invoke } from "@xgent/runtime";
import { useCallback } from "react";
import type { WorkspaceCodeEditorOpenRequest } from "../../../components/workspace-editor/WorkspaceCodeEditorOverlay";
import type { WorkspaceFilePreviewOpenRequest } from "../../../components/workspace-editor/WorkspaceFilePreviewOverlay";
import type { ChatFileLink } from "../../../lib/chat/chatFileLinks";
import { workspaceProjectPathKey } from "../../../lib/settings";

type ChatFileLinkOpenResponse = {
  action: "editor" | "preview" | "directory" | "opened" | "revealed";
  kind: "file" | "directory";
  workdir?: string;
  path?: string;
  line?: number;
  endLine?: number;
  column?: number;
  outsideWorkspace: boolean;
};

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function useChatFileLinkNavigation(params: {
  conversationId: string;
  conversationWorkdir: string;
  terminalProjectPathKey: string;
  notifyError: (message: string) => void;
  onRevealInFileTree: (path: string) => void;
  openWorkspaceEditorFile: (request: Omit<WorkspaceCodeEditorOpenRequest, "id">) => void;
  openWorkspaceFilePreview: (request: Omit<WorkspaceFilePreviewOpenRequest, "id">) => void;
}) {
  const {
    conversationId,
    conversationWorkdir,
    terminalProjectPathKey,
    notifyError,
    onRevealInFileTree,
    openWorkspaceEditorFile,
    openWorkspaceFilePreview,
  } = params;

  return useCallback(
    async (link: ChatFileLink) => {
      if (!conversationId.trim() || !conversationWorkdir.trim()) {
        notifyError("当前会话没有可用的本地工作目录。");
        return;
      }
      try {
        const response = await invoke<ChatFileLinkOpenResponse>("open_chat_file_link", {
          conversationId,
          workdir: conversationWorkdir,
          path: link.path,
          source: link.source,
          line: link.line,
          endLine: link.endLine,
          column: link.column,
          openInFileManager: false,
        });
        if (response.action === "opened" || response.action === "revealed") return;
        const workdir = response.workdir?.trim();
        const path = response.path?.trim();
        if (!workdir || !path) throw new Error("文件链接返回了无效的本地目标。");
        const projectPathKey = workspaceProjectPathKey(workdir);
        if (response.action === "directory") {
          if (projectPathKey === terminalProjectPathKey && !response.outsideWorkspace) {
            onRevealInFileTree(path);
            return;
          }
          await invoke("open_chat_file_link", {
            conversationId,
            workdir: conversationWorkdir,
            path: link.path,
            source: link.source,
            line: link.line,
            endLine: link.endLine,
            column: link.column,
            openInFileManager: true,
          });
          return;
        }
        const request = {
          projectPathKey,
          workdir,
          path,
          ...(response.line ? { line: response.line } : {}),
          ...(response.endLine ? { endLine: response.endLine } : {}),
          ...(response.column ? { column: response.column } : {}),
        };
        if (response.action === "preview") openWorkspaceFilePreview(request);
        else openWorkspaceEditorFile(request);
      } catch (error) {
        notifyError(errorMessage(error));
      }
    },
    [
      conversationId,
      conversationWorkdir,
      notifyError,
      onRevealInFileTree,
      openWorkspaceEditorFile,
      openWorkspaceFilePreview,
      terminalProjectPathKey,
    ],
  );
}
