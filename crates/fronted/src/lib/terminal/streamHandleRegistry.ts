import type { TerminalStreamChunk } from "./types";

export function createTerminalStreamHandleRegistry<
  THandle extends { sessionId: string; accept(chunk: TerminalStreamChunk): void },
>() {
  const handles = new Map<string, Set<THandle>>();
  return {
    add(sessionId: string, handle: THandle) {
      const bucket = handles.get(sessionId) ?? new Set<THandle>();
      bucket.add(handle);
      handles.set(sessionId, bucket);
    },
    remove(sessionId: string, handle: THandle) {
      const bucket = handles.get(sessionId);
      if (!bucket) return;
      bucket.delete(handle);
      if (bucket.size === 0) handles.delete(sessionId);
    },
    dispatch(chunk: TerminalStreamChunk) {
      for (const handle of handles.get(chunk.sessionId) ?? []) handle.accept(chunk);
    },
  };
}
