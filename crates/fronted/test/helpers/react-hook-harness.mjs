// Component tests use the real event handlers and async boundaries with deterministic hook lifetimes.
export function createReactHookHarness() {
  const slots = [], effects = [];
  let cursor = 0, dirty = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const useMemo = (create, deps) => {
    const index = cursor++;
    if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: create() };
    return slots[index].value;
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => {
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useRef(current) { const index = cursor++; return slots[index] ??= { current }; },
    useMemo,
    useCallback: (callback, deps) => useMemo(() => callback, deps),
    useEffect(effect, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) effects.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { deps, effect, cleanup: effect() };
      });
    },
  };
  return {
    react,
    render(component) {
      let result, attempts = 0;
      do {
        if (++attempts > 30) throw new Error("Component did not settle after effects");
        dirty = false; cursor = 0;
        result = component();
        for (const effect of effects.splice(0)) effect();
      } while (dirty);
      return result;
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    replayEffects() {
      for (const slot of slots) {
        if (!slot?.effect) continue;
        slot.cleanup?.();
        slot.cleanup = slot.effect();
      }
    },
  };
}
