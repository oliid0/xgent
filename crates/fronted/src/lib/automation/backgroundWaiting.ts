/** Typed suspension is consumed by the execution host and durably parked;
 * it must never be converted into terminal failure or a fake completion. */
export class BackgroundTaskWaiting extends Error {
  constructor(
    readonly conclusion: string,
    readonly reason: string,
    readonly knownTools: readonly string[] = [],
  ) {
    super(`Background task is waiting: ${reason}`);
    this.name = "BackgroundTaskWaiting";
  }
}

/** Only a confirmed native refusal can park a parent without an SDK conclusion. */
export class BackgroundBudgetDelegatesPending extends BackgroundTaskWaiting {
  constructor(readonly deferral: { id: string; kind: "modelRequests" | "toolCalls" }) {
    super(
      "Original child work retains the shared allocation; awaiting its actual settlement.",
      "Shared slots are reserved by unfinished original delegates.",
    );
    this.name = "BackgroundBudgetDelegatesPending";
  }
}

import type { ToolResultMessage } from "@earendil-works/pi-ai";

/** The host retries only native parking delivery. The original unresolved
 * operation must not receive an immutable failed receipt before that decision. */
export class BackgroundCloudLaunchPending extends Error {
  readonly receipt: ToolResultMessage;
  constructor(receipt: ToolResultMessage) {
    super(
      `Original cloud launch is unconfirmed; retain it without redispatch. ${receipt.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .slice(0, 16 * 1024)}`,
    );
    this.name = "BackgroundCloudLaunchPending";
    this.receipt = JSON.parse(JSON.stringify(receipt));
  }
}

/** Child operations are reserved natively before RPC. Losing their exact ACK
 * must suspend the parent until native GET observations establish the outcome. */
export class BackgroundChildLaunchPending extends Error {
  readonly receipt: ToolResultMessage;
  constructor(receipt: ToolResultMessage) {
    super(
      `Original child operation is unconfirmed; retain its owner without resending. ${receipt.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .slice(0, 16 * 1024)}`,
    );
    this.name = "BackgroundChildLaunchPending";
    this.receipt = JSON.parse(JSON.stringify(receipt));
  }
}
