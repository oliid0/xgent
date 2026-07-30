import type { UiRound } from "./uiMessages";

type ToolBlockItem = Extract<UiRound["blocks"][number], { kind: "tool" }>["item"];

export type CloudArtifactAttachment = {
  taskId: string;
  artifactId: number;
  artifactName: string;
  localPath: string;
  sizeBytes: number;
  toolCallId: string;
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
      if (!details || details.action !== "download_artifact") continue;

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

      const artifact: CloudArtifactAttachment = {
        taskId,
        artifactId,
        artifactName,
        localPath,
        sizeBytes,
        toolCallId: item.toolCall.id,
      };
      byArtifact.set(`${taskId}:${artifactId}`, artifact);
    }
  }

  return Array.from(byArtifact.values());
}
