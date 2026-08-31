import type { TrajectoryEvent } from "./types";

export type TrajectoryEventGroup = {
  key: string;
  turn: number | null;
  events: TrajectoryEvent[];
};

export type TrajectoryLane =
  | "user"
  | "context"
  | "model"
  | "tool"
  | "transport"
  | "warning"
  | "compaction"
  | "system";

export type TrajectoryTimelineItem = {
  id: string;
  event: TrajectoryEvent;
  endEvent?: TrajectoryEvent;
  turn: number | null;
  step: number | null;
  lane: TrajectoryLane;
  startAt: number;
  endAt: number;
  durationMs: number;
  offsetPercent: number;
  widthPercent: number;
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

function numericField(event: TrajectoryEvent, key: string): number | null {
  const value = event[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(event: TrajectoryEvent, key: string): string | null {
  const value = event[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function eventTurn(event: TrajectoryEvent): number | null {
  const turn = numericField(event, "t");
  return turn === null ? null : Math.max(1, Math.trunc(turn));
}

function eventStep(event: TrajectoryEvent): number | null {
  const step = numericField(event, "s");
  return step === null ? null : Math.max(0, Math.trunc(step));
}

function trajectoryLane(event: TrajectoryEvent): TrajectoryLane {
  if (event.k === "user") return "user";
  if (event.k === "context" || event.k === "header") return "context";
  if (
    event.k === "step_start" ||
    event.k === "first_token" ||
    event.k === "step_end" ||
    event.k.startsWith("model_")
  ) {
    return "model";
  }
  if (event.k === "tool_start" || event.k === "tool_end") return "tool";
  if (event.k === "transport") return "transport";
  if (event.k === "retry" || event.k === "failover") return "warning";
  if (event.k === "compaction_start" || event.k === "compaction_end") return "compaction";
  return "system";
}

function matchingEnd(
  event: TrajectoryEvent,
  following: readonly TrajectoryEvent[],
): TrajectoryEvent | undefined {
  const turn = eventTurn(event);
  const step = eventStep(event);
  if (event.k === "user") {
    return following.find(
      (candidate) => candidate.k === "turn_end" && eventTurn(candidate) === turn,
    );
  }
  if (event.k === "step_start") {
    return following.find(
      (candidate) =>
        candidate.k === "step_end" &&
        eventTurn(candidate) === turn &&
        eventStep(candidate) === step,
    );
  }
  if (event.k === "tool_start") {
    const callId = stringField(event, "id");
    return following.find(
      (candidate) => candidate.k === "tool_end" && stringField(candidate, "id") === callId,
    );
  }
  if (event.k === "compaction_start") {
    return following.find(
      (candidate) => candidate.k === "compaction_end" && eventTurn(candidate) === eventTurn(event),
    );
  }
  return undefined;
}

function isPairedEnd(event: TrajectoryEvent): boolean {
  return (
    event.k === "turn_end" ||
    event.k === "step_end" ||
    event.k === "tool_end" ||
    event.k === "compaction_end"
  );
}

/**
 * Build the visual ledger from the compact recorder stream. Start/end pairs
 * become duration bars while point events remain visible as short markers.
 */
export function buildTrajectoryTimeline(
  events: readonly TrajectoryEvent[],
  scale: "actual" | "sequence" = "actual",
): TrajectoryTimelineItem[] {
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => left.event.at - right.event.at || left.index - right.index);
  if (ordered.length === 0) return [];

  let currentTurn: number | null = null;
  const annotated = ordered.map((entry) => {
    const declaredTurn = entry.event.t;
    if (typeof declaredTurn === "number" && Number.isFinite(declaredTurn)) {
      currentTurn = Math.max(1, Math.trunc(declaredTurn));
    }
    return {
      ...entry,
      effectiveTurn: declaredTurn === null ? null : currentTurn,
    };
  });

  const raw = annotated
    .map(({ event, index, effectiveTurn }, orderedIndex) => {
      if (isPairedEnd(event)) return null;
      const following = annotated.slice(orderedIndex + 1).map((entry) => entry.event);
      const endEvent = matchingEnd(event, following);
      const retryDelay = event.k === "retry" ? numericField(event, "delay") : null;
      const endAt = Math.max(
        event.at,
        endEvent?.at ?? (retryDelay === null ? event.at : event.at + Math.max(0, retryDelay)),
      );
      return {
        id: `${event.k}-${event.at}-${index}`,
        event,
        ...(endEvent ? { endEvent } : {}),
        turn: effectiveTurn,
        step: eventStep(event),
        lane: trajectoryLane(event),
        startAt: event.at,
        endAt,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const rangeStart = Math.min(...raw.map((item) => item.startAt));
  const rangeEnd = Math.max(...raw.map((item) => item.endAt), rangeStart + 1);
  const range = Math.max(1, rangeEnd - rangeStart);
  const sequenceSlot = 100 / Math.max(1, raw.length);

  return raw.map((item, index) => {
    const durationMs = Math.max(0, item.endAt - item.startAt);
    const offsetPercent =
      scale === "sequence" ? index * sequenceSlot : ((item.startAt - rangeStart) / range) * 100;
    const measuredWidth =
      scale === "sequence"
        ? sequenceSlot * 0.72
        : (Math.max(durationMs, range * 0.008) / range) * 100;
    return {
      ...item,
      durationMs,
      offsetPercent: Math.max(0, Math.min(99.2, offsetPercent)),
      widthPercent: Math.max(0.8, Math.min(100 - offsetPercent, measuredWidth)),
    };
  });
}
