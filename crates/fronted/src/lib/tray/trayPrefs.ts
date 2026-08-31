import { useSyncExternalStore } from "react";

export type TrayPrefs = {
  showConversationTitles: boolean;
  showRunningBadge: boolean;
};

const STORAGE_KEY = "xgent.trayPrefs.v1";

export const DEFAULT_TRAY_PREFS: TrayPrefs = {
  showConversationTitles: true,
  showRunningBadge: false,
};

const listeners = new Set<() => void>();
let cached: TrayPrefs | null = null;

function normalizeTrayPrefs(input: unknown): TrayPrefs {
  const object = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    showConversationTitles: object.showConversationTitles !== false,
    showRunningBadge: object.showRunningBadge === true,
  };
}

export function readTrayPrefs(): TrayPrefs {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cached = raw ? normalizeTrayPrefs(JSON.parse(raw)) : DEFAULT_TRAY_PREFS;
  } catch {
    cached = DEFAULT_TRAY_PREFS;
  }
  return cached;
}

export function writeTrayPrefs(patch: Partial<TrayPrefs>): TrayPrefs {
  const next = { ...readTrayPrefs(), ...patch };
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The in-memory preference remains useful when storage is unavailable.
  }
  for (const listener of listeners) listener();
  return next;
}

export function subscribeTrayPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTrayPrefs(): TrayPrefs {
  return useSyncExternalStore(subscribeTrayPrefs, readTrayPrefs, readTrayPrefs);
}
