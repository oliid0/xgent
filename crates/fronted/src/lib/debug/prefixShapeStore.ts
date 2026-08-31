import type { PrefixShape } from "./prefixCacheShape";

const PREFIX_SHAPE_SESSION_LIMIT = 32;

type PrefixShapeEntry = {
  shape: PrefixShape;
  lastTouchedAt: number;
};

const shapesBySession = new Map<string, PrefixShapeEntry>();

let touchCounter = 0;

let fallbackShape: PrefixShape | null = null;

function pruneShapes() {
  if (shapesBySession.size <= PREFIX_SHAPE_SESSION_LIMIT) return;
  const sorted = [...shapesBySession.entries()].sort(
    (a, b) => a[1].lastTouchedAt - b[1].lastTouchedAt,
  );
  for (const [key] of sorted.slice(0, shapesBySession.size - PREFIX_SHAPE_SESSION_LIMIT)) {
    shapesBySession.delete(key);
  }
}

function normalizeKey(sessionId: string | undefined): string | undefined {
  const trimmed = sessionId?.trim();
  return trimmed ? trimmed : undefined;
}

export function readPreviousPrefixShape(sessionId: string | undefined): PrefixShape | null {
  const key = normalizeKey(sessionId);
  if (!key) return fallbackShape;
  const entry = shapesBySession.get(key);
  if (!entry) return null;
  entry.lastTouchedAt = ++touchCounter;
  return entry.shape;
}

export function recordPrefixShape(sessionId: string | undefined, shape: PrefixShape): void {
  const key = normalizeKey(sessionId);
  if (!key) {
    fallbackShape = shape;
    return;
  }
  const existing = shapesBySession.get(key);
  if (existing) {
    existing.shape = shape;
    existing.lastTouchedAt = ++touchCounter;
    return;
  }
  shapesBySession.set(key, { shape, lastTouchedAt: ++touchCounter });
  pruneShapes();
}
