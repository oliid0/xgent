import { invoke } from "@xgent/runtime";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { WorkspaceCodeEditorOpenRequest } from "../../../components/workspace-editor/WorkspaceCodeEditorOverlay";
import type { WorkspaceFilePreviewOpenRequest } from "../../../components/workspace-editor/WorkspaceFilePreviewOverlay";
import { isWorkspacePreviewPath } from "../../../components/workspace-editor/workspaceImagePreview";
import { openBackgroundChatArtifact } from "../../../lib/automation/backgroundChatArtifactOpen";
import type { ChatFileLink } from "../../../lib/chat/chatFileLinks";
import { workspaceProjectPathKey } from "../../../lib/settings";
import {
  readWorkspaceFileSource,
  restoreWorkspaceFilePort,
} from "../../../lib/tools/workspaceFileSource";

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
  localArtifactWorkdir?: string;
  terminalProjectPathKey: string;
  notifyError: (message: string) => void;
  onRevealInFileTree: (path: string) => void;
  openWorkspaceEditorFile: (request: Omit<WorkspaceCodeEditorOpenRequest, "id">) => void;
  openWorkspaceFilePreview: (request: Omit<WorkspaceFilePreviewOpenRequest, "id">) => void;
}) {
  const {
    conversationId,
    conversationWorkdir,
    localArtifactWorkdir,
    terminalProjectPathKey,
    notifyError,
    onRevealInFileTree,
    openWorkspaceEditorFile,
    openWorkspaceFilePreview,
  } = params;
  const owner = useMemo(
    () => ({ conversationId, conversationWorkdir }),
    [conversationId, conversationWorkdir],
  );
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [owner]);
  const isCurrent = useCallback(() => mounted.current && ownerRef.current === owner, [owner]);

  return useCallback(
    async (link: ChatFileLink) => {
      if (!isCurrent()) return;
      if (link.backgroundArtifact) {
        try {
          if (link.backgroundArtifact.conversationId !== conversationId)
            throw new Error("Artifact does not belong to this conversation");
          const saved = await openBackgroundChatArtifact(
            link.backgroundArtifact,
            localArtifactWorkdir ?? "",
            isCurrent,
          );
          if (!isCurrent()) return;
          const commandPort = restoreWorkspaceFilePort(saved.fileSource);
          if (!isWorkspacePreviewPath(saved.path)) {
            await commandPort.invoke("fs_open_workspace_path", {
              workdir: saved.fileSource.workdir,
              path: saved.path,
              mode: "reveal",
            });
          } else
            openWorkspaceFilePreview({
              ownerId: conversationId,
              projectPathKey: workspaceProjectPathKey(saved.fileSource.workdir),
              workdir: saved.fileSource.workdir,
              path: saved.path,
              fileSource: saved.fileSource,
              commandPort,
            });
        } catch (error) {
          if (isCurrent()) notifyError(errorMessage(error));
        }
        return;
      }
      if (Object.hasOwn(link, "fileSource")) {
        try {
          const fileSource = readWorkspaceFileSource(link.fileSource);
          if (!fileSource)
            throw new Error("这个历史结果缺少可验证的原设备来源，请在原任务设备中确认文件。");
          const commandPort = restoreWorkspaceFilePort(fileSource);
          const status = await commandPort.invoke<{ exists: boolean; kind?: string }>(
            "fs_path_status",
            {
              workdir: fileSource.workdir,
              path: link.path,
            },
          );
          if (!isCurrent()) return;
          if (!status.exists || status.kind !== "file")
            throw new Error("原设备上的结果文件不存在或无法预览。");
          openWorkspaceFilePreview({
            ownerId: conversationId,
            projectPathKey: workspaceProjectPathKey(fileSource.workdir),
            workdir: fileSource.workdir,
            path: link.path,
            fileSource,
            commandPort,
          });
        } catch (error) {
          if (isCurrent()) notifyError(errorMessage(error));
        }
        return;
      }
      if (!conversationId.trim() || !conversationWorkdir.trim()) {
        notifyError("当前会话没有可用的本地工作目录。");
        return;
      }
      try {
        const response = await invoke<ChatFileLinkOpenResponse>("open_chat_file_link", {
          conversation_id: conversationId,
          workdir: conversationWorkdir,
          path: link.path,
          source: link.source,
          line: link.line,
          end_line: link.endLine,
          column: link.column,
          open_in_file_manager: false,
        });
        if (!isCurrent()) return;
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
            conversation_id: conversationId,
            workdir: conversationWorkdir,
            path: link.path,
            source: link.source,
            line: link.line,
            end_line: link.endLine,
            column: link.column,
            open_in_file_manager: true,
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
        if (isCurrent()) notifyError(errorMessage(error));
      }
    },
    [
      conversationId,
      conversationWorkdir,
      localArtifactWorkdir,
      notifyError,
      onRevealInFileTree,
      openWorkspaceEditorFile,
      openWorkspaceFilePreview,
      terminalProjectPathKey,
      isCurrent,
    ],
  );
}
