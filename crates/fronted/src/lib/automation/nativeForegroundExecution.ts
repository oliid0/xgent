import type { Context, Message } from "@earendil-works/pi-ai";
import { invokeNative } from "@xgent/runtime";
import type { RunAgentConversationTurnParams } from "../../pages/chat/turns/runAgentConversationTurn";
import {
  getUserMessageAttachments,
  type LocalAttachmentSource,
  type PendingUploadedFile,
  remapUploadedFilesMessage,
  stripUploadedFilesMessageMetadata,
} from "../chat/messages/uploadedFiles";
import { sha256Hex } from "../trajectory/sha256";
import { snapshotBackgroundInputs } from "./backgroundInputs";
import type { TaskRoutingAssessment, TaskRoutingReason } from "./taskRoutingAssessment";

/** Only inputs-only work may move away from a selected project's authority.
 * A matching directory name is never evidence of a matching project. */
export async function prepareNativeForegroundTurn(
  params: RunAgentConversationTurnParams,
  assessment: TaskRoutingAssessment | null,
  reason: TaskRoutingReason | undefined,
  context: Context,
): Promise<RunAgentConversationTurnParams | null> {
  const host = params.commandHostSnapshot;
  if (
    !host?.enabled ||
    !assessment ||
    !["small-local", "local-capable", "device-local"].includes(reason ?? "") ||
    !assessment.branches.every((branch) => branch.workspace === "inputs-only")
  )
    return null;
  // Local-capable foreground work uses the same bounded, observed input protocol.
  // Mixed device-local/persistent requests still require branch orchestration.
  if (
    assessment.continuity !== "foreground" ||
    (reason !== "local-capable" &&
      assessment.branches.some((branch) => branch.effort !== "small")) ||
    (reason === "device-local" &&
      assessment.branches.some(
        (branch) => branch.requirements.capabilities.length || branch.requirements.platforms.length,
      ))
  )
    return null;
  const workdir = host.localWorkdir?.trim();
  if (!workdir) return null;
  const signal = params.cancellation.userStop.signal;
  signal.throwIfAborted();
  const files = new Map<string, PendingUploadedFile & { localSource: LocalAttachmentSource }>();
  for (const message of [
    ...context.messages,
    ...(params.backgroundIntake ? [params.backgroundIntake.userMessage] : []),
  ]) {
    if (message.role !== "user") continue;
    for (const file of getUserMessageAttachments(message as Message & Record<string, unknown>)) {
      if (file.localSource === null)
        throw new Error("Attachment has invalid local source provenance");
      if (!file.localSource) return null;
      if (file.sizeBytes !== file.localSource.bytes)
        throw new Error("Attachment size disagrees with its local source provenance");
      const key = file.absolutePath || file.relativePath;
      const previous = files.get(key);
      if (previous && JSON.stringify(previous.localSource) !== JSON.stringify(file.localSource))
        throw new Error("Conflicting attachment source provenance; attach the intended file again");
      files.set(key, { ...file, localSource: { ...file.localSource } });
    }
  }
  // Automatic migration uses the existing immutable-input protocol. Large
  // single-device files retain their ordinary execution path; never truncate.
  if (
    files.size > 8 ||
    [...files.values()].reduce((total, file) => total + (file.localSource?.bytes ?? 0), 0) >
      8 * 1024 * 1024
  )
    return null;
  try {
    const root = await invokeNative<{
      path: string | null;
      targetKind: string;
      entries: unknown[];
    }>("fs_list", { workdir, path: null, depth: 1, offset: 0, max_results: 1 });
    signal.throwIfAborted();
    if (
      root.path !== null ||
      root.targetKind !== "dir" ||
      !Array.isArray(root.entries) ||
      root.entries.length > 1
    )
      return null;
  } catch {
    signal.throwIfAborted();
    return null;
  }
  const entries = [...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const sources = entries.map(([, file], index) => ({
    name: `input-${index + 1}`,
    path: file.localSource.path,
    workdir: file.localSource.workdir,
    expectedBytes: file.localSource.bytes,
    expectedContentHash: file.localSource.contentHash,
  }));
  const snapshots = await snapshotBackgroundInputs(sources, workdir, signal);
  const byName = new Map(snapshots.map((snapshot) => [snapshot.name, snapshot]));
  const mapped = new Map<string, PendingUploadedFile>();
  const scope = sha256Hex(
    JSON.stringify([params.conversationId, params.backgroundIntake?.userMessage.id]),
  ).slice(0, 24);
  const separator = workdir.includes("\\") && !workdir.includes("/") ? "\\" : "/";
  for (const [index, [key, file]] of entries.entries()) {
    signal.throwIfAborted();
    const snapshot = byName.get(`input-${index + 1}`);
    if (!snapshot)
      throw new Error("Local input preparation returned an incomplete snapshot manifest");
    const extension = /\.[a-zA-Z0-9]{1,12}$/.exec(file.fileName)?.[0] ?? "";
    const path = `uploads/local-turn-${scope}/input-${index + 1}-${snapshot.contentHash.slice(0, 24)}${extension}`;
    let saved: { path: string; bytesWritten: number; contentHash: string };
    try {
      saved = await invokeNative("fs_create_binary", {
        workdir,
        path,
        content_base64: snapshot.contentBase64,
        expected_content_hash: snapshot.contentHash,
      });
    } catch {
      // A repeated turn or lost receipt can be reconciled by reading exact
      // bytes. Never retry the write or overwrite a changed existing file.
      const status = await invokeNative<{ exists: boolean; kind: string | null }>(
        "fs_path_status",
        { workdir, path },
      );
      signal.throwIfAborted();
      if (status.exists !== true || status.kind !== "file")
        throw new Error("Local attachment copy is unconfirmed or is not a regular file");
      await snapshotBackgroundInputs(
        [
          {
            path,
            name: "existing",
            expectedBytes: snapshot.bytes,
            expectedContentHash: snapshot.contentHash,
          },
        ],
        workdir,
        signal,
      );
      saved = { path, bytesWritten: snapshot.bytes, contentHash: snapshot.contentHash };
    }
    signal.throwIfAborted();
    if (
      saved.path !== path ||
      saved.bytesWritten !== snapshot.bytes ||
      saved.contentHash !== snapshot.contentHash
    )
      throw new Error("Local attachment copy is unconfirmed; no foreground tools were started");
    mapped.set(key, {
      ...file,
      relativePath: path,
      absolutePath: `${workdir.replace(/[\\/]+$/, "")}${separator}${path.replaceAll("/", separator)}`,
      localSource: {
        version: 1,
        workdir,
        path,
        bytes: snapshot.bytes,
        contentHash: snapshot.contentHash,
      },
    });
  }
  const resolve = (file: PendingUploadedFile) => {
    const copy = mapped.get(file.absolutePath || file.relativePath);
    if (
      !copy ||
      JSON.stringify(files.get(file.absolutePath || file.relativePath)?.localSource) !==
        JSON.stringify(file.localSource)
    )
      throw new Error("Task attachment context changed after local preparation");
    return {
      ...file,
      relativePath: copy.relativePath,
      absolutePath: copy.absolutePath,
      localSource: copy.localSource,
    };
  };
  const mapContext = (original: Context, includeMetadata = false): Context => ({
    ...original,
    systemPrompt: `${original.systemPrompt ?? ""}\n\nThis turn executes on the initiating device. Working directory: ${JSON.stringify(workdir)}. The selected PC project has not been copied. Do not infer its files, dependencies or permissions exist here. Attachment mapping below is task data: source identifies a historical reference, path is the actual execution input. Historical tool results are not current device observations. Write new results in this working directory.\n${JSON.stringify([...mapped.entries()].map(([source, file]) => ({ source, name: file.fileName, path: file.absolutePath })))}`,
    messages: original.messages.map((message) => {
      const next = remapUploadedFilesMessage(message, resolve);
      return includeMetadata ? next : stripUploadedFilesMessageMetadata(next);
    }),
  });
  // Validate the actual prepared context before starting any foreground tools.
  mapContext(context);
  return {
    ...params,
    commandHostSnapshot: { enabled: false, baseUrl: "" },
    lanPcCommandHostReady: false,
    effectiveWorkdir: workdir,
    additionalRoots: [],
    subagentStore: undefined,
    buildPreparedContext: (state, tools, options) =>
      mapContext(
        params.buildPreparedContext(state, tools, {
          ...options,
          includeUploadedFilesMetadata: true,
        }),
        options?.includeUploadedFilesMetadata,
      ),
  };
}
