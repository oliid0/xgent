import type { BackgroundArtifact } from "../../automation/types";

export type BackgroundChatArtifact = {
  version: 1;
  conversationId: string;
  requestId: string;
  sourceHostId: string;
  receiverHostId: string;
  entryId: string;
  snapshotHash: string;
  artifact: BackgroundArtifact;
};

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function readBackgroundChatArtifact(value: unknown): BackgroundChatArtifact | null {
  const ref = object(value),
    file = object(ref?.artifact);
  if (
    !ref ||
    ref.version !== 1 ||
    !file ||
    typeof ref.conversationId !== "string" ||
    !ref.conversationId.trim() ||
    ref.conversationId.length > 512 ||
    ![ref.requestId, ref.sourceHostId, ref.receiverHostId, ref.entryId, file.id].every(
      (value) => typeof value === "string" && uuid.test(value),
    ) ||
    typeof ref.snapshotHash !== "string" ||
    !hash.test(ref.snapshotHash) ||
    typeof file.relativePath !== "string" ||
    !file.relativePath ||
    file.relativePath.length > 1024 ||
    /[\\:]/.test(file.relativePath) ||
    Array.from(file.relativePath).some(
      (char) => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
    ) ||
    file.relativePath.split("/").some((part) => !part || part === "." || part === "..") ||
    !Number.isSafeInteger(file.bytes) ||
    (file.bytes as number) < 0 ||
    (file.bytes as number) > 512 * 1024 * 1024 ||
    typeof file.contentHash !== "string" ||
    !hash.test(file.contentHash)
  )
    return null;
  return {
    version: 1,
    conversationId: ref.conversationId,
    requestId: ref.requestId as string,
    sourceHostId: ref.sourceHostId as string,
    receiverHostId: ref.receiverHostId as string,
    entryId: ref.entryId as string,
    snapshotHash: ref.snapshotHash,
    artifact: {
      id: file.id as string,
      relativePath: file.relativePath,
      bytes: file.bytes as number,
      contentHash: file.contentHash,
    },
  };
}

/** Real delivery metadata, never fabricated PreviewFile calls or workspace paths. */
export function readBackgroundChatArtifacts(message: unknown): BackgroundChatArtifact[] {
  const source = object(message),
    result = object(source?.xgentBackgroundResult),
    task = object(source?.xgentBackgroundTask);
  if (
    !source ||
    source.role !== "assistant" ||
    result?.version !== 2 ||
    !task ||
    result.requestId !== task.requestId ||
    result.sourceHostId !== task.hostId ||
    !Array.isArray(result.artifacts) ||
    result.artifacts.length > 32
  )
    return [];
  const refs = result.artifacts.map((artifact) =>
    readBackgroundChatArtifact({ ...result, version: 1, artifact }),
  );
  if (refs.some((ref) => !ref) || new Set(refs.map((ref) => ref?.artifact.id)).size !== refs.length)
    return [];
  return refs.filter(
    (ref): ref is BackgroundChatArtifact =>
      !!ref && !ref.artifact.relativePath.split("/").includes(".xgent-agent"),
  );
}

export function backgroundChatArtifactKey(ref: BackgroundChatArtifact) {
  return JSON.stringify([ref.receiverHostId, ref.conversationId, ref.entryId, ref.artifact.id]);
}

export function collectBackgroundChatArtifacts(
  rounds: readonly { backgroundArtifacts?: readonly BackgroundChatArtifact[] }[],
) {
  const files = new Map<string, BackgroundChatArtifact>();
  for (const round of rounds)
    for (const ref of round.backgroundArtifacts ?? [])
      files.set(backgroundChatArtifactKey(ref), ref);
  return [...files.values()];
}

export function backgroundChatArtifactLabel(ref: BackgroundChatArtifact) {
  const file = ref.artifact,
    extension = /\.([a-zA-Z0-9]{1,12})$/.exec(file.relativePath)?.[1]?.toUpperCase() ?? "";
  const size =
    file.bytes < 1024
      ? `${file.bytes} B`
      : file.bytes < 1024 * 1024
        ? `${Math.round(file.bytes / 1024)} KB`
        : `${(file.bytes / (1024 * 1024)).toFixed(1)} MB`;
  return [extension, size, ref.sourceHostId.slice(0, 8)].filter(Boolean).join(" · ");
}
