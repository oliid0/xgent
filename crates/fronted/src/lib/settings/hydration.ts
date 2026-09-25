/** A slow native IPC read is still authoritative when it eventually finishes. */
export function startSettingsHydration<T>(options: {
  load: () => Promise<T>;
  onLoaded: (value: T) => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
  onSlow?: () => void;
  slowAfterMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
}) {
  let cancelled = false;
  const timer = options.onSlow
    ? setTimeout(() => {
        if (!cancelled) options.onSlow?.();
      }, options.slowAfterMs ?? 2_500)
    : undefined;

  const load = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await options.load();
      } catch (error) {
        if (cancelled || attempt >= (options.retryCount ?? 0)) throw error;
        await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 250));
        if (cancelled) throw error;
      }
    }
  };

  void Promise.resolve()
    .then(load)
    .then((value) => {
      if (!cancelled) options.onLoaded(value);
    })
    .catch((error: unknown) => {
      if (!cancelled) options.onError(error);
    })
    .finally(() => {
      clearTimeout(timer);
      if (!cancelled) options.onSettled();
    });

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
