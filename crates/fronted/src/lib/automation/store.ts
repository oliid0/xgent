// Client mirror of the desktop-authoritative automation store. State only
// ever changes by feeding authoritative snapshots (initial fetch, change
// events, apply responses); there is no whole-list write-back path.

import { useSyncExternalStore } from "react";

import { backend } from "./backend";
import type { AutomationOp, AutomationSnapshot, CronSnapshot, HooksSnapshot } from "./types";

export type AutomationState = {
  ready: boolean;
  cron: CronSnapshot;
  hooks: HooksSnapshot;
};

const EMPTY_STATE: AutomationState = {
  ready: false,
  cron: { revision: 0, tasks: [] },
  hooks: { revision: 0, hooks: [] },
};

const MAX_APPLY_ATTEMPTS = 3;

export class AutomationConflictError extends Error {
  constructor() {
    super("Automation state changed concurrently; retry with the refreshed snapshot.");
    this.name = "AutomationConflictError";
  }
}

export function createAutomationStore(backendTransport = backend, subscribeToChanges = true) {
  const backend = backendTransport;
  let state: AutomationState = EMPTY_STATE;
  const listeners = new Set<() => void>();
  let initPromise: Promise<void> | null = null;

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function getAutomationState(): AutomationState {
    return state;
  }

  function subscribeAutomation(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function feedCronSnapshot(snapshot: CronSnapshot) {
    if (state.ready && snapshot.revision < state.cron.revision) return;
    state = { ...state, ready: true, cron: snapshot };
    emit();
  }

  function feedHooksSnapshot(snapshot: HooksSnapshot) {
    if (state.ready && snapshot.revision < state.hooks.revision) return;
    state = { ...state, ready: true, hooks: snapshot };
    emit();
  }

  function feedAutomationSnapshot(snapshot: AutomationSnapshot) {
    feedCronSnapshot(snapshot.cron);
    feedHooksSnapshot(snapshot.hooks);
  }

  /** Idempotent: subscribes to backend change events and loads the initial snapshot. */
  function initAutomation(): Promise<void> {
    if (!initPromise) {
      initPromise = (async () => {
        if (subscribeToChanges)
          backend.subscribe({
            onCron: feedCronSnapshot,
            onHooks: feedHooksSnapshot,
          });
        feedAutomationSnapshot(await backend.fetchSnapshot());
      })().catch((error) => {
        initPromise = null;
        throw error;
      });
    }
    return initPromise;
  }

  async function refreshAutomationSnapshot(): Promise<void> {
    feedAutomationSnapshot(await backend.fetchSnapshot());
  }

  /**
   * Apply ops with optimistic concurrency: on a revision conflict the local
   * mirror is refreshed from the returned snapshot and the ops are rebased
   * (they are field-level patches, so a plain retry is safe).
   */
  async function applyCronOps(ops: AutomationOp[]): Promise<CronSnapshot> {
    await initAutomation();
    for (let attempt = 0; attempt < MAX_APPLY_ATTEMPTS; attempt += 1) {
      const response = await backend.cronApply({
        baseRevision: state.cron.revision,
        ops,
      });
      if (
        !response ||
        !["ok", "conflict"].includes(response.status) ||
        !Number.isSafeInteger(response.cron?.revision) ||
        response.cron.revision < 0 ||
        !Array.isArray(response.cron.tasks)
      ) {
        throw new Error("Cron apply receipt is incomplete; its execution outcome is unconfirmed.");
      }
      feedCronSnapshot(response.cron);
      if (response.status === "ok") {
        return response.cron;
      }
    }
    throw new AutomationConflictError();
  }

  async function applyHookOps(ops: AutomationOp[]): Promise<HooksSnapshot> {
    await initAutomation();
    for (let attempt = 0; attempt < MAX_APPLY_ATTEMPTS; attempt += 1) {
      const response = await backend.hooksApply({
        baseRevision: state.hooks.revision,
        ops,
      });
      if (
        !response ||
        !["ok", "conflict"].includes(response.status) ||
        !Number.isSafeInteger(response.hooks?.revision) ||
        response.hooks.revision < 0 ||
        !Array.isArray(response.hooks.hooks)
      ) {
        throw new Error("Hook apply receipt is incomplete; its execution outcome is unconfirmed.");
      }
      feedHooksSnapshot(response.hooks);
      if (response.status === "ok") {
        return response.hooks;
      }
    }
    throw new AutomationConflictError();
  }

  return {
    getAutomationState,
    subscribeAutomation,
    feedCronSnapshot,
    feedHooksSnapshot,
    feedAutomationSnapshot,
    initAutomation,
    refreshAutomationSnapshot,
    applyCronOps,
    applyHookOps,
    listCronRuns: backend.listRuns,
    clearCronRuns: backend.clearRuns,
    runCronNow: backend.runNow,
    validateCronExpression: backend.validateCronExpression,
  };
}

export const {
  getAutomationState,
  subscribeAutomation,
  feedCronSnapshot,
  feedHooksSnapshot,
  feedAutomationSnapshot,
  initAutomation,
  refreshAutomationSnapshot,
  applyCronOps,
  applyHookOps,
} = createAutomationStore();

export function useAutomation(): AutomationState {
  return useSyncExternalStore(subscribeAutomation, getAutomationState, getAutomationState);
}

export const listCronRuns = backend.listRuns;
export const clearCronRuns = backend.clearRuns;
export const runCronNow = backend.runNow;
export const validateCronExpression = backend.validateCronExpression;
