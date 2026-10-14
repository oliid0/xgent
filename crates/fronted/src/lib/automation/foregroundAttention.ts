import { invokeNative, isTauriRuntime } from "@xgent/runtime";
import { useEffect } from "react";
import { createUuid } from "../shared/id";

type AttentionInput = { sessionId: string; sequence: number; busy: boolean; issuedAt: number };
type AttentionPorts = {
  observe: (input: AttentionInput) => Promise<void>;
  isVisible: () => boolean;
  now: () => number;
  createId: () => string;
  subscribe: (refresh: () => void) => () => void;
};

/** Each visible occurrence owns its own scope; closing it cannot retire a
 * replacement. Native expiry releases attention even after a lost cleanup. */
export function startForegroundAttention(ports: AttentionPorts) {
  let stopped = false;
  let scope: { sessionId: string; sequence: number } | undefined;
  const send = (current: NonNullable<typeof scope>, busy: boolean) => {
    const input = {
      sessionId: current.sessionId,
      sequence: ++current.sequence,
      busy,
      issuedAt: ports.now(),
    };
    // Attention is bookkeeping, not a dependency of the user's coding turn.
    // Native sequence/closed fencing handles reordered or lost IPC replies.
    void ports
      .observe(input)
      .catch(() => console.warn("Foreground attention observation unavailable"));
  };
  const close = () => {
    const current = scope;
    scope = undefined;
    if (current) send(current, false);
  };
  const refresh = () => {
    if (stopped) return;
    if (!ports.isVisible()) {
      close();
      return;
    }
    scope ??= { sessionId: ports.createId(), sequence: 0 };
    send(scope, true);
  };
  const unsubscribe = ports.subscribe(refresh);
  const timer = setInterval(refresh, 10_000);
  refresh();
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    unsubscribe();
    close();
  };
}

export function useForegroundAttention(busy: boolean) {
  useEffect(() => {
    if (!busy || !isTauriRuntime()) return;
    return startForegroundAttention({
      observe: (input) => invokeNative<void>("automation_foreground_attention", { input }),
      isVisible: () => document.visibilityState !== "hidden",
      now: Date.now,
      createId: createUuid,
      subscribe: (refresh) => {
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
          window.removeEventListener("focus", refresh);
          document.removeEventListener("visibilitychange", refresh);
        };
      },
    });
  }, [busy]);
}
