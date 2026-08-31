const STORAGE_KEY = "xgent.floor-bookmarks.v1";

const MAX_CONVERSATIONS = 200;

const EMPTY_BOOKMARKS: ReadonlySet<string> = new Set();

let cache: Map<string, ReadonlySet<string>> | null = null;
const listeners = new Set<() => void>();

function readStoredConversations(): Record<string, string[]> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const conversations = (parsed as { conversations?: unknown }).conversations;
    if (!conversations || typeof conversations !== "object") return {};
    const result: Record<string, string[]> = {};
    for (const [conversationId, ids] of Object.entries(conversations as Record<string, unknown>)) {
      if (!Array.isArray(ids)) continue;
      const clean = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
      if (clean.length > 0) result[conversationId] = clean;
    }
    return result;
  } catch {
    return {};
  }
}

function ensureCache(): Map<string, ReadonlySet<string>> {
  if (!cache) {
    cache = new Map(
      Object.entries(readStoredConversations()).map(([conversationId, ids]) => [
        conversationId,
        new Set(ids) as ReadonlySet<string>,
      ]),
    );
  }
  return cache;
}

function persist(map: Map<string, ReadonlySet<string>>) {
  while (map.size > MAX_CONVERSATIONS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  try {
    const payload = {
      version: 1,
      conversations: Object.fromEntries([...map.entries()].map(([id, ids]) => [id, [...ids]])),
    };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function getFloorBookmarks(conversationId: string): ReadonlySet<string> {
  return ensureCache().get(conversationId) ?? EMPTY_BOOKMARKS;
}

export function toggleFloorBookmark(conversationId: string, messageId: string): void {
  if (!conversationId || !messageId) return;
  const map = ensureCache();
  const next = new Set(map.get(conversationId) ?? []);
  if (next.has(messageId)) {
    next.delete(messageId);
  } else {
    next.add(messageId);
  }
  if (next.size === 0) {
    map.delete(conversationId);
  } else {
    map.delete(conversationId);
    map.set(conversationId, next);
  }
  persist(map);
  emit();
}

export function subscribeFloorBookmarks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetFloorBookmarksCacheForTest(): void {
  cache = null;
}
