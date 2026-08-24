import type { TrajectoryEvent } from "./types";

export type TrajectoryEventGroup = {
  key: string;
  turn: number | null;
  events: TrajectoryEvent[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeEvent(value: unknown): TrajectoryEvent | null {
  if (
    !isRecord(value) ||
    typeof value.k !== "string" ||
    typeof value.at !== "number" ||
    !Number.isFinite(value.at)
  ) {
    return null;
  }
  return value as TrajectoryEvent;
}

export function parseTrajectoryEvents(raw: string): TrajectoryEvent[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Trajectory payload must be an array");
  return parsed.map(normalizeEvent).filter((event): event is TrajectoryEvent => event !== null);
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value !== "object") return JSON.stringify(String(value));
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`)
    .join(",")}}`;
}

/** Merge the recorder's in-memory tail with SQLite without duplicating flushed events. */
export function mergeTrajectoryEvents(
  persisted: readonly TrajectoryEvent[],
  live: readonly TrajectoryEvent[],
): TrajectoryEvent[] {
  const persistedCounts = new Map<string, number>();
  for (const event of persisted) {
    const fingerprint = stableSerialize(event);
    persistedCounts.set(fingerprint, (persistedCounts.get(fingerprint) ?? 0) + 1);
  }

  const seenLiveCounts = new Map<string, number>();
  const unpersisted: TrajectoryEvent[] = [];
  for (const event of live) {
    const fingerprint = stableSerialize(event);
    const occurrence = (seenLiveCounts.get(fingerprint) ?? 0) + 1;
    seenLiveCounts.set(fingerprint, occurrence);
    if (occurrence > (persistedCounts.get(fingerprint) ?? 0)) unpersisted.push(event);
  }
  return [...persisted, ...unpersisted];
}

/** Associate header events with the surrounding turn while retaining standalone compactions. */
export function groupTrajectoryEvents(events: readonly TrajectoryEvent[]): TrajectoryEventGroup[] {
  const groups = new Map<string, TrajectoryEventGroup>();
  let currentTurn: number | null = null;

  for (const event of events) {
    const declaredTurn = event.t;
    if (typeof declaredTurn === "number" && Number.isFinite(declaredTurn)) {
      currentTurn = Math.max(1, Math.trunc(declaredTurn));
    }
    const turn = declaredTurn === null ? null : currentTurn;
    const key = turn === null ? "standalone" : `turn-${turn}`;
    const group = groups.get(key) ?? { key, turn, events: [] };
    group.events.push(event);
    groups.set(key, group);
  }

  return [...groups.values()];
}
