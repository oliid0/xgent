import { captureLanPcCommandRouter } from "./lanPcCommandHost";

type LocalAccessRpcRequest = {
  requestId: string;
  command: string;
  args?: Record<string, unknown>;
};

type LocalAccessEventSubscription = {
  subscriptionId: string;
  event: string;
};

type LocalAccessEventUnsubscribe = {
  subscriptionId: string;
};

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Connects authenticated browser RPC requests to the existing Tauri command
 * surface. Rust owns authentication and authorization; only admitted requests
 * reach this native host bridge.
 */
export async function startLocalAccessHostBridge() {
  // This device already admitted the request. Its UI's selected peer must
  // never forward it again or move its subscription to a different device.
  const { createTauriRuntime } = await import("./tauri");
  const { invoke, listen } = createTauriRuntime(
    captureLanPcCommandRouter({ enabled: false, baseUrl: "" }),
  );
  const subscriptions = new Map<string, () => void>();
  const subscriptionVersions = new Map<string, number>();
  const rootListeners: Array<() => void> = [];
  let stopped = false;

  function stop() {
    if (stopped) return;
    stopped = true;
    for (const unlisten of rootListeners.splice(0).reverse()) unlisten();
    for (const unlisten of subscriptions.values()) unlisten();
    subscriptions.clear();
    subscriptionVersions.clear();
  }

  function registrationFailed(error: unknown): never {
    // Retrying registration must not leave a first RPC listener executing the
    // same admitted write twice. Also invalidate subscriptions still resolving.
    stop();
    throw error;
  }

  function invalidateSubscription(subscriptionId: string) {
    const nextVersion = (subscriptionVersions.get(subscriptionId) ?? 0) + 1;
    subscriptionVersions.set(subscriptionId, nextVersion);
    subscriptions.get(subscriptionId)?.();
    subscriptions.delete(subscriptionId);
    return nextVersion;
  }

  const stopRpc = await listen<LocalAccessRpcRequest>("local-access:rpc-request", (event) => {
    if (stopped) return;
    const request = event.payload;
    void invoke<unknown>(request.command, request.args)
      .then((result) =>
        invoke("local_access_rpc_respond", {
          requestId: request.requestId,
          ok: true,
          result: result ?? null,
          error: null,
        }),
      )
      .catch((cause) =>
        invoke("local_access_rpc_respond", {
          requestId: request.requestId,
          ok: false,
          result: null,
          error: errorMessage(cause),
        }),
      );
  }).catch(registrationFailed);
  rootListeners.push(stopRpc);

  const stopSubscribe = await listen<LocalAccessEventSubscription>(
    "local-access:event-subscribe",
    (event) => {
      if (stopped) return;
      const subscription = event.payload;
      const version = invalidateSubscription(subscription.subscriptionId);
      void listen<unknown>(subscription.event, (forwarded) => {
        void invoke("local_access_event_publish", {
          subscriptionId: subscription.subscriptionId,
          payload: forwarded.payload ?? null,
        }).catch(() => {});
      })
        .then((unlisten) => {
          if (stopped || subscriptionVersions.get(subscription.subscriptionId) !== version) {
            unlisten();
            return;
          }
          subscriptions.set(subscription.subscriptionId, unlisten);
        })
        .catch(() => {
          if (subscriptionVersions.get(subscription.subscriptionId) === version) {
            subscriptionVersions.delete(subscription.subscriptionId);
          }
        });
    },
  ).catch(registrationFailed);
  rootListeners.push(stopSubscribe);

  const stopUnsubscribe = await listen<LocalAccessEventUnsubscribe>(
    "local-access:event-unsubscribe",
    (event) => {
      if (stopped) return;
      invalidateSubscription(event.payload.subscriptionId);
    },
  ).catch(registrationFailed);
  rootListeners.push(stopUnsubscribe);

  return stop;
}
