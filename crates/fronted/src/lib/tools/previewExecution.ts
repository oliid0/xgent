import { getLanPcCommandHostConfig, invoke } from "@xgent/runtime";
import type { RuntimeInvokeArgs } from "../../runtime/types";
import { invokeFs } from "./fsBackend";
import { captureToolCommandPort, type ToolCommandPort } from "./toolCommandPort";
import {
  readWorkspaceFileSource,
  restoreWorkspaceFilePort,
  type WorkspaceFileSource,
  workspaceFileSourceKey,
} from "./workspaceFileSource";

export type PreviewCommandPort = Pick<ToolCommandPort, "invoke" | "resolveFileSource"> & {
  fileSource?: WorkspaceFileSource;
};
export type PreviewExecution = {
  commandPort?: PreviewCommandPort;
  executionKey?: string;
  fileSource?: WorkspaceFileSource | null;
};

const ports = new WeakMap<PreviewCommandPort, string>();
const requests = new WeakMap<object, PreviewExecution>();
let sequence = 0;

export function invokePreviewFs<T>(
  request: PreviewExecution & { workdir: string },
  command: string,
  args: RuntimeInvokeArgs,
): Promise<T> {
  return invokeFs<T>(command, args, request.commandPort?.invoke);
}

/** Capture synchronously at admission, before file validation or UI effects await. */
export function bindPreviewExecution<T extends PreviewExecution>(request: T): T & PreviewExecution {
  const cached = requests.get(request);
  if (cached) return { ...request, ...cached };
  let commandPort = request.commandPort;
  if (!commandPort && request.fileSource)
    commandPort = restoreWorkspaceFilePort(request.fileSource);
  let executionKey = request.executionKey;
  if (commandPort) {
    const source = readWorkspaceFileSource(commandPort.fileSource);
    executionKey = source
      ? `preview-source:${workspaceFileSourceKey(source)}`
      : (ports.get(commandPort) ?? `preview-port:${++sequence}`);
  } else {
    const config = { ...getLanPcCommandHostConfig() };
    // Retain a failed capture as a failed read; never fall back to a different device.
    const ready = captureToolCommandPort(config).then(
      (port) => ({ port }),
      (error: unknown) => ({ error }),
    );
    commandPort = {
      async resolveFileSource(workdir) {
        const captured = await ready;
        if ("error" in captured) throw captured.error;
        if (!captured.port?.resolveFileSource)
          throw new Error("File source identity is unavailable.");
        return captured.port.resolveFileSource(workdir);
      },
      async invoke<T>(command: string, args?: RuntimeInvokeArgs): Promise<T> {
        const captured = await ready;
        if ("error" in captured) throw captured.error;
        return captured.port ? captured.port.invoke<T>(command, args) : invoke<T>(command, args);
      },
    };
    executionKey = JSON.stringify([
      "preview-host",
      config.enabled,
      config.enabled ? config.baseUrl : "",
      config.enabled ? config.localWorkdir : "",
      config.enabled ? config.remoteWorkdir : "",
    ]);
  }
  ports.set(commandPort, executionKey);
  const execution = { commandPort, executionKey };
  requests.set(request, execution);
  return { ...request, ...execution };
}
