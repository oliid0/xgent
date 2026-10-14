import type { BackgroundInboxPage } from "./types";

type Candidate = { entryId: string; branchId?: string };
type Ports = {
  listBackgroundInbox(
    cursor: number,
    limit: number,
    unreadOnly: boolean,
  ): Promise<BackgroundInboxPage>;
  listPendingMobileBranches(
    cursor: number,
  ): Promise<{ items: { entryId: string; branchId: string }[]; nextCursor: number | null }>;
  getReceivedDeviceBranches(
    entry: string,
  ): Promise<{ branches: { source: { id: string }; ready: boolean }[] }>;
  execute(entry: string, branch: string, signal: AbortSignal): Promise<void>;
  isVisible(): boolean;
};

/** App-owned foreground phone worker. Native owns plans/effect receipts and
 * task authority. Closing a view never acknowledges, completes or reroutes it. */
export function startMobileBranchWorker(ports: Ports) {
  let stopped = false,
    scanning = false,
    inboxCursor = 0,
    planCursor = 0;
  const queue = new Map<string, Candidate>();
  const active = new Map<string, AbortController>();
  const retry = new Map<string, { at: number; count: number }>();
  const keyFor = (candidate: Candidate) =>
    JSON.stringify([candidate.entryId, candidate.branchId ?? null]);
  const enqueue = (candidate: Candidate) => {
    const key = keyFor(candidate);
    if (!active.has(key) && !queue.has(key) && queue.size < 512) queue.set(key, candidate);
  };
  const run = async (key: string, candidate: Candidate, controller: AbortController) => {
    const timeout = setTimeout(() => controller.abort(), 300_000);
    try {
      const branches = candidate.branchId
        ? [candidate.branchId]
        : (await ports.getReceivedDeviceBranches(candidate.entryId)).branches
            .filter((branch) => branch.ready)
            .map((branch) => branch.source.id);
      let failed = false;
      for (const branch of branches) {
        controller.signal.throwIfAborted();
        if (stopped || !ports.isVisible()) break;
        try {
          await ports.execute(candidate.entryId, branch, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          failed = true; // Another independent ready branch still proceeds.
        }
      }
      if (failed) throw new Error("One or more phone branches require recovery");
      retry.delete(key);
    } catch {
      const count = (retry.get(key)?.count ?? 0) + 1;
      retry.set(key, {
        count,
        at: Date.now() + Math.min(900_000, 30_000 * 2 ** Math.min(count, 5)),
      });
      if (retry.size > 512) retry.delete(retry.keys().next().value as string);
      // Keep records/plans native. Do not log prompt, account or credential data.
      console.warn(
        "Original-device branch paused; its native plan and receipts remain recoverable",
      );
    } finally {
      clearTimeout(timeout);
      active.delete(key);
      if (!stopped) drain();
    }
  };
  const drain = () => {
    for (const [key, candidate] of queue) {
      if (active.size >= 2 || stopped || !ports.isVisible()) break;
      if ((retry.get(key)?.at ?? 0) > Date.now()) continue;
      // One entry is one original task. A pending-plan retry and its inbox
      // notice must not start two concurrent model planners for that task.
      if ([...active.keys()].some((key) => JSON.parse(key)[0] === candidate.entryId)) continue;
      queue.delete(key);
      const controller = new AbortController();
      active.set(key, controller);
      void run(key, candidate, controller);
    }
  };
  const refresh = async () => {
    if (stopped) return;
    if (!ports.isVisible()) {
      for (const controller of active.values()) controller.abort();
      return;
    }
    if (scanning) return;
    scanning = true;
    try {
      // Scan bounded pages across ticks, including read/acknowledged waiting
      // notices. A UI acknowledgment never suppresses unfinished work.
      const plans = await ports.listPendingMobileBranches(planCursor);
      if (stopped) return;
      planCursor = plans.nextCursor ?? 0;
      for (const plan of plans.items) enqueue(plan);
      const page = await ports.listBackgroundInbox(inboxCursor, 20, false);
      if (stopped) return;
      inboxCursor = page.nextCursor ?? 0;
      for (const entry of page.items) if (entry.state === "waiting") enqueue({ entryId: entry.id });
    } catch {
      console.warn("Original-device worker discovery unavailable; native work retained");
    } finally {
      scanning = false;
      drain();
    }
  };
  const timer = setInterval(() => void refresh(), 30_000);
  void refresh();
  return {
    refresh,
    retryEntry(entryId: string) {
      if (stopped || !entryId) return;
      for (const key of retry.keys()) if (JSON.parse(key)[0] === entryId) retry.delete(key);
      enqueue({ entryId });
      drain();
      void refresh();
    },
    stopEntry(entryId: string) {
      if (stopped) return;
      for (const [key, controller] of active)
        if (JSON.parse(key)[0] === entryId) controller.abort();
      for (const key of queue.keys()) if (JSON.parse(key)[0] === entryId) queue.delete(key);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      queue.clear();
      for (const controller of active.values()) controller.abort();
    },
  };
}
