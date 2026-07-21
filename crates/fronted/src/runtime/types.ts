export type RuntimeEvent<T> = {
  payload: T;
};

export type RuntimeUnlisten = () => void;

export type RuntimeInvokeArgs = Record<string, unknown>;

export type RuntimeFileDropEvent =
  | { type: "enter" | "over" | "leave" }
  | { type: "drop"; paths: string[] };

export interface XAgentRuntime {
  invoke<T>(command: string, args?: RuntimeInvokeArgs): Promise<T>;
  listen<T>(event: string, handler: (event: RuntimeEvent<T>) => void): Promise<RuntimeUnlisten>;
  openUrl(url: string): Promise<void>;
  revealItemInDir(path: string): Promise<void>;
  homeDir(): Promise<string>;
  listenFileDrop(handler: (event: RuntimeFileDropEvent) => void): Promise<RuntimeUnlisten>;
}
