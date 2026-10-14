import {
  readWorkspaceFileSource,
  type WorkspaceFileSource,
  workspaceFileSourceKey,
} from "../../tools/workspaceFileSource";
import type { BackgroundChatArtifact } from "./backgroundArtifacts";
import type { ChangedFilesSummary } from "./changedFiles";
import type { UiRound } from "./uiMessages";

export type PreviewedFile = {
  backgroundArtifact?: BackgroundChatArtifact;
  path: string;
  toolCallId: string;
  fileSource?: WorkspaceFileSource | null;
};

function pathKey(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

/** Files explicitly opened by the agent, including outputs created by Shell. */
export function collectPreviewedFiles(
  rounds: readonly Pick<UiRound, "blocks">[],
  changedFiles?: ChangedFilesSummary | null,
): PreviewedFile[] {
  const changedPaths = new Set(changedFiles?.files.map((file) => pathKey(file.path)) ?? []);
  const files = new Map<string, PreviewedFile>();
  for (const round of rounds) {
    for (const block of round.blocks) {
      if (block.kind !== "tool" || block.item.toolCall.name !== "PreviewFile") continue;
      const { toolCall, toolResult } = block.item;
      if (!toolResult || toolResult.isError || !toolCall.id) continue;
      const details = toolResult.details;
      if (!details || typeof details !== "object" || Array.isArray(details)) continue;
      const record = details as Record<string, unknown>;
      if (record.kind !== "mobile_file_preview") continue;
      const path = typeof record.path === "string" ? record.path.trim() : "";
      const fileSource = readWorkspaceFileSource(record.fileSource);
      if (!path || (!fileSource && changedPaths.has(pathKey(path)))) continue;
      // Unowned change traces cannot hide a result from a different device.
      // Source paths remain case-sensitive, including on Linux/macOS workers.
      const key = fileSource
        ? JSON.stringify([
            workspaceFileSourceKey(fileSource),
            path.replace(/\\/g, "/").replace(/^\.\//, ""),
          ])
        : pathKey(path);
      files.set(key, {
        path,
        toolCallId: toolCall.id,
        ...(Object.hasOwn(record, "fileSource") ? { fileSource } : {}),
      });
    }
  }
  return Array.from(files.values());
}
