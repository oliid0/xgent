import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { homeDir as tauriHomeDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  openUrl as tauriOpenUrl,
  revealItemInDir as tauriRevealItemInDir,
} from "@tauri-apps/plugin-opener";

import {
  getLanPcCommandHostConfig,
  LAN_PC_RELAY_EVENT,
  prepareLanPcInvokeArgs,
  shouldDelegateCommandToLanPc,
  shouldDelegateEventToLanPc,
} from "./lanPcCommandHost";
import type {
  RuntimeEvent,
  RuntimeFileDropEvent,
  RuntimeInvokeArgs,
  RuntimeUnlisten,
  XAgentRuntime,
} from "./types";

export const tauriRuntime: XAgentRuntime = {
  invoke<T>(command: string, args?: RuntimeInvokeArgs) {
    if (shouldDelegateCommandToLanPc(command, args)) {
      const host = getLanPcCommandHostConfig();
      return tauriInvoke<T>("lan_pc_invoke", {
        base_url: host.baseUrl,
        command,
        args: prepareLanPcInvokeArgs(args),
      });
    }
    return tauriInvoke<T>(command, args);
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
        handler({ type: "drop", paths: event.payload.paths });
        return;
      }
      handler({ type: event.payload.type });
    });
  },
};
