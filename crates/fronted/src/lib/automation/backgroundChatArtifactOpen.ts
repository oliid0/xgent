import { getLanPcCommandHostConfig, invokeNative, isTauriRuntime } from "@xgent/runtime";
import { readBackgroundChatArtifact } from "../chat/messages/backgroundArtifacts";
import { readWorkspaceFileSource, type WorkspaceFileSource } from "../tools/workspaceFileSource";
import { saveInboxArtifact } from "./backgroundInboxArtifacts";
import type { BackgroundArtifact } from "./types";

type Saved = { path: string; bytesWritten: number; contentHash: string };
type Checked = {
  artifact: BackgroundArtifact;
  saved: Saved | null;
  receiverHostId: string;
  sourceHostId: string;
  entryId: string;
  snapshotHash: string;
};
const pending = new Map<string, Promise<{ path: string; fileSource: WorkspaceFileSource }>>();

/** Resolve only the original receiver's real retained artifact; never use the
 * selected remote workspace as a destination or a manifest as file bytes. */
export async function openBackgroundChatArtifact(
  value: unknown,
  localWorkdir: string,
  isCurrent: () => boolean,
) {
  const ref = readBackgroundChatArtifact(value);
  const current = () => {
    if (!isCurrent()) throw new Error("Artifact left its original conversation");
  };
  current();
  if (!ref || !isTauriRuntime())
    throw new Error("Original received artifacts require the native app");
  const route = getLanPcCommandHostConfig();
  const workdir = route.enabled ? (route.localWorkdir ?? "") : localWorkdir;
  const source = readWorkspaceFileSource({ version: 1, hostId: ref.receiverHostId, workdir });
  if (!source) throw new Error("A local receiving workspace is required");
  const identity = await invokeNative<{ hostId: string }>("automation_device_identity", {});
  current();
  if (identity.hostId !== ref.receiverHostId)
    throw new Error("This artifact belongs to its original receiving device");
  const key = JSON.stringify([ref, workdir]);
  let operation = pending.get(key);
  if (!operation) {
    operation = (async () => {
      const path = `background-results/${ref.requestId}/${ref.artifact.id}/${ref.artifact.relativePath}`;
      const check = async () => {
        current();
        const actual = await invokeNative<Checked>("automation_result_chat_artifact", {
          conversation_id: ref.conversationId,
          request_id: ref.requestId,
          entry_id: ref.entryId,
          artifact_id: ref.artifact.id,
          workdir,
        });
        current();
        if (
          actual.receiverHostId !== ref.receiverHostId ||
          actual.sourceHostId !== ref.sourceHostId ||
          actual.entryId !== ref.entryId ||
          actual.snapshotHash !== ref.snapshotHash ||
          actual.artifact.id !== ref.artifact.id ||
          actual.artifact.relativePath !== ref.artifact.relativePath ||
          actual.artifact.bytes !== ref.artifact.bytes ||
          actual.artifact.contentHash !== ref.artifact.contentHash
        )
          throw new Error("Original artifact manifest or receipt changed");
        if (
          actual.saved !== null &&
          (actual.saved.path !== path ||
            actual.saved.bytesWritten !== ref.artifact.bytes ||
            actual.saved.contentHash !== ref.artifact.contentHash)
        )
          throw new Error("Local artifact identity could not be verified");
        return actual.saved;
      };
      if (!(await check())) {
        try {
          await saveInboxArtifact(
            { id: ref.entryId, requestId: ref.requestId },
            ref.artifact,
            workdir,
            isCurrent,
          );
        } catch (error) {
          // Another authorized inbox view may have atomically published the
          // same file. An exception alone is never evidence of saved bytes.
          current();
          if (!(await check())) throw error;
        }
        if (!(await check())) throw new Error("Saved artifact is unavailable");
      }
      current();
      return { path, fileSource: source };
    })();
    pending.set(key, operation);
    void operation
      .finally(() => {
        if (pending.get(key) === operation) pending.delete(key);
      })
      .catch(() => {});
  }
  const result = await operation;
  current();
  return result;
}
