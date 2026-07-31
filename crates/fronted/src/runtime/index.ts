import type {
  RuntimeEvent,
  RuntimeFileDropEvent,
  RuntimeInvokeArgs,
  RuntimeUnlisten,
  XAgentRuntime,
} from "./types";

type TauriWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

export function isTauriRuntime() {
  if (typeof window === "undefined") return false;
  const runtimeWindow = window as TauriWindow;
  return runtimeWindow.__TAURI__ !== undefined || runtimeWindow.__TAURI_INTERNALS__ !== undefined;
}

export function isBrowserRuntime() {
  return typeof window !== "undefined" && !isTauriRuntime();
}

let runtimePromise: Promise<XAgentRuntime> | undefined;

function loadRuntime(): Promise<XAgentRuntime> {
  runtimePromise ??= isTauriRuntime()
    ? import("./tauri").then(({ tauriRuntime }) => tauriRuntime)
    : import("./browser").then(({ browserRuntime }) => browserRuntime);
  return runtimePromise;
}

export async function invoke<T>(command: string, args?: RuntimeInvokeArgs): Promise<T> {
  return (await loadRuntime()).invoke<T>(command, args);
}

export async function listen<T>(
  event: string,
  handler: (event: RuntimeEvent<T>) => void,
): Promise<RuntimeUnlisten> {
  return (await loadRuntime()).listen(event, handler);
}

export async function openUrl(url: string): Promise<void> {
  return (await loadRuntime()).openUrl(url);
}

export async function revealItemInDir(path: string): Promise<void> {
  return (await loadRuntime()).revealItemInDir(path);
}

export async function homeDir(): Promise<string> {
  return (await loadRuntime()).homeDir();
}

export async function listenFileDrop(
  handler: (event: RuntimeFileDropEvent) => void,
): Promise<RuntimeUnlisten> {
  return (await loadRuntime()).listenFileDrop(handler);
}

export type { RuntimeEvent, RuntimeFileDropEvent, RuntimeUnlisten } from "./types";
export {
  configureLanPcCommandHost,
  getLanPcCommandHostConfig,
  isLanPcCommandHostReady,
  LAN_PC_SESSION_CHANGED_EVENT,
} from "./lanPcCommandHost";
