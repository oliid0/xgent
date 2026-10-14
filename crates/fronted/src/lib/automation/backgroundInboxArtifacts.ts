import { invokeNative, isTauriRuntime } from "@xgent/runtime";
import { sha256Hex } from "../trajectory/sha256";
import { backend } from "./backend";
import type { BackgroundArtifact, BackgroundInboxItem } from "./types";

/** Save only actual bytes from the entry's original authenticated host.
 * Native create_new prevents overwriting any existing local file. */
export async function saveInboxArtifact(
  entry: Pick<BackgroundInboxItem, "id" | "requestId">,
  expected: BackgroundArtifact,
  workdir: string,
  isCurrent: () => boolean,
): Promise<{ path: string; bytesWritten: number; contentHash: string }> {
  if (!isCurrent()) throw new Error("Artifact transfer left its original inbox view");
  if (!isTauriRuntime() || !workdir.trim()) throw new Error("A local native workspace is required");
  if (
    !Number.isSafeInteger(expected.bytes) ||
    expected.bytes < 0 ||
    expected.bytes > 512 * 1024 * 1024
  )
    throw new Error("Artifact exceeds the bounded 512 MiB transfer size");
  if (expected.bytes > 8 * 1024 * 1024) {
    let transferId: string | undefined;
    try {
      const prepared = await invokeNative<{ transferId: string; artifact: BackgroundArtifact }>(
        "automation_result_artifact_prepare",
        { entry_id: entry.id, artifact_id: expected.id, workdir },
      );
      transferId = prepared.transferId;
      if (!isCurrent()) throw new Error("Artifact transfer left its original inbox view");
      if (
        typeof transferId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(transferId) ||
        prepared.artifact.id !== expected.id ||
        prepared.artifact.relativePath !== expected.relativePath ||
        prepared.artifact.bytes !== expected.bytes ||
        prepared.artifact.contentHash !== expected.contentHash
      )
        throw new Error("Prepared artifact differs from its original received manifest");
      const saved = await invokeNative<{ path: string; bytesWritten: number; contentHash: string }>(
        "automation_result_artifact_commit",
        { transfer_id: transferId },
      );
      if (!isCurrent()) throw new Error("Artifact transfer left its original inbox view");
      const path = `background-results/${entry.requestId}/${expected.id}/${expected.relativePath}`;
      if (
        saved.path !== path ||
        saved.bytesWritten !== expected.bytes ||
        saved.contentHash !== expected.contentHash
      )
        throw new Error(
          "Local artifact write returned inconsistent evidence; inspect before retrying",
        );
      return saved;
    } finally {
      if (transferId)
        await invokeNative("automation_result_artifact_abort", { transfer_id: transferId }).catch(
          () => {},
        );
    }
  }
  const { artifact, contentBase64 } = await backend.readReceivedBackgroundArtifact(
    entry.id,
    expected.id,
  );
  if (
    artifact.id !== expected.id ||
    artifact.relativePath !== expected.relativePath ||
    artifact.bytes !== expected.bytes ||
    artifact.contentHash !== expected.contentHash ||
    contentBase64.length > Math.ceil((8 * 1024 * 1024) / 3) * 4
  )
    throw new Error("Artifact differs from the received manifest");
  const bytes = Uint8Array.from(atob(contentBase64), (char) => char.charCodeAt(0));
  if (
    bytes.length > 8 * 1024 * 1024 ||
    bytes.length !== expected.bytes ||
    sha256Hex(bytes) !== expected.contentHash
  )
    throw new Error("Artifact failed integrity verification");
  const path = `background-results/${entry.requestId}/${expected.id}/${expected.relativePath}`;
  if (!isCurrent()) throw new Error("Artifact transfer left its original inbox view");
  const saved = await invokeNative<{ path: string; bytesWritten: number; contentHash: string }>(
    "fs_create_binary",
    {
      workdir,
      path,
      content_base64: contentBase64,
      expected_content_hash: expected.contentHash,
    },
  );
  if (!isCurrent()) throw new Error("Artifact transfer left its original inbox view");
  if (
    saved.path !== path ||
    saved.bytesWritten !== expected.bytes ||
    saved.contentHash !== expected.contentHash
  )
    throw new Error(
      "Local artifact write returned inconsistent evidence; inspect the destination before retrying",
    );
  return saved;
}
