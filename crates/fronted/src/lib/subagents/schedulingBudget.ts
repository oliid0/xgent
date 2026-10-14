export type SchedulingBudgetConfig = {
  maxModelRequests: number;
  maxToolCalls: number;
  lifetimeMinutes: number;
};

export const DEFAULT_SCHEDULING_BUDGET_CONFIG: SchedulingBudgetConfig = {
  maxModelRequests: 128,
  maxToolCalls: 256,
  lifetimeMinutes: 0,
};

export function validSchedulingBudget(value: unknown): value is SchedulingBudgetConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  return (
    Object.keys(config).every((key) =>
      ["maxModelRequests", "maxToolCalls", "lifetimeMinutes"].includes(key),
    ) &&
    Number.isSafeInteger(config.maxModelRequests) &&
    Number(config.maxModelRequests) >= 1 &&
    Number(config.maxModelRequests) <= 128 &&
    Number.isSafeInteger(config.maxToolCalls) &&
    Number(config.maxToolCalls) >= 1 &&
    Number(config.maxToolCalls) <= 256 &&
    Number.isSafeInteger(config.lifetimeMinutes) &&
    Number(config.lifetimeMinutes) >= 0 &&
    Number(config.lifetimeMinutes) <= 43200
  );
}

export function normalizeSchedulingBudget(value: unknown): SchedulingBudgetConfig {
  return { ...(validSchedulingBudget(value) ? value : DEFAULT_SCHEDULING_BUDGET_CONFIG) };
}

export function budgetLifetimeOptions(t: (key: string) => string, current?: string) {
  const values = [0, 30, 60, 240, 1440, 10080, 43200];
  if (
    current &&
    /^\d+$/.test(current) &&
    Number(current) <= 43200 &&
    !values.includes(Number(current))
  )
    values.push(Number(current));
  return values.map((value) => ({
    value: String(value),
    label:
      value === 0 ? t("schedulingBudget.unlimited") : `${value} ${t("schedulingBudget.minutes")}`,
  }));
}

/** Native admission is authoritative. This additionally interrupts active
 * requests/tools without inventing an external cancellation receipt. */
export function schedulingDeadlineSignal(parent: AbortSignal, deadlineAt?: number) {
  if (deadlineAt === undefined) return { signal: parent, dispose() {} };
  if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= 0 || deadlineAt > 8_640_000_000_000_000)
    throw new Error("Invalid accepted execution deadline");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const cancel = () => controller.abort(parent.reason);
  const tick = () => {
    if (disposed || controller.signal.aborted) return;
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0)
      controller.abort(new Error("Shared execution deadline reached; completed work is retained"));
    else timer = setTimeout(tick, Math.min(remaining, 2_147_483_647));
  };
  parent.addEventListener("abort", cancel, { once: true });
  if (parent.aborted) cancel();
  tick();
  return {
    signal: controller.signal,
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      parent.removeEventListener("abort", cancel);
    },
  };
}
