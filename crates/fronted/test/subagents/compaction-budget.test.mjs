import assert from "node:assert/strict";
import test from "node:test";
import { createAgentToolCall, createAssistant, createDefaultCompactionMock, createSubagentHarness } from "./harness.mjs";

test("each delegate private compaction shares the parent budget and cannot bypass exhaustion on its next model request", async () => {
  let summaries = 0;
  const Base = createDefaultCompactionMock([]).CompactionController;
  class Compaction extends Base {
    bindTurn(binding) { super.bindTurn(binding); this.binding = binding; }
    async compactDuringRun() {
      await this.binding.complete({ providerId: this.binding.providerId, model: this.binding.model, runtime: this.binding.runtime, context: { messages: [] } });
      return { context: null, shouldDisableProtection: false };
    }
  }
  const h = await createSubagentHarness({ forceReadonly: true, persistBatchReceipts: true,
    schedulerLimits: { executionBudget: { maxModelRequests: 1, maxToolCalls: 4 } },
    compactionMock: { CompactionController: Compaction },
    completeAssistantMessage: async params => { await params.beforeModelRequest(); summaries++; return createAssistant("Actual summary"); },
    runner: async params => {
      await params.onBeforeNextTurn({ emittedMessages: [createAssistant("Read source")] });
      params.subagentScheduler.executionBudget.consume("modelRequests");
      assert.fail("must not start next request after summary spent its last slot");
    },
  });
  const call = createAgentToolCall({ agents: [{ id: "review", prompt: "Inspect actual sources", mode: "readonly" }] });
  const result = await h.bundle.executeToolCall(call);
  assert.equal(summaries, 1); assert.equal(result.isError, true);
  assert.match(result.details.agents[0].error, /execution budget exhausted/);
  assert.equal(h.scheduler.executionBudget.snapshot().modelRequests.used, 1);
  assert.equal((await h.store.recoverBatchReceipt(call)).isError, true);
});
