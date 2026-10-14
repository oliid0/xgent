import { readWorkspaceFileSource, type WorkspaceFileSource } from "../../tools/workspaceFileSource";
import type { PreviewedFile } from "./previewedFiles";
import type { UiRound } from "./uiMessages";

type ToolBlockItem = Extract<UiRound["blocks"][number], { kind: "tool" }>["item"];

export type CloudArtifactAttachment = {
  taskId: string;
  artifactId: number;
  artifactName: string;
  localPath: string;
  sizeBytes: number;
  toolCallId: string;
  runConclusion?: string;
  fileSource?: WorkspaceFileSource;
};

function resultDetails(item: ToolBlockItem): Record<string, unknown> | null {
  const details = item.toolResult?.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  return details as Record<string, unknown>;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function collectCloudArtifacts(
  rounds: readonly Pick<UiRound, "blocks">[],
): CloudArtifactAttachment[] {
  const byArtifact = new Map<string, CloudArtifactAttachment>();

  for (const round of rounds) {
    for (const block of round.blocks) {
      if (block.kind !== "tool") continue;
      const item = block.item;
      if (item.toolCall.name !== "CloudTaskManager" || item.toolResult?.isError) continue;
      const details = resultDetails(item);
      if (!details || !["download_artifact", "extract_artifact"].includes(String(details.action)))
        continue;

      const taskId = readString(details.taskId);
      const artifactName = readString(details.artifactName);
      const localPath = readString(details.localPath);
      const artifactId = readFiniteNumber(details.artifactId);
      const sizeBytes = readFiniteNumber(details.sizeBytes);
      if (
        !taskId ||
        !artifactName ||
        !localPath ||
        artifactId === null ||
        artifactId < 0 ||
        sizeBytes === null ||
        sizeBytes < 0
      ) {
        continue;
      }

      const fileSource = readWorkspaceFileSource(details.fileSource);
      // New native imports must retain their original identity. A damaged or
      // incomplete replay must not fall back to the selected/global workspace.
      if (details.action === "extract_artifact" && !fileSource) continue;
      const artifact: CloudArtifactAttachment = {
        taskId,
        artifactId,
        artifactName,
        localPath,
        sizeBytes,
        toolCallId: item.toolCall.id,
        ...(typeof details.runConclusion === "string"
          ? { runConclusion: details.runConclusion }
          : {}),
        ...(fileSource ? { fileSource } : {}),
      };
      byArtifact.set(`${taskId}:${artifactId}`, artifact);
    }
  }

  return Array.from(byArtifact.values());
}

/** Actual imported files, distinct from a model's claim that criteria are verified.
 * Restoring native source identity prevents a selected PC/history sync redirect. */
export function collectCloudExtractedFiles(
  rounds: readonly Pick<UiRound, "blocks">[],
): PreviewedFile[] {
  const files = new Map<string, PreviewedFile>();
  for (const round of rounds)
    for (const block of round.blocks) {
      if (
        block.kind !== "tool" ||
        block.item.toolCall.name !== "CloudTaskManager" ||
        !block.item.toolResult ||
        block.item.toolResult.isError
      )
        continue;
      const details = resultDetails(block.item);
      const source = readWorkspaceFileSource(details?.fileSource);
      if (
        details?.kind !== "cloud_task_manager" ||
        details.action !== "extract_artifact" ||
        !source ||
        !Array.isArray(details.files) ||
        details.files.length > 1000
      )
        continue;
      for (const record of details.files) {
        if (
          !record ||
          typeof record !== "object" ||
          typeof record.path !== "string" ||
          !record.path ||
          record.path.length > 32768 ||
          /[\\:]/.test(record.path) ||
          Array.from(record.path as string).some(
            (char) =>
              char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
          ) ||
          record.path.split("/").some((part: string) => !part || part === "." || part === "..") ||
          !Number.isSafeInteger(record.bytes) ||
          record.bytes < 0 ||
          record.bytes > 64 * 1024 * 1024 ||
          !/^[a-f0-9]{64}$/.test(record.contentHash)
        )
          continue;
        // Internal execution receipts remain available to tools, not decorative file cards.
        if (record.path.split("/").includes(".xgent-agent")) continue;
        files.set(JSON.stringify([source.hostId, source.workdir, record.path]), {
          path: record.path,
          fileSource: source,
          toolCallId: block.item.toolCall.id,
        });
      }
    }
  return [...files.values()];
}
