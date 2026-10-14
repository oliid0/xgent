import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { backend } from "../automation/backend";
import { captureBackgroundLease } from "../automation/backgroundLease";
import type { BackgroundExecutionLease, BackgroundOutcomeReport } from "../automation/types";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";

export const isBackgroundOutcomeStateCall = (call: ToolCall) =>
  call.name === "RecordBackgroundOutcome" || call.name === "OriginalDeviceTask";

function pageReport(report: BackgroundOutcomeReport | null, branchId?: string, cursor = 0) {
  if (!report) return { plan: null, verified: false };
  const branches = branchId
    ? report.branches.filter((branch) => branch.branch.id === branchId)
    : report.branches.slice(cursor, cursor + 2);
  if (branchId && !branches.length) throw new Error("Unknown background branch");
  return {
    verified: report.verified,
    branches: branches.map((branch) => ({
      ...branch,
      evidence: branch.evidence && {
        ...branch.evidence,
        answer: branch.evidence.answer?.slice(0, 4096) ?? null,
        answerExcerpt: (branch.evidence.answer?.length ?? 0) > 4096,
      },
    })),
    nextBranchCursor: !branchId && cursor + 2 < report.branches.length ? cursor + 2 : null,
  };
}

export function createBackgroundOutcomeTools(
  executionId: string,
  executionLease: BackgroundExecutionLease,
): BuiltinToolBundle {
  const lease = captureBackgroundLease(executionLease);
  const record: Tool = {
    name: "RecordBackgroundOutcome",
    description:
      "Record one durable requested outcome for this execution. verify requires actual published artifact_ids, actual successful operation call_ids matching the declared tool/target arguments, or the actual text answer when the criterion is answer. All branch criteria and dependencies must be satisfied. wait preserves a concrete missing capability/information/permission reason; continue independent available branches. wait_for_child_call_id waits for an actually accepted BackgroundTask submit call on this execution; native observation resumes the same parked context once the child settles, without model polling. This is not verification: read child results and inspect actual deliverables after resuming. Never substitute a text claim for an external action or file. Verified evidence and the plan cannot be overwritten. This changes task state only; it does not perform external actions.",
    parameters: Type.Object({
      branch_id: Type.String({ minLength: 1, maxLength: 64 }),
      action: Type.Union([Type.Literal("verify"), Type.Literal("wait")]),
      artifact_ids: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 8 })),
      call_ids: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 8 })),
      answer: Type.Optional(Type.String()),
      reason: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
      wait_for_cloud_call_id: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 256,
          description:
            "For action=wait: the actual successful CloudTaskManager start call ID from this execution's retained receipts. Park after finishing independent work; the PC worker checks the acknowledged Actions job without using the model or requiring the phone online, and resumes the SAME task on terminal success/failure/cancellation. Never supply or invent a task/repository ID.",
        }),
      ),
      wait_for_child_call_id: Type.Optional(
        Type.String({
          maxLength: 256,
          description:
            "For wait: actual accepted BackgroundTask submit call ID from this execution. Native PC discovery observes the original child, then resumes the same parked task on terminal outcome; no model polling or duplicate delegation. Inspect/download actual child results before verifying parent criteria.",
        }),
      ),
      wait_for_video_call_id: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 256,
          description:
            "For wait: original accepted GenerateVideo call ID from this execution. Continue independent work before parking. Native PC polling/download retains real bytes and wakes the same context on terminal observation, without model polling or requiring the phone. Read VideoJob and verify the real artifact after continuation.",
        }),
      ),
      wait_for_tool: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 256,
          description:
            "Only for a declared operation tool that is temporarily unavailable: exact tool name from the branch criterion. The worker checks actual availability under unchanged configuration. Omit for missing input, permissions or an unavailable criterion.",
        }),
      ),
      wait_for_capabilities: Type.Optional(
        Type.Boolean({
          description:
            "Only for a declared unavailable capability caused by connector/tool discovery: resume when the actual tool inventory gains tools under the same accepted configuration. Omit for missing user input or permissions.",
        }),
      ),
    }),
  };
  const read: Tool = {
    name: "ReadBackgroundOutcomes",
    description:
      "Read this task's durable branches plus actual artifact IDs and paginated operation call IDs. Follow nextBranchCursor and nextCursor using branch_cursor and receipt_cursor. branch_id selects a requirement. Branch answers over 4096 characters are explicit excerpts; the complete text remains in the native task result. Receipt listings identify candidates, not proof: verification checks real complete successful receipts and target arguments. reconciledChildAcceptance preserves an original recovered submit/resume ACK; childCompleted separately reports whether that original delegated work is confirmed successfully complete. Acceptance alone never verifies the branch. Never replay a write just to produce evidence.",
    parameters: Type.Object({
      branch_id: Type.Optional(Type.String()),
      branch_cursor: Type.Optional(Type.Integer({ minimum: 0 })),
      receipt_cursor: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
  };
  return {
    groupId: "system",
    tools: [record, read],
    metadataByName: createBuiltinMetadataMap([
      [
        record.name,
        { groupId: "system", kind: "system", isReadOnly: false, displayCategory: "system" },
      ],
      [
        read.name,
        { groupId: "system", kind: "system", isReadOnly: true, displayCategory: "system" },
      ],
    ]),
    async executeToolCall(call, signal) {
      let result: unknown,
        isError = false;
      try {
        signal?.throwIfAborted();
        const args = call.arguments as Record<string, unknown>;
        if (call.name === read.name) {
          const cursor = (value: unknown) => {
            if (value === undefined) return 0;
            if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
              throw new Error("Outcome cursors must be non-negative safe integers");
            return value;
          };
          if (args.branch_id !== undefined && typeof args.branch_id !== "string")
            throw new Error("branch_id must be a string");
          const report = await backend.readBackgroundOutcomes(executionId, lease);
          const evidence = await backend.readBackgroundEvidenceOptions(
            executionId,
            cursor(args.receipt_cursor),
            lease,
          );
          result = {
            ...pageReport(report, args.branch_id as string | undefined, cursor(args.branch_cursor)),
            ...evidence,
          };
        } else if (call.name === record.name) {
          if (typeof args.branch_id !== "string" || !args.branch_id)
            throw new Error("branch_id is required");
          const ids = (value: unknown) => {
            if (value === undefined) return [];
            if (
              !Array.isArray(value) ||
              value.length > 8 ||
              value.some((id) => typeof id !== "string" || !id)
            )
              throw new Error("Evidence IDs must be actual bounded string arrays");
            return value as string[];
          };
          if (args.action === "wait") {
            if (args.wait_for_video_call_id !== undefined) {
              if (
                typeof args.wait_for_video_call_id !== "string" ||
                !args.wait_for_video_call_id.trim() ||
                args.wait_for_video_call_id.length > 256 ||
                typeof args.reason !== "string" ||
                !args.reason.trim() ||
                args.reason.length > 512 ||
                [
                  "wait_for_cloud_call_id",
                  "wait_for_child_call_id",
                  "wait_for_tool",
                  "wait_for_capabilities",
                  "answer",
                  "call_ids",
                  "artifact_ids",
                ].some((key) => args[key] !== undefined)
              )
                throw new Error(
                  "Video wait requires only its original accepted call ID and bounded reason",
                );
              result = pageReport(
                await backend.recordBackgroundVideoWait(
                  executionId,
                  args.branch_id,
                  args.wait_for_video_call_id,
                  args.reason,
                  lease,
                ),
                args.branch_id,
              );
            } else if (args.wait_for_child_call_id !== undefined) {
              if (
                typeof args.wait_for_child_call_id !== "string" ||
                !args.wait_for_child_call_id.trim() ||
                args.wait_for_child_call_id.length > 256 ||
                typeof args.reason !== "string" ||
                !args.reason.trim() ||
                args.reason.length > 512 ||
                args.wait_for_cloud_call_id !== undefined ||
                args.wait_for_tool !== undefined ||
                args.wait_for_capabilities !== undefined ||
                args.answer !== undefined ||
                args.call_ids !== undefined ||
                args.artifact_ids !== undefined
              )
                throw new Error(
                  "Child wait needs only an actual accepted call ID and bounded reason",
                );
              result = pageReport(
                await backend.recordBackgroundChildWait(
                  executionId,
                  args.branch_id,
                  args.wait_for_child_call_id,
                  args.reason,
                  lease,
                ),
                args.branch_id,
              );
            } else if (args.wait_for_cloud_call_id !== undefined) {
              if (
                typeof args.wait_for_cloud_call_id !== "string" ||
                !args.wait_for_cloud_call_id.trim() ||
                args.wait_for_cloud_call_id.length > 256 ||
                typeof args.reason !== "string" ||
                !args.reason.trim() ||
                args.reason.length > 512 ||
                args.wait_for_tool !== undefined ||
                args.wait_for_capabilities !== undefined ||
                args.answer !== undefined ||
                args.call_ids !== undefined ||
                args.artifact_ids !== undefined
              )
                throw new Error(
                  "Cloud wait needs only an acknowledged start call ID and bounded reason; discovery and verification are separate",
                );
              result = pageReport(
                await backend.recordBackgroundCloudWait(
                  executionId,
                  args.branch_id,
                  args.wait_for_cloud_call_id,
                  args.reason,
                  lease,
                ),
                args.branch_id,
              );
            } else {
              if (
                args.wait_for_capabilities !== undefined &&
                typeof args.wait_for_capabilities !== "boolean"
              )
                throw new Error("wait_for_capabilities must be boolean");
              if (
                args.wait_for_tool !== undefined &&
                (typeof args.wait_for_tool !== "string" || !args.wait_for_tool.trim())
              )
                throw new Error("wait_for_tool must name the exact declared tool");
              if (
                typeof args.reason !== "string" ||
                !args.reason.trim() ||
                args.answer !== undefined ||
                args.call_ids !== undefined ||
                args.artifact_ids !== undefined
              )
                throw new Error("wait needs only a concrete reason, not completion evidence");
              result = pageReport(
                await backend.recordBackgroundOutcome(
                  executionId,
                  args.branch_id,
                  null,
                  args.reason,
                  lease,
                  args.wait_for_tool as string | undefined,
                  args.wait_for_capabilities as boolean | undefined,
                ),
                args.branch_id,
              );
            }
          } else if (args.action === "verify") {
            if (
              args.wait_for_video_call_id !== undefined ||
              args.wait_for_cloud_call_id !== undefined ||
              args.wait_for_child_call_id !== undefined ||
              args.reason !== undefined ||
              args.wait_for_tool !== undefined ||
              args.wait_for_capabilities !== undefined ||
              (args.answer !== undefined && typeof args.answer !== "string")
            )
              throw new Error("verify needs actual evidence, not a waiting reason");
            result = pageReport(
              await backend.recordBackgroundOutcome(
                executionId,
                args.branch_id,
                {
                  artifactIds: ids(args.artifact_ids),
                  callIds: ids(args.call_ids),
                  answer: typeof args.answer === "string" ? args.answer : null,
                },
                null,
                lease,
              ),
              args.branch_id,
            );
          } else throw new Error("Unknown outcome action");
        } else throw new Error("Unknown background outcome tool");
        signal?.throwIfAborted();
      } catch (error) {
        isError = true;
        result = {
          error: error instanceof Error ? error.message : String(error),
          instruction:
            "Inspect the durable state and correct missing evidence; this tool did not perform an external action.",
        };
      }
      return {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: { kind: "background_outcome", result },
        isError,
        timestamp: Date.now(),
      };
    },
  };
}
