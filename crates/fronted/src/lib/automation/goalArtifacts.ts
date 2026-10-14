import { invokeNative, isTauriRuntime } from "@xgent/runtime";
import { createUuid } from "../shared/id";
import { sha256Hex } from "../trajectory/sha256";
import type { GoalArtifact } from "./goals";
import type { BackgroundArtifactContent } from "./types";

export type GoalArtifactTransfer =
  | { status: "saved"; path: string; bytesWritten: number; contentHash: string }
  | { status: "download_requested" };

export function sameGoalArtifact(left: GoalArtifact, right: GoalArtifact) {
  return (
    left.id === right.id &&
    left.requestId === right.requestId &&
    left.relativePath === right.relativePath &&
    left.contentHash === right.contentHash &&
    left.bytes === right.bytes
  );
}

/** Owner-pinned bytes have to match the displayed immutable manifest before any local write. */
export async function transferGoalArtifact(
  goalId: string,
  expected: GoalArtifact,
  content: BackgroundArtifactContent,
  workdir: string,
  isCurrent: () => boolean,
): Promise<GoalArtifactTransfer> {
  const { artifact, contentBase64 } = content,
    identity = /^[a-zA-Z0-9_-]{1,80}$/;
  const parts = expected.relativePath.split("/");
  if (
    !identity.test(goalId) ||
    !identity.test(expected.requestId) ||
    !identity.test(expected.id) ||
    !Number.isSafeInteger(expected.bytes) ||
    expected.bytes < 0 ||
    expected.bytes > 8 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(expected.contentHash) ||
    expected.relativePath.length > 1024 ||
    parts.some((part) => !part || part === "." || part === "..") ||
    /[\\:]/.test(expected.relativePath) ||
    Array.from(expected.relativePath).some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    }) ||
    artifact.id !== expected.id ||
    artifact.relativePath !== expected.relativePath ||
    artifact.bytes !== expected.bytes ||
    artifact.contentHash !== expected.contentHash ||
    typeof contentBase64 !== "string" ||
    contentBase64.length > Math.ceil((8 * 1024 * 1024) / 3) * 4
  )
    throw new Error("goals.artifactChanged");
  const bytes = Uint8Array.from(atob(contentBase64), (char) => char.charCodeAt(0));
  if (bytes.length !== expected.bytes || sha256Hex(bytes) !== expected.contentHash)
    throw new Error("goals.artifactChanged");
  if (!isCurrent()) throw new Error("goals.ownerChanged");
  if (isTauriRuntime()) {
    if (!workdir.trim()) throw new Error("goals.localWorkspaceRequired");
    // A new local transfer directory preserves existing files; fs_create_binary also uses create_new.
    const path = `goal-results/${goalId}/${expected.requestId}/${expected.id}/${createUuid()}/${expected.relativePath}`;
    const saved = await invokeNative<{ path: string; bytesWritten: number; contentHash: string }>(
      "fs_create_binary",
      { workdir, path, content_base64: contentBase64, expected_content_hash: expected.contentHash },
    );
    if (
      saved.path !== path ||
      saved.bytesWritten !== expected.bytes ||
      saved.contentHash !== expected.contentHash
    )
      throw new Error("goals.saveUnconfirmed");
    return { status: "saved", ...saved };
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = parts.at(-1) ?? expected.id;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  // Browser download initiation is not proof that the user saved the file.
  return { status: "download_requested" };
}
