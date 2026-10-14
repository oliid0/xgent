const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_DATE_MS = 8_640_000_000_000_000;

/** HTTP Retry-After is an integer delay or HTTP date, not arbitrary numeric text. */
export function retryAfterDeadline(value: string | null, now: number): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    if (Number.isFinite(seconds)) return Math.min(MAX_DATE_MS, now + seconds * 1000);
    return undefined;
  }
  // Date.parse accepts strings such as "-1" as dates; exclude those here.
  if (!/^[a-z]{3,9}[ ,]/i.test(text)) return undefined;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(now, date) : undefined;
}

type Cooldown = { observedAt: number; retryAt: number; httpStatus: number };

/** Process-local evidence for new delegation admission, never a quota estimate. */
export class ModelCooldownRegistry {
  private entries = new Map<string, Cooldown>();
  private listeners = new Set<() => void>();

  constructor(private readonly now: () => number = Date.now) {}

  snapshot(value: string): Cooldown | undefined {
    const entry = this.entries.get(value);
    if (entry && entry.retryAt <= this.now()) {
      this.entries.delete(value);
      return undefined;
    }
    return entry ? { ...entry } : undefined;
  }

  remainingMs(value: string) {
    const entry = this.snapshot(value);
    return entry ? Math.max(0, entry.retryAt - this.now()) : 0;
  }

  observe(value: string, response: Pick<Response, "status" | "headers">) {
    if (![429, 503, 529].includes(response.status)) return;
    const now = this.now();
    // Only this exact account/model is evidenced as limited. Other models on
    // the account may have independent quotas; do not invent their status.
    const retryAfterMs = response.headers.get("retry-after-ms")?.trim();
    const milliseconds =
      retryAfterMs && /^\d+(?:\.\d+)?$/.test(retryAfterMs) ? Number(retryAfterMs) : undefined;
    const retryAt =
      milliseconds !== undefined && Number.isFinite(milliseconds)
        ? Math.min(MAX_DATE_MS, now + milliseconds)
        : (retryAfterDeadline(response.headers.get("retry-after"), now) ??
          now + DEFAULT_COOLDOWN_MS);
    const previous = this.snapshot(value);
    if (previous && previous.retryAt >= retryAt) return;
    this.entries.set(value, { observedAt: now, retryAt, httpStatus: response.status });
    for (const listener of [...this.listeners]) listener();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  captureFetch(value: string, fetch: typeof globalThis.fetch): typeof globalThis.fetch {
    return async (input, init) => {
      const response = await fetch(input, init);
      this.observe(value, response);
      // Preserve the identical response, body, headers and abort behavior.
      return response;
    };
  }
}

export const modelCooldowns = new ModelCooldownRegistry();
