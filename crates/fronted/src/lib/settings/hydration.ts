/** A slow native IPC read is still authoritative when it eventually finishes. */
export function startSettingsHydration<T>(options: {
  load: () => Promise<T>;
  onLoaded: (value: T) => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
  onSlow?: () => void;
  slowAfterMs?: number;
}) {
  let cancelled = false;
  const timer = options.onSlow
    ? setTimeout(() => {
        if (!cancelled) options.onSlow?.();
      }, options.slowAfterMs ?? 2_500)
    : undefined;

  void Promise.resolve()
    .then(options.load)
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
