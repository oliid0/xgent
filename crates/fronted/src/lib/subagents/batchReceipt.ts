import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { sha256Hex } from "../trajectory/sha256";
import type { SubagentRunStateRecord, SubagentStoreIpc } from "./ipc/store";
import type { SubagentBatchDetails } from "./protocol";

const MAX_RECEIPT_BYTES = 1024 * 1024;
const bytes = (value: string) => new TextEncoder().encode(value).length;

function matchingBatch(call: ToolCall, receipt: ToolResultMessage): SubagentBatchDetails | null {
  const requested = (call.arguments as { agents?: { id?: string; prompt?: string }[] })?.agents;
  const details = receipt?.details as SubagentBatchDetails | undefined;
  if (
    call.name !== "Agent" ||
    receipt?.role !== "toolResult" ||
    receipt.toolName !== call.name ||
    receipt.toolCallId !== call.id ||
    typeof receipt.isError !== "boolean" ||
    !Array.isArray(receipt.content) ||
    !Array.isArray(requested) ||
    !requested.length ||
    requested.length > 8 ||
    details?.kind !== "subagent_batch" ||
    details.status !== "ok" ||
    details.agentCount !== requested.length ||
    !Array.isArray(details.agents) ||
    details.agents.length !== requested.length
  )
    return null;
  const ids = new Set<string>();
  for (let i = 0; i < requested.length; i++) {
    const request = requested[i];
    const report = details.agents[i];
    if (
      !request ||
      typeof request.id !== "string" ||
      typeof request.prompt !== "string" ||
      report?.id !== request.id.trim() ||
      report.prompt !== request.prompt.trim() ||
      !["completed", "failed", "cancelled"].includes(report.status) ||
      typeof report.summary !== "string" ||
      (report.readOnlyTools !== undefined && typeof report.readOnlyTools !== "boolean") ||
      typeof report.runId !== "string" ||
      !report.runId ||
      ids.has(report.runId)
    )
      return null;
    ids.add(report.runId);
  }
  if (receipt.isError !== details.agents.some((report) => report.status !== "completed"))
    return null;
  return details;
}

async function verifiedRuns(
  ipc: SubagentStoreIpc,
  conversationId: string,
  call: ToolCall,
  details: SubagentBatchDetails,
) {
  const records: SubagentRunStateRecord[] = [];
  for (const [index, report] of details.agents.entries()) {
    const record = await ipc.loadRun(report.runId);
    const run = record?.run;
    if (
      !run ||
      run.parentConversationId !== conversationId ||
      run.parentToolCallId !== call.id ||
      run.agentId !== report.id ||
      run.agentIndex !== index ||
      run.agentTotal !== details.agents.length ||
      run.prompt !== report.prompt ||
      run.status !== report.status ||
      run.mode !== report.mode ||
      run.readOnlyTools !== report.readOnlyTools ||
      (run.summary ?? "").trim() !== report.summary.trim() ||
      (run.error ?? "").trim() !== (report.error ?? "").trim() ||
      run.roundCount !== report.rounds ||
      run.toolCallCount !== report.toolCalls ||
      run.providerConfigId !== report.providerConfigId ||
      run.providerId !== report.providerId ||
      run.model !== report.model ||
      !run.endedAt
    )
      return null;
    records.push(record);
  }
  return records;
}

/** Save the actual settled batch, including worktree outcomes, before returning
 * it to the parent journal. Summary text is never used to reconstruct success. */
export async function persistSubagentBatchReceipt(
  ipc: SubagentStoreIpc,
  conversationId: string,
  call: ToolCall,
  receipt: ToolResultMessage,
) {
  const details = matchingBatch(call, receipt);
  if (!details) return;
  const records = await verifiedRuns(ipc, conversationId, call, details);
  if (!records) {
    // A rejected/queued-before-start member has no real terminal run. Keep
    // its live error report, but do not invent recoverable batch evidence.
    if (receipt.isError) return;
    throw new Error("Completed subordinate batch has no matching durable terminal runs");
  }
  const batchReceiptJson = JSON.stringify({
    version: 1,
    argumentsHash: sha256Hex(JSON.stringify(call.arguments)),
    receipt,
  });
  if (bytes(batchReceiptJson) > MAX_RECEIPT_BYTES)
    throw new Error("Subordinate batch receipt exceeds the durable receipt limit");
  const first = records[0];
  const { updatedAt: _updatedAt, ...header } = first.run;
  await ipc.saveRun({ run: { ...header, batchReceiptJson }, segments: first.segments });
}

/** Runtime/native evidence, not the requested mode's label: a readonly agent
 * may carry write-capable MCP tools. Unknown/legacy proofs never permit retry. */
export async function verifyReadOnlySubagentBatchReceipt(
  ipc: SubagentStoreIpc,
  conversationId: string,
  call: ToolCall,
  receipt: ToolResultMessage,
): Promise<boolean> {
  const details = matchingBatch(call, receipt);
  if (!details || !(await verifiedRuns(ipc, conversationId, call, details))) return false;
  return details.agents.every(
    (report) => report.mode === "readonly" && report.readOnlyTools === true,
  );
}

/** Read only: never starts/resumes agents or settles a worktree on recovery. */
export async function recoverSubagentBatchReceipt(
  ipc: SubagentStoreIpc,
  conversationId: string,
  call: ToolCall,
): Promise<ToolResultMessage | null> {
  if (call.name !== "Agent") return null;
  const runs = await ipc.listRuns({
    parentConversationId: conversationId,
    parentToolCallId: call.id,
    limit: 256,
  });
  for (const run of runs) {
    if (
      run.parentConversationId !== conversationId ||
      run.parentToolCallId !== call.id ||
      !run.batchReceiptJson
    )
      continue;
    if (bytes(run.batchReceiptJson) > MAX_RECEIPT_BYTES)
      throw new Error("Stored subordinate batch receipt exceeds its limit");
    const stored = JSON.parse(run.batchReceiptJson) as {
      version: number;
      argumentsHash: string;
      receipt: ToolResultMessage;
    };
    if (stored.version !== 1 || stored.argumentsHash !== sha256Hex(JSON.stringify(call.arguments)))
      continue;
    const details = matchingBatch(call, stored.receipt);
    if (
      !details ||
      details.agents[0].runId !== run.id ||
      !(await verifiedRuns(ipc, conversationId, call, details))
    )
      throw new Error(
        "Stored subordinate batch receipt does not match its completed runs or terminal failures",
      );
    return stored.receipt;
  }
  return null;
}
