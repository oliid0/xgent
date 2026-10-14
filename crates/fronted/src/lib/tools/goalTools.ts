import type { Tool, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createGoalBackend } from "../automation/goalBackend";
import type { GoalApplyInput } from "../automation/goals";
import { GOAL_CATEGORIES, validateGoalConfig } from "../automation/goals";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";
import type { ToolCommandPort } from "./toolCommandPort";

const id = Type.String({ minLength: 1, maxLength: 80, pattern: "^[a-zA-Z0-9_-]+$" });
const config = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.String({ maxLength: 8000 }),
  category: Type.Union(GOAL_CATEGORIES.map((value) => Type.Literal(value))),
  parentId: Type.Union([id, Type.Null()]),
  steps: Type.Array(
    Type.Object({ id, title: Type.String({ minLength: 1, maxLength: 160 }), done: Type.Boolean() }),
    { maxItems: 40 },
  ),
});
const operation = Type.Union([
  Type.Object({ op: Type.Literal("create"), id, config }),
  Type.Object({ op: Type.Literal("update"), id, config }),
  Type.Object({
    op: Type.Literal("set_status"),
    id,
    status: Type.Union([Type.Literal("active"), Type.Literal("paused"), Type.Literal("completed")]),
  }),
  Type.Object({ op: Type.Literal("set_step"), id, step_id: id, done: Type.Boolean() }),
  Type.Object({
    op: Type.Literal("link_task"),
    id,
    task_id: Type.String({ minLength: 1 }),
    follow_up: Type.Optional(Type.Boolean()),
  }),
  Type.Object({ op: Type.Literal("unlink_task"), id, task_id: Type.String({ minLength: 1 }) }),
  Type.Object({
    op: Type.Literal("link_work"),
    id,
    request_id: Type.String({ minLength: 36, maxLength: 36 }),
  }),
  Type.Object({
    op: Type.Literal("unlink_work"),
    id,
    request_id: Type.String({ minLength: 36, maxLength: 36 }),
  }),
  Type.Object({ op: Type.Literal("delete"), id }),
]);
const tool: Tool = {
  name: "GoalManager",
  description:
    "For explicitly requested ongoing goal follow-up, use link_task with follow_up=true on an already enabled configured Auto Prompt schedule. Default/omitted follow_up keeps tracking-only association; false disables follow-up without stopping independent schedules. Explicit follow-up receives bounded fresh native goal progress, original work/host observations and artifact hints at claim time, plus workspace memory. Choose cadence/provider/workspace with CronTaskManager only when the user requested recurring/ongoing execution. Changed target bindings block follow-up until explicitly re-enabled; followUpBlocked reports that current reason. Linking creates no timer or grant. Inspect active work before starting more; use a fresh full GoalManager read for changes or goal_binding. " +
    "To execute work for an existing active goal, BackgroundTask submit can take goal_binding with this storeId, goalId and current revision; on a supported execution host acceptance and association commit together. The revision in its receipt is the original accepted version, so read a fresh snapshot before subsequent goal edits. Never send this binding to a different goal store or automatically inherit it when delegating a child. " +
    "Read and maintain durable user goals, steps, actual activity and published artifact manifests. Only create a tracked goal when the user explicitly asks to track/save a clear goal or confirms its plan. Read the current snapshot before every change; preserve unrelated goals and completed steps. Never invent progress. apply requires its current revision and a unique requestId reused unchanged for retries after a lost response; create also requires a new unique goal id. Activity and artifacts are paginated actual records, not proof of goal completion. Use CronTaskManager to create schedules, then link_task with its returned task_id. link_work requires the original request_id of a background task already accepted in this execution store; backgroundTargets lists actual accepted requests. If acceptance is uncertain, inspect that exact request before linking or resubmitting; never invent IDs or link a different execution. Linking, unlinking, pausing, completing or deleting a goal never starts/stops/cancels independent schedules or background tasks. Change execution explicitly with its existing task tools if requested. A successful run does not by itself complete a goal. Stored goals and personal data belong to this execution store and are not credentials. Do not expose internal IDs in ordinary replies.",
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("read"),
      Type.Literal("apply"),
      Type.Literal("activity"),
      Type.Literal("artifacts"),
    ]),
    goal_id: Type.Optional(id),
    input: Type.Optional(
      Type.Object({
        revision: Type.Integer({ minimum: 0 }),
        requestId: Type.String({ minLength: 1, maxLength: 200 }),
        operation,
      }),
    ),
    cursor: Type.Optional(
      Type.Union([
        Type.Null(),
        Type.Object({
          at: Type.Integer({ minimum: 0 }),
          id: Type.String({ minLength: 1, maxLength: 200 }),
        }),
      ]),
    ),
  }),
};

export function createGoalTools(params: { commandPort?: ToolCommandPort }): BuiltinToolBundle {
  const backend = createGoalBackend(params.commandPort);
  return {
    groupId: "memory",
    tools: [tool],
    metadataByName: createBuiltinMetadataMap([
      [
        tool.name,
        { groupId: "memory", kind: "system", isReadOnly: false, displayCategory: "system" },
      ],
    ]),
    async executeToolCall(call, signal): Promise<ToolResultMessage> {
      let data: unknown,
        isError = false;
      try {
        signal?.throwIfAborted();
        if (call.name !== tool.name) throw new Error("Unknown goal tool");
        const args = call.arguments as {
          action?: string;
          goal_id?: string;
          input?: GoalApplyInput;
          cursor?: { at: number; id: string } | null;
        };
        if (args.action === "read") {
          const snapshot = await backend.snapshot();
          if (args.goal_id) {
            const goal = snapshot.goals.find((goal) => goal.id === args.goal_id);
            if (!goal) throw new Error("goals.missing");
            data = { revision: snapshot.revision, storeId: snapshot.storeId, goal };
          } else data = snapshot;
        } else if (args.action === "artifacts") {
          if (!args.goal_id) throw new Error("goals.missing");
          data = await backend.artifacts(args.goal_id, args.cursor);
        } else if (args.action === "activity") {
          if (!args.goal_id) throw new Error("goals.missing");
          data = await backend.activity(args.goal_id, args.cursor);
        } else if (args.action === "apply") {
          if (
            !args.input ||
            !Number.isSafeInteger(args.input.revision) ||
            args.input.revision < 0 ||
            !args.input.requestId
          )
            throw new Error("goals.invalidConfig");
          if (args.input.operation.op === "create" || args.input.operation.op === "update")
            validateGoalConfig(args.input.operation.config);
          data = await backend.apply(args.input);
        } else throw new Error("Unknown goal action");
      } catch (failure) {
        isError = true;
        data = failure instanceof Error ? failure.message : String(failure);
      }
      return {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }],
        details: {},
        isError,
        timestamp: Date.now(),
      };
    },
  };
}
