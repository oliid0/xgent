import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { listen } from "@xgent/runtime";
import { captureBackgroundLease } from "./backgroundLease";
import {
  BackgroundBudgetDelegatesPending,
  BackgroundChildLaunchPending,
  BackgroundCloudLaunchPending,
  BackgroundTaskWaiting,
} from "./backgroundWaiting";
import {
  createCompletePromptRunInput,
  PROMPT_RUN_RECONCILE_INTERVAL_MS,
} from "./promptRunProtocol";
import type {
  BackgroundExecutionLease,
  CompletePromptRunInput,
  PromptCompletionResponse,
  PromptRunRequest,
  WaitBackgroundTaskInput,
} from "./types";

export const PROMPT_HOST_CONCURRENCY = 2;
const COMPLETION_RETRY_MS = 1_000;
const LEASE_MARGIN_MS = 2_000;

type PromptRunHostPorts = {
  claimPromptRuns: (limit?: number) => Promise<PromptRunRequest[]>;
  releasePromptRun: (executionId: string, lease?: BackgroundExecutionLease) => Promise<void>;
  completePromptRun: (input: CompletePromptRunInput) => Promise<PromptCompletionResponse>;
  execute: (request: PromptRunRequest, signal: AbortSignal) => Promise<string>;
  waitBackgroundTask?: (input: WaitBackgroundTaskInput) => Promise<unknown>;
  parkUnconfirmedCloudStart?: (
    executionId: string,
    callId: string,
    lease: BackgroundExecutionLease,
  ) => Promise<boolean>;
  parkUnconfirmedChildStart?: (
    executionId: string,
    callId: string,
    lease: BackgroundExecutionLease,
  ) => Promise<boolean>;
  completeBackgroundOperation?: (
    executionId: string,
    callId: string,
    result: ToolResultMessage,
    lease: BackgroundExecutionLease,
  ) => Promise<void>;
};

/** One execution owner. UI subscribers never own or cancel its work. */
export function startPromptRunHost(ports: PromptRunHostPorts) {
  let stopped = false;
  let claiming = false;
  const active = new Map<string, AbortController>();
  type Delivery =
    | { kind: "completion"; input: CompletePromptRunInput }
    | { kind: "waiting"; input: WaitBackgroundTaskInput }
    | {
        kind: "cloud-recovery" | "child-recovery";
        input: CompletePromptRunInput & { lease: BackgroundExecutionLease };
        receipt: ToolResultMessage;
        unreserved?: boolean;
      };
  const pending = new Map<string, Delivery>();
  const completing = new Set<string>();

  async function deliver(delivery: Delivery) {
    const { input } = delivery;
    if (completing.has(input.executionId)) return;
    completing.add(input.executionId);
    try {
      if (delivery.kind === "cloud-recovery" || delivery.kind === "child-recovery") {
        const park =
          delivery.kind === "child-recovery"
            ? ports.parkUnconfirmedChildStart
            : ports.parkUnconfirmedCloudStart;
        if (!park || !ports.completeBackgroundOperation)
          throw new Error("Native launch recovery delivery is unavailable");
        if (!delivery.unreserved) {
          const parked = await park(
            delivery.input.executionId,
            delivery.receipt.toolCallId,
            delivery.input.lease,
          );
          if (typeof parked !== "boolean")
            throw new Error("Invalid native launch parking decision");
          if (parked) {
            pending.delete(input.executionId);
            return;
          }
          // Native storage proves this call never reserved a cloud task. Only
          // that decision permits the original ordinary failure receipt.
          delivery.unreserved = true;
        }
        await ports.completeBackgroundOperation(
          delivery.input.executionId,
          delivery.receipt.toolCallId,
          delivery.receipt,
          delivery.input.lease,
        );
        await ports.completePromptRun(delivery.input);
      } else if (delivery.kind === "waiting") {
        if (!ports.waitBackgroundTask)
          throw new Error("Background waiting transport is unavailable");
        await ports.waitBackgroundTask(delivery.input);
      } else await ports.completePromptRun(delivery.input);
      pending.delete(input.executionId);
    } catch (error) {
      // Keep the result and retry only its delivery, never the executed tools.
      console.warn("Prompt result delivery pending", error);
    } finally {
      completing.delete(input.executionId);
    }
  }

  async function run(request: PromptRunRequest) {
    if (active.has(request.executionId)) return;
    let lease: BackgroundExecutionLease | undefined;
    try {
      lease =
        request.taskId === request.executionId ? captureBackgroundLease(request.lease) : undefined;
    } catch (error) {
      console.warn("Invalid background execution claim; native lease will expire", error);
      return;
    }
    const capturedRequest = { ...request, ...(lease ? { lease } : {}) };
    const controller = new AbortController();
    active.set(request.executionId, controller);
    const startedAt = Date.now();
    const deadline = setTimeout(
      () => controller.abort(),
      Math.max(
        1,
        request.leaseExpiresAt -
          Date.now() -
          Math.min(LEASE_MARGIN_MS, (request.leaseExpiresAt - Date.now()) / 10),
      ),
    );
    let success = false;
    let output = "";
    let waiting = false;
    let knownTools: string[] = [];
    let cloudPending: ToolResultMessage | undefined;
    let childPending: ToolResultMessage | undefined;
    let budgetDeferralId: string | undefined;
    try {
      output = await ports.execute(capturedRequest, controller.signal);
      success = Boolean(output.trim());
      if (!success) output = "Prompt run returned an empty conclusion.";
    } catch (error) {
      if (lease && error instanceof BackgroundChildLaunchPending) {
        const receipt = error.receipt;
        if (
          receipt.role === "toolResult" &&
          receipt.toolName === "BackgroundTask" &&
          typeof receipt.toolCallId === "string" &&
          receipt.toolCallId.trim() &&
          receipt.isError === true &&
          receipt.details?.outcomeUncertain === true
        )
          childPending = JSON.parse(JSON.stringify(receipt));
      }
      if (lease && error instanceof BackgroundCloudLaunchPending) {
        const receipt = error.receipt;
        if (
          receipt.role === "toolResult" &&
          receipt.toolName === "CloudTaskManager" &&
          typeof receipt.toolCallId === "string" &&
          receipt.toolCallId.trim() &&
          receipt.isError === true
        )
          cloudPending = JSON.parse(JSON.stringify(receipt));
      }
      waiting = Boolean(lease && error instanceof BackgroundTaskWaiting);
      if (waiting && error instanceof BackgroundBudgetDelegatesPending)
        budgetDeferralId = error.deferral.id;
      if (waiting) knownTools = [...(error as BackgroundTaskWaiting).knownTools];
      output = waiting
        ? (error as BackgroundTaskWaiting).conclusion
        : error instanceof Error
          ? error.message
          : String(error);
    } finally {
      clearTimeout(deadline);
      active.delete(request.executionId);
    }
    // Shutdown/expiry is handled by the durable lease owner, not a false success.
    if (controller.signal.aborted) return;
    const input = createCompletePromptRunInput(
      request.executionId,
      success,
      Math.max(0, Date.now() - startedAt),
      output.trim(),
    );
    if (lease) input.lease = lease;
    const delivery: Delivery =
      childPending && lease
        ? { kind: "child-recovery", input: { ...input, lease }, receipt: childPending }
        : cloudPending && lease
          ? { kind: "cloud-recovery", input: { ...input, lease }, receipt: cloudPending }
          : waiting && lease
            ? {
                kind: "waiting",
                input: {
                  executionId: input.executionId,
                  lease,
                  durationMs: input.durationMs,
                  output: input.output,
                  knownTools,
                  ...(budgetDeferralId ? { budgetDeferralId } : {}),
                },
              }
            : { kind: "completion", input };
    pending.set(input.executionId, delivery);
    await deliver(delivery);
    requestClaim();
  }

  async function claim() {
    if (stopped || claiming || active.size >= PROMPT_HOST_CONCURRENCY || pending.size) return;
    claiming = true;
    try {
      const claimed = await ports.claimPromptRuns(PROMPT_HOST_CONCURRENCY - active.size);
      for (const request of claimed) {
        if (stopped) await ports.releasePromptRun(request.executionId, request.lease);
        else void run(request);
      }
    } catch (error) {
      console.warn("Prompt claim failed; reconciliation will retry", error);
    } finally {
      claiming = false;
    }
  }

  function requestClaim() {
    void claim();
  }

  const subscriptions = [
    listen("automation:prompt-pending", requestClaim),
    listen<{ executionId: string }>("automation:prompt-expired", (event) => {
      active.get(event.payload.executionId)?.abort();
    }),
  ];
  // Reconciliation remains available even when native event registration fails.
  for (const subscription of subscriptions) void subscription.catch(console.warn);
  const reconcileTimer = setInterval(requestClaim, PROMPT_RUN_RECONCILE_INTERVAL_MS);
  const deliveryTimer = setInterval(() => {
    for (const delivery of pending.values()) void deliver(delivery);
    requestClaim();
  }, COMPLETION_RETRY_MS);
  requestClaim();
  return () => {
    stopped = true;
    clearInterval(reconcileTimer);
    clearInterval(deliveryTimer);
    for (const subscription of subscriptions) {
      void subscription.then((unlisten) => unlisten()).catch(console.warn);
    }
    for (const controller of active.values()) controller.abort();
  };
}
