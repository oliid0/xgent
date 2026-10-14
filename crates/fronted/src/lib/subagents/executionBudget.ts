export type ExecutionBudgetLimits = {
  maxModelRequests: number;
  maxToolCalls: number;
  deadlineAt?: number;
};

export type ExecutionBudgetKind = "modelRequests" | "toolCalls";
export type ExecutionBudgetSnapshot = {
  scope: "current_host_execution";
  modelRequests: { used: number; limit: number; reserved?: number };
  toolCalls: { used: number; limit: number; reserved?: number };
  durable: boolean;
  includesCompaction: boolean;
  includesDeviceDelegates: boolean;
  settledDelegations?: number;
  exhausted: boolean;
  deadlineAt?: number;
};
export type ExecutionBudgetPort = {
  consume: (kind: ExecutionBudgetKind) => void | Promise<void>;
  snapshot: () => ExecutionBudgetSnapshot;
};

// Use the existing cloud-agent runtime's supported request/tool ceilings.
// This budget bounds one coordinating execution, including its model delegates.
export const DEFAULT_SCHEDULING_BUDGET: ExecutionBudgetLimits = {
  maxModelRequests: 128,
  maxToolCalls: 256,
};

export class ExecutionBudget implements ExecutionBudgetPort {
  private modelRequests = 0;
  private toolCalls = 0;
  private exhausted?: Error;
  readonly limits: Readonly<ExecutionBudgetLimits>;

  constructor(limits: ExecutionBudgetLimits) {
    for (const value of [limits.maxModelRequests, limits.maxToolCalls]) {
      if (!Number.isSafeInteger(value) || value < 1)
        throw new Error("Execution budget limits must be positive safe integers.");
    }
    if (
      limits.deadlineAt !== undefined &&
      (!Number.isSafeInteger(limits.deadlineAt) ||
        limits.deadlineAt <= 0 ||
        limits.deadlineAt > 8_640_000_000_000_000)
    )
      throw new Error("Execution deadline must be a valid absolute timestamp.");
    this.limits = Object.freeze({ ...limits });
  }

  consume(kind: "modelRequests" | "toolCalls") {
    if (this.exhausted) throw this.exhausted;
    if (this.limits.deadlineAt !== undefined && Date.now() >= this.limits.deadlineAt) {
      this.exhausted = new Error("Shared execution deadline reached; completed work is retained.");
      throw this.exhausted;
    }
    const limit =
      kind === "modelRequests" ? this.limits.maxModelRequests : this.limits.maxToolCalls;
    if (this[kind] >= limit) {
      this.exhausted = new Error(
        `Shared execution budget exhausted: ${kind} ${this[kind]}/${limit}. ` +
          "Completed work is retained; no further request/tool was admitted.",
      );
      throw this.exhausted;
    }
    // Admission is synchronous: concurrent delegates cannot spend the same slot.
    this[kind] += 1;
  }

  snapshot() {
    return {
      scope: "current_host_execution" as const,
      modelRequests: { used: this.modelRequests, limit: this.limits.maxModelRequests },
      toolCalls: { used: this.toolCalls, limit: this.limits.maxToolCalls },
      durable: false,
      includesCompaction: false,
      includesDeviceDelegates: false,
      exhausted: this.exhausted !== undefined,
      ...(this.limits.deadlineAt === undefined ? {} : { deadlineAt: this.limits.deadlineAt }),
    };
  }
}
