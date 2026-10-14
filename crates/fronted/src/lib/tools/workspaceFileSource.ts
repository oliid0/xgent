import { invokeNative, isTauriRuntime } from "@xgent/runtime";
import type { RuntimeInvokeArgs } from "../../runtime/types";

export type WorkspaceFileSource = { version: 1; hostId: string; workdir: string };
const hostIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const WORKSPACE_FILE_COMMANDS = new Set([
  "fs_path_status",
  "fs_read_workspace_image",
  "fs_read_editable_text",
  "fs_write_text",
  "fs_write_docx_text",
  "fs_write_binary",
  "fs_file_applications",
  "fs_open_workspace_path",
]);

export function readWorkspaceFileSource(value: unknown): WorkspaceFileSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    source.version !== 1 ||
    typeof source.hostId !== "string" ||
    !hostIdPattern.test(source.hostId) ||
    typeof source.workdir !== "string" ||
    source.workdir.length > 32768 ||
    source.workdir.includes("\0") ||
    !/^(?:\/|[a-zA-Z]:[\\/]|\\\\)/.test(source.workdir)
  )
    return null;
  return { version: 1, hostId: source.hostId, workdir: source.workdir };
}

export function workspaceFileSourceKey(source: WorkspaceFileSource) {
  return JSON.stringify([source.hostId, source.workdir]);
}

/** Rehydrate identity and permissions through the native registry, never a saved URL/token. */
export function restoreWorkspaceFilePort(value: WorkspaceFileSource) {
  const source = readWorkspaceFileSource(value);
  if (!source) throw new Error("The file's original device and workspace could not be verified.");
  Object.freeze(source);
  return Object.freeze({
    fileSource: source,
    async resolveFileSource(workdir: string) {
      if (workdir !== source.workdir) throw new Error("File source workspace changed.");
      return { ...source };
    },
    async invoke<T>(command: string, args?: RuntimeInvokeArgs): Promise<T> {
      const operationArgs = { ...args };
      if (!isTauriRuntime())
        throw new Error("Opening an original-device file requires the native app.");
      if (!WORKSPACE_FILE_COMMANDS.has(command) || operationArgs.workdir !== source.workdir) {
        throw new Error("File operation does not belong to this source workspace.");
      }
      // Check the receiving device on each operation; a synchronized history is
      // not proof that an old 'local' file belongs to this installation.
      const host = await invokeNative<{ hostId: string }>("automation_device_identity", {});
      if (!hostIdPattern.test(host?.hostId))
        throw new Error("Current device identity is unavailable.");
      return host.hostId === source.hostId
        ? invokeNative<T>(command, operationArgs)
        : invokeNative<T>("worker_peer_file_invoke", {
            peer_id: source.hostId,
            command,
            args: operationArgs,
          });
    },
  });
}
