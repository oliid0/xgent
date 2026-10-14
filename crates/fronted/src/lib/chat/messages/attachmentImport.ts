import { getLanPcCommandHostConfig, invoke, invokeNative, isTauriRuntime } from "@xgent/runtime";
import { prepareLanPcInvokeArgs } from "../../../runtime/lanPcCommandHost";
import { snapshotBackgroundInputs } from "../../automation/backgroundInputs";
import { createUuid } from "../../shared/id";
import type { PendingUploadedFile } from "./uploadedFiles";

export type AttachmentImportResponse = { files: PendingUploadedFile[]; skipped: string[] };
export type AttachmentImportTarget = {
  native: boolean;
  localWorkdir: string;
  remoteWorkdir: string;
  baseUrl: string;
  routeKey: string;
};
type ImportCommand =
  | "system_import_uploaded_readable_files"
  | "system_import_pasted_texts"
  | "system_import_readable_file_paths"
  | "system_pick_readable_files";

function routeKey() {
  const host = getLanPcCommandHostConfig();
  return JSON.stringify([host.enabled, host.baseUrl, host.localWorkdir, host.remoteWorkdir]);
}

/** Capture before picker/decoder awaits. Never mutate the global command host. */
export function captureAttachmentImportTarget(workdir: string): AttachmentImportTarget {
  const native = isTauriRuntime(),
    host = getLanPcCommandHostConfig();
  const paired = native && host.enabled;
  const localWorkdir = paired ? host.localWorkdir : workdir;
  if (!localWorkdir?.trim() || (paired && (!host.baseUrl || !host.remoteWorkdir)))
    throw new Error(
      "Attachment import requires the initiating device's local workspace and a configured peer workspace",
    );
  return {
    native,
    localWorkdir,
    remoteWorkdir: paired ? String(prepareLanPcInvokeArgs({ workdir }).workdir) : "",
    baseUrl: paired ? host.baseUrl : "",
    routeKey: routeKey(),
  };
}

export function isAttachmentImportTargetCurrent(target: AttachmentImportTarget) {
  return !target.native || target.routeKey === routeKey();
}

function requireCurrent(target: AttachmentImportTarget, isCurrent: () => boolean) {
  if (!isAttachmentImportTargetCurrent(target) || !isCurrent())
    throw new Error("Attachment import target changed; select the files again");
}

/** Import on the source device, then relay exact saved bytes to the pinned PC.
 * Existing authenticated RPC/create_new and native path permissions stay authoritative. */
export async function importAttachments(
  target: AttachmentImportTarget,
  command: ImportCommand,
  args: Record<string, unknown>,
  isCurrent: () => boolean = () => true,
): Promise<AttachmentImportResponse> {
  requireCurrent(target, isCurrent);
  const result = await (target.native ? invokeNative : invoke)<AttachmentImportResponse>(command, {
    ...args,
    workdir: target.localWorkdir,
  });
  requireCurrent(target, isCurrent);
  const files: PendingUploadedFile[] = [];
  const batchId = createUuid();
  for (const [index, file] of result.files.entries()) {
    requireCurrent(target, isCurrent);
    // Keep existing large single-device uploads usable. Background/native peer
    // snapshots enforce their existing 8 MiB bound rather than truncating them.
    if (!target.native || (!target.baseUrl && file.sizeBytes > 8 * 1024 * 1024)) {
      files.push(file);
      continue;
    }
    const sourcePath = file.absolutePath || file.relativePath;
    const [snapshot] = await snapshotBackgroundInputs(
      [{ path: sourcePath, name: "attachment" }],
      target.localWorkdir,
    );
    requireCurrent(target, isCurrent);
    if (snapshot.bytes !== file.sizeBytes)
      throw new Error("Attachment import returned a different saved file size");
    const localSource = {
      version: 1 as const,
      workdir: target.localWorkdir,
      path: sourcePath,
      bytes: snapshot.bytes,
      contentHash: snapshot.contentHash,
    };
    if (!target.baseUrl) {
      files.push({ ...file, localSource });
      continue;
    }
    const extension = /\.[a-zA-Z0-9]{1,12}$/.exec(file.fileName)?.[0] ?? "";
    const path = `uploads/${batchId}/input-${index + 1}${extension}`;
    const saved = await invokeNative<{ path: string; bytesWritten: number; contentHash: string }>(
      "lan_pc_invoke",
      {
        base_url: target.baseUrl,
        command: "fs_create_binary",
        args: {
          workdir: target.remoteWorkdir,
          path,
          content_base64: snapshot.contentBase64,
          expected_content_hash: snapshot.contentHash,
        },
      },
    );
    requireCurrent(target, isCurrent);
    if (
      saved.path !== path ||
      saved.bytesWritten !== snapshot.bytes ||
      saved.contentHash !== snapshot.contentHash
    )
      throw new Error(
        "Peer attachment write returned inconsistent evidence; inspect the destination before retrying",
      );
    const separator =
      target.remoteWorkdir.includes("\\") && !target.remoteWorkdir.includes("/") ? "\\" : "/";
    files.push({
      ...file,
      relativePath: path,
      absolutePath: `${target.remoteWorkdir.replace(/[\\/]+$/, "")}${separator}${path.replaceAll("/", separator)}`,
      localSource,
    });
  }
  return { files, skipped: result.skipped };
}
