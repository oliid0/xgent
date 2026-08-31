export type TurnCancellationScope = {
  controller: AbortController;
  release: () => void;
};

export type TurnCancellation = {
  userStop: AbortController;
  deriveScope: () => TurnCancellationScope;
};

export function createTurnCancellationFromSignal(signal?: AbortSignal): TurnCancellation {
  const cancellation = createTurnCancellation();
  if (signal) {
    if (signal.aborted) {
      cancellation.userStop.abort(signal.reason);
    } else {
      signal.addEventListener("abort", () => cancellation.userStop.abort(signal.reason), {
        once: true,
      });
    }
  }
  return cancellation;
}

export function createTurnCancellation(): TurnCancellation {
  const userStop = new AbortController();

  function deriveScope(): TurnCancellationScope {
    const controller = new AbortController();
    if (userStop.signal.aborted) {
      controller.abort(userStop.signal.reason);
      return { controller, release: () => {} };
    }

    const onUserStop = () => {
      controller.abort(userStop.signal.reason);
    };
    userStop.signal.addEventListener("abort", onUserStop, { once: true });
    const release = () => {
      userStop.signal.removeEventListener("abort", onUserStop);
    };

    controller.signal.addEventListener("abort", release, { once: true });
    return { controller, release };
  }

  return { userStop, deriveScope };
}
