import type { ChangedFilesSummary } from "./changedFiles";
import type { UiRound } from "./uiMessages";

export type PreviewedFile = { path: string; toolCallId: string };

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
      if (!path || changedPaths.has(pathKey(path))) continue;
      files.set(pathKey(path), { path, toolCallId: toolCall.id });
    }
  }
  return Array.from(files.values());
}
