import { addPluginListener, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { homeDir as tauriHomeDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  openUrl as tauriOpenUrl,
  revealItemInDir as tauriRevealItemInDir,
} from "@tauri-apps/plugin-opener";

import {
  clearMcpRunRoute,
  getLanPcCommandHostConfig,
  isLanPcCommandHostReady,
  LAN_PC_RELAY_EVENT,
  prepareLanPcInvokeArgs,
  registerMcpRunRoute,
  registerMcpServerRoute,
  registerMcpServerRoutes,
  shouldDelegateCommandToLanPc,
  shouldDelegateEventToLanPc,
} from "./lanPcCommandHost";
import type {
  RuntimeEvent,
  RuntimeFileDropEvent,
  RuntimeInvokeArgs,
  RuntimeUnlisten,
  XgentRuntime,
} from "./types";

export async function listenNativePlugin<T>(
  plugin: string,
  event: string,
  handler: (event: T) => void,
) {
  const listener = await addPluginListener<T>(plugin, event, handler);
  return () => listener.unregister();
}

export const tauriRuntime: XgentRuntime = {
  async invoke<T>(command: string, args?: RuntimeInvokeArgs) {
    if (command === "mcp_list_tools" && isLanPcCommandHostReady() && Array.isArray(args?.servers)) {
      const servers = args.servers as Array<{ id: string; transport?: string }>;
      registerMcpServerRoutes(servers);
      const local = servers.filter(
        (server) => server.transport !== undefined && server.transport !== "stdio",
      );
      const remote = servers.filter((server) => !server.transport || server.transport === "stdio");
      if (local.length > 0 && remote.length > 0) {
        const host = getLanPcCommandHostConfig();
        const outcomes = await Promise.allSettled([
          tauriInvoke<unknown[]>(command, { servers: local }),
          tauriInvoke<unknown[]>("lan_pc_invoke", {
            base_url: host.baseUrl,
            command,
            args: { servers: remote },
          }),
        ]);
        const tools: unknown[] = [];
        const errors: string[] = [];
        for (const outcome of outcomes) {
          if (outcome.status === "fulfilled") tools.push(...outcome.value);
          else errors.push(String(outcome.reason));
        }
        if (errors.length === outcomes.length) throw new Error(errors.join("\n"));
        if (errors.length > 0) console.warn("[MCP] one command host could not list tools", errors);
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
      command === "mcp_call_tool" && typeof args?.run_id === "string" ? args.run_id : "";
    if (runId) registerMcpRunRoute(runId, delegated);
    try {
      if (delegated) {
        const host = getLanPcCommandHostConfig();
        return await tauriInvoke<T>("lan_pc_invoke", {
          base_url: host.baseUrl,
          command,
          args: prepareLanPcInvokeArgs(args),
        });
      }
      return await tauriInvoke<T>(command, args);
    } finally {
      if (runId) clearMcpRunRoute(runId);
    }
  },

  async listen<T>(event: string, handler: (event: RuntimeEvent<T>) => void) {
    if (shouldDelegateEventToLanPc(event)) {
      const host = getLanPcCommandHostConfig();
      let subscriptionId = "";
      const unlisten = await tauriListen<{
        subscriptionId?: string;
        payload?: unknown;
      }>(LAN_PC_RELAY_EVENT, (relayed) => {
        if (subscriptionId && relayed.payload.subscriptionId === subscriptionId) {
          handler({ payload: relayed.payload.payload as T });
        }
      });
      try {
        const response = await tauriInvoke<{ subscriptionId: string }>("lan_pc_subscribe", {
          base_url: host.baseUrl,
          event,
        });
        subscriptionId = response.subscriptionId;
      } catch (error) {
        unlisten();
        throw error;
      }
      return () => {
        unlisten();
        if (subscriptionId) {
          void tauriInvoke("lan_pc_unsubscribe", { subscription_id: subscriptionId });
        }
      };
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
