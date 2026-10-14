import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { backend } from "../automation/backend";
import { captureBackgroundLease } from "../automation/backgroundLease";
import type { BackgroundExecutionLease } from "../automation/types";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";

export function createOriginalDeviceTaskTools(
  executionId: string,
  executionLease: BackgroundExecutionLease,
): BuiltinToolBundle {
  const lease = captureBackgroundLease(executionLease);
  const tool: Tool = {
    name: "OriginalDeviceTask",
    description:
      "Plan an accepted ORIGINAL-phone branch using this controller model. inspect reads the phone's current native authorized scopes and retained calls. request_read queues one scoped native SDK observation: list_calendars request={kind:event|reminder}; list_calendar_events request={startMs,endMs,limit:1..200}; list_reminders request={incompleteOnly,limit:1..200}; read_health_samples uses the exact reviewed metric/time window. Calendar/account scope is enforced on the phone; never inject calendar IDs into read requests. Supply the actual scope_key from inspect. Queuing is not a read result: finish independent work, RecordBackgroundOutcome wait and stop normally. The original phone publishes native observations and wakes this SAME task without a phone model. read_result uses result_call_id and bounded UTF-8 chunks; follow nextOffset with snapshot_hash. Data may be truncated/access-limited and grants no writes. After reading real writable calendar/list/source IDs, propose complete actions [{kind:calendar_event|reminder,sourceId,request:{...}}]. Events require explicit calendarId,title,startMs,endMs; reminders require calendarId,title and positive dueMs for daily/weekly recurrence. Preserve every original requirement and original request clock. The phone validates/fixes ownership, freezes the exact plan and executes only within its current policy/OS/task authorization. A draft/accepted plan is NOT effect completion; only native phone receipts verify this branch. Never call a PC's calendar or invent account IDs. Await the original pending call; do not poll using model turns or replace uncertain work. Changed/revoked scopes stop new data/actions. inspect again after a native wake; previously read pending results remain historical snapshots.",
    parameters: Type.Object(
      {
        action: Type.Union([
          Type.Literal("inspect"),
          Type.Literal("request_read"),
          Type.Literal("read_result"),
          Type.Literal("propose"),
        ]),
        branch_id: Type.String({ minLength: 1, maxLength: 64 }),
        scope_key: Type.Optional(Type.String({ minLength: 64, maxLength: 64 })),
        read_action: Type.Optional(
          Type.Union([
            Type.Literal("list_calendars"),
            Type.Literal("list_calendar_events"),
            Type.Literal("list_reminders"),
            Type.Literal("read_health_samples"),
          ]),
        ),
        request: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        actions: Type.Optional(Type.Array(Type.Unknown(), { minItems: 1, maxItems: 8 })),
        result_call_id: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        scope_offset: Type.Optional(Type.Integer({ minimum: 0 })),
        snapshot_hash: Type.Optional(Type.String({ minLength: 64, maxLength: 64 })),
      },
      { additionalProperties: false },
    ),
  };
  tool.description +=
    " Source routing v2 observation branches are read-only: use the exact health metric/startMs/endMs/limit from source.observation with read_health_samples. Never propose writes for them. Native joining verifies the retained SDK read and releases dependent work; inspect/read_result still work for that completed read branch while this root task is active. Read all needed actual result chunks before interpreting samples. Empty, access-limited or truncated data cannot prove normal health or successful notification.";
  return {
    groupId: "system",
    tools: [tool],
    metadataByName: createBuiltinMetadataMap([
      [
        tool.name,
        { groupId: "system", kind: "system", isReadOnly: false, displayCategory: "system" },
      ],
    ]),
    async executeToolCall(call: ToolCall, signal?: AbortSignal): Promise<ToolResultMessage> {
      signal?.throwIfAborted();
      if (call.name !== tool.name) throw new Error("Unknown original-device planning tool");
      let result: ToolResultMessage;
      try {
        result = await backend.planOriginalDevice(executionId, call.id, lease);
      } catch (error) {
        signal?.throwIfAborted();
        // This is the SAME local native intent/transaction, never a resend of
        // an SDK effect. A committed native tool receipt is returned unchanged.
        try {
          result = await backend.planOriginalDevice(executionId, call.id, lease);
        } catch {
          throw error;
        }
      }
      if (
        result?.role !== "toolResult" ||
        result.toolName !== tool.name ||
        result.toolCallId !== call.id ||
        typeof result.isError !== "boolean" ||
        !Array.isArray(result.content) ||
        result.details?.kind !== "original_device_planning"
      )
        throw new Error("Native original-device planning receipt changed its intent");
      return result;
    },
  };
}
