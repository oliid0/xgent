export type RuntimeEvent<T> = {
  payload: T;
};

export type RuntimeUnlisten = () => void;

export type RuntimeInvokeArgs = Record<string, unknown>;

export type RuntimeFileDropEvent =
  | { type: "enter" | "over"; position: { x: number; y: number } }
  | { type: "leave" }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } };

export interface XgentRuntime {
  invoke<T>(command: string, args?: RuntimeInvokeArgs): Promise<T>;
  listen<T>(event: string, handler: (event: RuntimeEvent<T>) => void): Promise<RuntimeUnlisten>;
  openUrl(url: string): Promise<void>;
  revealItemInDir(path: string): Promise<void>;
  homeDir(): Promise<string>;
  listenFileDrop(handler: (event: RuntimeFileDropEvent) => void): Promise<RuntimeUnlisten>;
}
