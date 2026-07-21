import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { homeDir as tauriHomeDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  openUrl as tauriOpenUrl,
  revealItemInDir as tauriRevealItemInDir,
} from "@tauri-apps/plugin-opener";

import type {
  RuntimeEvent,
  RuntimeFileDropEvent,
  RuntimeInvokeArgs,
  RuntimeUnlisten,
  XAgentRuntime,
} from "./types";

export const tauriRuntime: XAgentRuntime = {
  invoke<T>(command: string, args?: RuntimeInvokeArgs) {
    return tauriInvoke<T>(command, args);
  },

  listen<T>(event: string, handler: (event: RuntimeEvent<T>) => void) {
    return tauriListen<T>(event, handler);
  },

  openUrl(url: string) {
    return tauriOpenUrl(url);
  },

  revealItemInDir(path: string) {
    return tauriRevealItemInDir(path);
  },

  homeDir() {
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
