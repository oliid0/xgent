import type { TrajectoryEvent } from "./types";

export function createTrajectoryLiveStore(options?: { notifyDelayMs?: number }) {
  const events = new Map<string, TrajectoryEvent[]>();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const notify = () => {
    if (timer !== undefined) return;
    const delay = Math.max(0, options?.notifyDelayMs ?? 0);
    timer = setTimeout(() => {
      timer = undefined;
      for (const listener of listeners) listener();
    }, delay);
  };

  return {
    append(conversationId: string, next: readonly TrajectoryEvent[]) {
      if (next.length === 0) return;
      events.set(conversationId, [...(events.get(conversationId) ?? []), ...next].slice(-4_096));
      notify();
    },
    getSnapshot(conversationId: string): readonly TrajectoryEvent[] {
      return events.get(conversationId) ?? [];
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear(conversationId: string) {
      events.delete(conversationId);
      notify();
    },
    invalidate: notify,
  };
}
