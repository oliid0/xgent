import { LAN_PC_RELAY_EVENT } from "./lanPcCommandHost";
import type { RuntimeEvent, RuntimeInvokeArgs, RuntimeUnlisten } from "./types";

type EventPort = {
  invoke<T>(command: string, args?: RuntimeInvokeArgs): Promise<T>;
  listen<T>(event: string, handler: (event: RuntimeEvent<T>) => void): Promise<RuntimeUnlisten>;
};

type Attempt = { relayId: string; remoteId: string; closed: boolean };
type Relay = { subscriptionId: string; payload: unknown; closed?: boolean };

/** Reconnect event reads only; ordinary command writes are never replayed. */
export async function listenLanPcEvent<T>(
  port: EventPort,
  baseUrl: string,
  event: string,
  handler: (event: RuntimeEvent<T>) => void,
  originalPeerId?: string,
): Promise<RuntimeUnlisten> {
  let stopped = false;
  let attempt: Attempt | undefined;
  let peerId = originalPeerId;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const release = (id: string) => {
    if (id) {
      void port.invoke("lan_pc_unsubscribe", { subscription_id: id }).catch((error) => {
        console.warn("[LAN PC] event subscription cleanup failed", error);
      });
    }
  };

  function retry() {
    if (stopped || timer !== undefined) return;
    attempt = undefined;
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(failures++, 6));
    timer = setTimeout(() => {
      timer = undefined;
      void connect(false);
    }, delay);
  }

  const unlisten = await port.listen<Relay>(LAN_PC_RELAY_EVENT, ({ payload }) => {
    const current = attempt;
    if (stopped || !current || current.closed || payload.subscriptionId !== current.relayId) return;
    if (payload.closed) {
      current.closed = true;
      // EOF can precede the subscribe IPC response. That response still owns
      // cleanup; do not overlap registration attempts while it is outstanding.
      if (current.remoteId) {
        release(current.remoteId);
        retry();
      }
      return;
    }
    failures = 0;
    handler({ payload: payload.payload as T });
  });

  async function connect(initial: boolean) {
    const current: Attempt = { relayId: crypto.randomUUID(), remoteId: "", closed: false };
    attempt = current;
    try {
      const result = await port.invoke<{ subscriptionId: string; peerId: string }>(
        "lan_pc_subscribe",
        { base_url: baseUrl, peer_id: peerId ?? null, relay_id: current.relayId, event },
      );
      current.remoteId = result.subscriptionId;
      if (stopped || attempt !== current) {
        release(current.remoteId);
        return;
      }
      if (peerId && result.peerId !== peerId) {
        release(current.remoteId);
        throw new Error("Event subscription changed its original computer identity");
      }
      peerId = result.peerId;
      if (current.closed) {
        release(current.remoteId);
        retry();
      }
    } catch (error) {
      if (stopped) return;
      if (initial) throw error;
      console.warn("[LAN PC] event reconnect failed", error);
      retry();
    }
  }

  try {
    await connect(true);
  } catch (error) {
    stopped = true;
    unlisten();
    throw error;
  }
  return () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    unlisten();
    if (attempt) release(attempt.remoteId);
    attempt = undefined;
  };
}
