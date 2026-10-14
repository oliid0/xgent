import type {
  ExecutionBudgetKind,
  ExecutionBudgetPort,
  ExecutionBudgetSnapshot,
} from "../subagents/executionBudget";
import { backend } from "./backend";
import { captureBackgroundLease } from "./backgroundLease";
import { BackgroundBudgetDelegatesPending } from "./backgroundWaiting";
import type { BackgroundExecutionLease } from "./types";

export type BackgroundBudgetSnapshot = ExecutionBudgetSnapshot & {
  version: 1;
  executionId: string;
};
export type BackgroundBudgetAdmission = {
  admitted: boolean;
  budget: BackgroundBudgetSnapshot;
  deferred?: { id: string; kind: ExecutionBudgetKind };
};

function validateSnapshot(value: BackgroundBudgetSnapshot, executionId: string) {
  const settlements = value?.settledDelegations === undefined ? 0 : value.settledDelegations;
  const counter = (item: { used: number; limit: number; reserved?: number }) =>
    item &&
    Number.isSafeInteger(item.used) &&
    Number.isSafeInteger(item.limit) &&
    item.used >= 0 &&
    item.limit > 0 &&
    Number.isSafeInteger(item.reserved === undefined ? 0 : item.reserved) &&
    (item.reserved ?? 0) >= 0 &&
    item.used + (item.reserved ?? 0) <= item.limit;
  if (
    !value ||
    value.version !== 1 ||
    value.executionId !== executionId ||
    value.scope !== "current_host_execution" ||
    value.durable !== true ||
    value.includesCompaction !== true ||
    !Number.isSafeInteger(settlements) ||
    settlements < 0 ||
    typeof value.includesDeviceDelegates !== "boolean" ||
    value.includesDeviceDelegates !==
      (settlements > 0 || (value.modelRequests?.reserved ?? 0) > 0) ||
    (settlements === 0 &&
      (value.modelRequests?.reserved ?? 0) > 0 !== (value.toolCalls?.reserved ?? 0) > 0) ||
    typeof value.exhausted !== "boolean" ||
    (value.deadlineAt !== undefined &&
      (!Number.isSafeInteger(value.deadlineAt) ||
        value.deadlineAt <= 0 ||
        value.deadlineAt > 8_640_000_000_000_000)) ||
    !counter(value.modelRequests) ||
    !counter(value.toolCalls)
  )
    throw new Error("Native lifetime budget is missing or inconsistent");
  return structuredClone(value);
}

export async function createBackgroundExecutionBudget(
  executionId: string,
  lease: BackgroundExecutionLease,
  port: Pick<typeof backend, "readBackgroundBudget" | "consumeBackgroundBudget"> = backend,
): Promise<ExecutionBudgetPort & { delegatesDeferral(): BackgroundBudgetAdmission["deferred"] }> {
  const captured = captureBackgroundLease(lease);
  let state = validateSnapshot(await port.readBackgroundBudget(executionId, captured), executionId);
  let blocked: Error | undefined;
  let deferred: BackgroundBudgetAdmission["deferred"];
  let tail: Promise<void> = Promise.resolve();
  return {
    consume(kind: ExecutionBudgetKind) {
      // One captured ledger/lease shared by the parent and every model delegate.
      // Serial replies also prevent an older snapshot overwriting newer usage.
      const pending = tail.then(async () => {
        if (blocked) throw blocked;
        if (kind !== "modelRequests" && kind !== "toolCalls")
          throw new Error("Invalid execution budget admission kind");
        if (state.exhausted) {
          blocked = new Error("Shared execution budget exhausted; completed work is retained.");
          throw blocked;
        }
        try {
          const receipt = await port.consumeBackgroundBudget(executionId, captured, kind);
          const next = validateSnapshot(receipt?.budget, executionId);
          const previousSettlements = state.settledDelegations ?? 0;
          const settlements = next.settledDelegations ?? 0;
          const other = kind === "modelRequests" ? "toolCalls" : "modelRequests";
          const wait = receipt.deferred;
          if (
            wait !== undefined &&
            (!wait ||
              typeof wait !== "object" ||
              Object.keys(wait).some((key) => key !== "id" && key !== "kind") ||
              typeof wait.id !== "string" ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
                wait.id,
              ) ||
              wait.kind !== kind ||
              receipt.admitted !== false ||
              next.exhausted ||
              !next.includesDeviceDelegates ||
              (next[kind].reserved ?? 0) <= 0 ||
              next[kind].used + (next[kind].reserved ?? 0) < next[kind].limit ||
              (next.deadlineAt !== undefined && Date.now() >= next.deadlineAt))
          )
            throw new Error("Invalid original delegate budget deferral");
          if (
            typeof receipt.admitted !== "boolean" ||
            next.modelRequests.limit !== state.modelRequests.limit ||
            next.toolCalls.limit !== state.toolCalls.limit ||
            next.deadlineAt !== state.deadlineAt ||
            settlements < previousSettlements ||
            (state.includesDeviceDelegates && !next.includesDeviceDelegates) ||
            (settlements === previousSettlements &&
              ((next.modelRequests.reserved ?? 0) < (state.modelRequests.reserved ?? 0) ||
                (next.toolCalls.reserved ?? 0) < (state.toolCalls.reserved ?? 0))) ||
            next[other].used !== state[other].used ||
            next[kind].used !== state[kind].used + (receipt.admitted ? 1 : 0) ||
            (wait === undefined && next.exhausted === receipt.admitted)
          )
            throw new Error("Budget admission receipt does not match the captured ledger");
          state = next;
          if (!receipt.admitted) {
            if (wait) {
              deferred = structuredClone(wait);
              blocked = new BackgroundBudgetDelegatesPending(structuredClone(wait));
              throw blocked;
            }
            blocked = new Error(
              `Shared execution budget exhausted: ${kind} ${state[kind].used}/${state[kind].limit}. Completed work is retained.`,
            );
            throw blocked;
          }
        } catch (error) {
          // Lost ACK may already have spent a slot. Never refund, retry this
          // admission or permit an effect without an exact confirmed receipt.
          blocked ??= new Error(
            "Shared execution budget admission unconfirmed; further requests/tools are stopped. Inspect retained work before resuming.",
            { cause: error },
          );
          throw blocked;
        }
      });
      tail = pending.catch(() => undefined);
      return pending;
    },
    snapshot: () => structuredClone(state),
    delegatesDeferral: () => (deferred ? structuredClone(deferred) : undefined),
  };
}
