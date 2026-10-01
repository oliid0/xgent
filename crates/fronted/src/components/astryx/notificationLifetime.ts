/** The shared lifetime pauses while a native notification is being read. */
export function createNotificationLifetime(
  duration: number,
  expire: () => void,
  clock = {
    now: () => Date.now(),
    set: (run: () => void, delay: number) => setTimeout(run, delay),
    clear: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  },
) {
  let remaining = Number.isFinite(duration) ? Math.max(0, duration) : 5000;
  let started = clock.now(),
    paused = false,
    retired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    started = clock.now();
    timer = clock.set(() => {
      if (!retired && !paused) {
        retired = true;
        expire();
      }
    }, remaining);
  };
  schedule();
  return {
    pause(reading: boolean) {
      if (retired || paused === reading) return;
      paused = reading;
      if (timer !== undefined) clock.clear(timer);
      timer = undefined;
      if (reading) remaining = Math.max(0, remaining - (clock.now() - started));
      else schedule();
    },
    retire() {
      retired = true;
      if (timer !== undefined) clock.clear(timer);
      timer = undefined;
    },
  };
}
