import { getLanPcCommandHostConfig, invokeNative, isTauriRuntime } from "@xgent/runtime";
import {
  captureLanPcCommandRouter,
  type LanPcCommandHostConfig,
} from "../../runtime/lanPcCommandHost";
import type { XgentRuntime } from "../../runtime/types";
import { readWorkspaceFileSource, type WorkspaceFileSource } from "./workspaceFileSource";

export type ToolCommandPort = Pick<XgentRuntime, "invoke" | "homeDir" | "listen"> & {
  registerMcpServerRoute?: (server: { id: string; transport?: string }) => void;
  resolveFileSource?: (workdir: string) => Promise<WorkspaceFileSource>;
};

/** Capture before loading the native adapter, so concurrent UI changes cannot
 * change execution, path mapping or cancellation ownership during this run. */
export async function captureToolCommandPort(
  config: LanPcCommandHostConfig = getLanPcCommandHostConfig(),
): Promise<ToolCommandPort | undefined> {
  if (!isTauriRuntime()) return undefined;
  const router = captureLanPcCommandRouter(config);
  const { createTauriRuntime } = await import("../../runtime/tauri");
  const runtime = createTauriRuntime(router);
  return {
    ...runtime,
    registerMcpServerRoute: router.registerMcpServerRoute,
    async resolveFileSource(workdir) {
      const delegated = router.shouldDelegateCommandToLanPc("fs_path_status", { workdir });
      const host = await (delegated ? runtime.invoke : invokeNative)<{ hostId: string }>(
        delegated ? "automation_background_host_info" : "automation_device_identity",
        {},
      );
      const source = readWorkspaceFileSource({
        version: 1,
        hostId: host.hostId,
        workdir: delegated
          ? router.prepareLanPcInvokeArgs({ workdir }, "fs_path_status").workdir
          : workdir,
      });
      if (!source) throw new Error("The execution device did not provide a valid file source.");
      return source;
    },
  };
}
