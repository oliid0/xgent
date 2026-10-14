import { invokeNative as invoke, listenNative as listen } from "@xgent/runtime";
import { useCallback, useEffect, useRef, useState } from "react";

export type AgentStartupStatus = {
  revision: number;
  supported: boolean;
  registered: boolean | null;
  /** OS registration policy, not proof the current process was launched by that supervisor. */
  restartOnFailure?: boolean;
  reason: string | null;
  backgroundLaunch: boolean;
  workerReady: boolean;
  observedAtMs: number;
};

/** Native-local only: selecting a remote PC never redirects OS login settings. */
export function useAgentStartup(active: boolean) {
  const [data, setData] = useState<AgentStartupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(active),
    generation = useRef(0),
    pending = useRef<number | null>(null),
    serial = useRef(0),
    revision = useRef(-1);
  live.current = active;
  const feed = useCallback((snapshot: AgentStartupStatus) => {
    if (!live.current || snapshot.revision < revision.current) return;
    revision.current = snapshot.revision;
    setData(snapshot);
  }, []);
  const perform = useCallback(
    async (enabled?: boolean) => {
      if (!live.current || pending.current !== null) return false;
      const request = ++serial.current,
        version = generation.current;
      pending.current = request;
      setBusy(true);
      setError(null);
      const current = () => live.current && version === generation.current;
      try {
        const result = await invoke<AgentStartupStatus>(
          enabled === undefined ? "app_agent_startup_status" : "app_agent_startup_set",
          enabled === undefined ? undefined : { enabled },
        );
        if (!current()) return false;
        feed(result);
        return true;
      } catch (failure) {
        if (enabled !== undefined && current()) {
          // The OS may have accepted a write whose reply was lost. Observe the
          // actual registration; never retry mutation or invent a rollback.
          try {
            const observed = await invoke<AgentStartupStatus>("app_agent_startup_status");
            if (current()) feed(observed);
          } catch {
            /* Preserve the last observed state and the original failure. */
          }
        }
        if (current()) setError(failure instanceof Error ? failure.message : String(failure));
        return false;
      } finally {
        if (pending.current === request) {
          pending.current = null;
          if (current()) setBusy(false);
        }
      }
    },
    [feed],
  );

  useEffect(() => {
    live.current = active;
    if (!active) {
      setData(null);
      setError(null);
      setBusy(false);
      return;
    }
    const version = generation.current;
    const unlisten = listen<AgentStartupStatus>("app:agent-startup-changed", (event) => {
      if (live.current && generation.current === version) feed(event.payload);
    });
    void unlisten.catch((failure) => {
      if (live.current && generation.current === version) setError(String(failure));
    });
    void perform();
    return () => {
      live.current = false;
      generation.current++;
      pending.current = null;
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, [active, feed, perform]);

  return {
    data,
    busy,
    error,
    refresh: () => perform(),
    setRegistered: (enabled: boolean) => perform(enabled),
  };
}
