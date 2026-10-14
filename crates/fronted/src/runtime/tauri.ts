import { addPluginListener, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { homeDir as tauriHomeDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  openUrl as tauriOpenUrl,
  revealItemInDir as tauriRevealItemInDir,
} from "@tauri-apps/plugin-opener";

import {
  type captureLanPcCommandRouter,
  clearMcpRunRoute,
  getLanPcCommandHostConfig,
  isLanPcCommandHostReady,
  prepareLanPcInvokeArgs,
  registerMcpRunRoute,
  registerMcpServerRoute,
  registerMcpServerRoutes,
  shouldDelegateCommandToLanPc,
  shouldDelegateEventToLanPc,
} from "./lanPcCommandHost";
import { listenLanPcEvent } from "./lanPcEventSubscription";
import type {
  RuntimeEvent,
  RuntimeFileDropEvent,
  RuntimeInvokeArgs,
  RuntimeUnlisten,
  XgentRuntime,
} from "./types";

// Device-owned permissions, journals and worker leases must bypass peer routing.
export { tauriInvoke as invokeNative, tauriListen as listenNative };

export function getNativeWindowLabel() {
  return getCurrentWindow().label;
}

export async function listenNativePlugin<T>(
  plugin: string,
  event: string,
  handler: (event: T) => void,
) {
  const listener = await addPluginListener<T>(plugin, event, handler);
  return () => listener.unregister();
}

export function createTauriRuntime(
  router: ReturnType<typeof captureLanPcCommandRouter> = {
    clearMcpRunRoute,
    getLanPcCommandHostConfig,
    isLanPcCommandHostReady,
    prepareLanPcInvokeArgs,
    registerMcpRunRoute,
    registerMcpServerRoute,
    registerMcpServerRoutes,
    shouldDelegateCommandToLanPc,
    shouldDelegateEventToLanPc,
  },
): XgentRuntime {
  const {
    clearMcpRunRoute,
    getLanPcCommandHostConfig,
    isLanPcCommandHostReady,
    prepareLanPcInvokeArgs,
    registerMcpRunRoute,
    registerMcpServerRoute,
    registerMcpServerRoutes,
    shouldDelegateCommandToLanPc,
    shouldDelegateEventToLanPc,
  } = router;
  return {
    async invoke<T>(command: string, args?: RuntimeInvokeArgs) {
      if (
        command === "mcp_list_tools" &&
        isLanPcCommandHostReady() &&
        Array.isArray(args?.servers)
      ) {
        const servers = args.servers as Array<{ id: string; transport?: string }>;
        registerMcpServerRoutes(servers);
        const local = servers.filter(
          (server) => server.transport !== undefined && server.transport !== "stdio",
        );
        const remote = servers.filter(
          (server) => !server.transport || server.transport === "stdio",
        );
        if (local.length > 0 && remote.length > 0) {
          const host = getLanPcCommandHostConfig();
          const outcomes = await Promise.allSettled([
            tauriInvoke<unknown[]>(command, { servers: local }),
            tauriInvoke<unknown[]>("lan_pc_invoke", {
              base_url: host.baseUrl,
              ...(host.peerId ? { peer_id: host.peerId } : {}),
              command,
              args: prepareLanPcInvokeArgs({ servers: remote }, command),
            }),
          ]);
          const tools: unknown[] = [];
          const errors: string[] = [];
          for (const outcome of outcomes) {
            if (outcome.status === "fulfilled") tools.push(...outcome.value);
            else errors.push(String(outcome.reason));
          }
          if (errors.length === outcomes.length) throw new Error(errors.join("\n"));
          if (errors.length > 0)
            console.warn("[MCP] one command host could not list tools", errors);
          return tools as T;
        }
      }
      if (
        (command === "mcp_test_server" || command === "mcp_restart_server") &&
        typeof args?.server === "object" &&
        args.server !== null
      ) {
        registerMcpServerRoute(args.server as { id: string; transport?: string });
      }
      const delegated = shouldDelegateCommandToLanPc(command, args);
      const runId =
        typeof args?.run_id === "string" && !/(?:cancel|stop)$/.test(command) ? args.run_id : "";
      if (runId) registerMcpRunRoute(runId, delegated);
      const host = getLanPcCommandHostConfig();
      const result = delegated
        ? await tauriInvoke<T>("lan_pc_invoke", {
            base_url: host.baseUrl,
            ...(host.peerId ? { peer_id: host.peerId } : {}),
            command,
            args: prepareLanPcInvokeArgs(args, command),
          })
        : await tauriInvoke<T>(command, args);
      // A rejected transport does not prove that a run was never accepted.
      // Retain its cancellation route in this task's port until it is released.
      if (runId) clearMcpRunRoute(runId);
      return result;
    },

    async listen<T>(event: string, handler: (event: RuntimeEvent<T>) => void) {
      if (shouldDelegateEventToLanPc(event)) {
        const host = getLanPcCommandHostConfig();
        return listenLanPcEvent(
          { invoke: tauriInvoke, listen: tauriListen },
          host.baseUrl,
          event,
          handler,
          host.peerId,
        );
      }
      return tauriListen<T>(event, handler);
    },

    openUrl(url: string) {
      return tauriOpenUrl(url);
    },

    revealItemInDir(path: string) {
      return tauriRevealItemInDir(path);
    },

    homeDir() {
      const host = getLanPcCommandHostConfig();
      if (host.enabled && host.remoteHomeDir) return Promise.resolve(host.remoteHomeDir);
      return tauriHomeDir();
    },

    listenFileDrop(handler: (event: RuntimeFileDropEvent) => void): Promise<RuntimeUnlisten> {
      return getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          handler({
            type: "drop",
            paths: event.payload.paths,
            position: event.payload.position,
          });
          return;
        }
        if (event.payload.type === "enter" || event.payload.type === "over") {
          handler({ type: event.payload.type, position: event.payload.position });
          return;
        }
        handler({ type: "leave" });
      });
    },
  };
}

export const tauriRuntime: XgentRuntime = createTauriRuntime();
