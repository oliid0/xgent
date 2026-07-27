import { invoke, listen } from "./index";

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
  const subscriptions = new Map<string, () => void>();
  const subscriptionVersions = new Map<string, number>();
  let stopped = false;

  function invalidateSubscription(subscriptionId: string) {
    const nextVersion = (subscriptionVersions.get(subscriptionId) ?? 0) + 1;
    subscriptionVersions.set(subscriptionId, nextVersion);
    subscriptions.get(subscriptionId)?.();
    subscriptions.delete(subscriptionId);
    return nextVersion;
  }

  const stopRpc = await listen<LocalAccessRpcRequest>("local-access:rpc-request", (event) => {
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
  });

  const stopSubscribe = await listen<LocalAccessEventSubscription>(
    "local-access:event-subscribe",
    (event) => {
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
  );

  const stopUnsubscribe = await listen<LocalAccessEventUnsubscribe>(
    "local-access:event-unsubscribe",
    (event) => {
      invalidateSubscription(event.payload.subscriptionId);
    },
  );

  return () => {
    stopped = true;
    stopRpc();
    stopSubscribe();
    stopUnsubscribe();
    for (const unlisten of subscriptions.values()) unlisten();
    subscriptions.clear();
    subscriptionVersions.clear();
  };
}
