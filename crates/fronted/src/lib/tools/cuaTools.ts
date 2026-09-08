import type {
  ImageContent,
  TextContent,
  Tool,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { invoke, listen } from "@xgent/runtime";
import { activityObservation, executionActivityStore } from "../chat/executionActivityStore";

import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";
import { createCuaDriverAdapter } from "./cuaDriverAdapter";
import {
  createToolRunId,
  invokeWithAbort,
  requestRuntimeCancel,
  waitForAbortablePromise,
} from "./invokeWithAbort";
import type { createMcpTools } from "./mcpTools";

const CUA_OPERATIONS = [
  "list_apps",
  "launch_app",
  "get_app_state",
  "click",
  "perform_secondary_action",
  "scroll",
  "drag",
  "type_text",
  "press_key",
  "set_value",
  "sequence",
  "input",
] as const;

type CuaOperation = (typeof CUA_OPERATIONS)[number];

type CuaCallResponse = {
  content: (TextContent | ImageContent)[];
  isError: boolean;
  details: unknown;
};

let callTail: Promise<void> = Promise.resolve();

async function withCuaLock<T>(run: () => Promise<T>, signal?: AbortSignal) {
  const previous = callTail;
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  callTail = previous.catch(() => undefined).then(() => current);
  try {
    await waitForAbortablePromise(
      previous.catch(() => undefined),
      signal,
    );
    return await run();
  } finally {
    release();
  }
}

const cuaTool = {
  name: "cua",
  description:
    "Operate desktop applications through one state-grounded computer-use engine. Prefer reliable app APIs/scripts for bulk work, semantic controls for forms, and screenshot input for visual surfaces. Use list_apps to discover running windows and installed applications; an absent window does not mean an application is not installed. On Windows, use launch_app with an installed app_id, then list_apps to obtain its window target. On macOS get_app_state can launch by bundle ID. Use get_app_state before actions; inspect every returned state and never repeat completed work. Use sequence for up to 20 known dependent steps on one app, with optional expected_text preconditions. Sequences run locally and stop at the first stale state, unmet condition, cancellation or error. Use observation=text for semantic work and observation=image for canvas/3D surfaces to reduce capture or accessibility cost. A dispatched action is not proof of task success: verify its postcondition in the returned state. Failures may have side effects; observe before retrying. Do not target Xgent itself.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["operation"],
    properties: {
      operation: {
        type: "string",
        enum: CUA_OPERATIONS,
        description: "Computer-use operation to perform.",
      },
      keys: {
        type: "array",
        maxItems: 8,
        items: { type: "string" },
        description: "Keys held together for an input burst, e.g. W, A, Shift.",
      },
      buttons: {
        type: "array",
        maxItems: 3,
        items: { type: "string", enum: ["left", "middle", "right"] },
      },
      dx: {
        type: "integer",
        minimum: -4096,
        maximum: 4096,
        description:
          "Relative pointer motion during input for captured game cameras and 3D viewports.",
      },
      dy: { type: "integer", minimum: -4096, maximum: 4096 },
      duration_ms: {
        type: "integer",
        minimum: 1,
        maximum: 2000,
        description:
          "Required for input. Holds keys/buttons concurrently, moves locally, then releases inputs and observes.",
      },
      observation: {
        type: "string",
        enum: ["auto", "text", "image"],
        description:
          "auto returns both; text omits screenshots; image omits accessibility traversal.",
      },
      max_image_size: { type: "integer", minimum: 320, maximum: 1920 },
      settle_ms: {
        type: "integer",
        minimum: 0,
        maximum: 1000,
        description:
          "Local delay before observing an action, default 80ms. Zero is suitable only when the app exposes synchronous state.",
      },
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          required: ["operation"],
          additionalProperties: false,
          properties: {
            operation: {
              type: "string",
              enum: ["click", "scroll", "drag", "type_text", "press_key", "set_value"],
            },
            expected_text: {
              type: "string",
              description:
                "Case-insensitive text required in the latest observation before this step; stops without acting if absent.",
            },
            element_index: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
            from_x: { type: "number" },
            from_y: { type: "number" },
            to_x: { type: "number" },
            to_y: { type: "number" },
            text: { type: "string" },
            key: { type: "string" },
            value: { type: "string" },
            direction: { type: "string", enum: ["up", "down", "left", "right"] },
            pages: { type: "number", minimum: 0.01, maximum: 20 },
            click_count: { type: "integer", minimum: 1, maximum: 3 },
            mouse_button: { type: "string", enum: ["left", "right", "middle"] },
            modifiers: {
              type: "array",
              items: { type: "string", enum: ["Shift", "Control", "Alt", "Meta"] },
            },
          },
        },
      },
      app: { type: "string", description: "App name or bundle identifier." },
      state_id: {
        type: "string",
        description:
          "The state_id from the latest get_app_state or action result. Required before applying an action; a stale id returns refreshed state without applying it.",
      },
      modifiers: {
        type: "array",
        items: { type: "string", enum: ["Shift", "Control", "Alt", "Meta"] },
        description:
          "Modifier keys held only during this mouse/keyboard action and always released afterward.",
      },
      element_index: { type: "string", description: "Element identifier from get_app_state." },
      action: { type: "string", description: "Secondary accessibility action name." },
      x: { type: "number", description: "Click X in screenshot pixels." },
      y: { type: "number", description: "Click Y in screenshot pixels." },
      click_count: { type: "integer", minimum: 1, description: "Click count; defaults to 1." },
      mouse_button: { type: "string", enum: ["left", "right", "middle"] },
      click_method: {
        type: "string",
        enum: ["auto", "accessibility", "app_post", "sky_click", "global"],
      },
      from_x: { type: "number" },
      from_y: { type: "number" },
      to_x: { type: "number" },
      to_y: { type: "number" },
      direction: { type: "string", enum: ["up", "down", "left", "right"] },
      pages: { type: "number", description: "Pages to scroll; defaults to 1." },
      key: { type: "string", description: "Key or key combination to press." },
      text: { type: "string", description: "Literal text to type." },
      value: { type: "string", description: "Value for a settable accessibility element." },
      text_limit: {
        anyOf: [
          { type: "integer", minimum: 1 },
          { type: "string", enum: ["max"] },
        ],
      },
      max_tree_nodes: { type: "integer", minimum: 1 },
      max_tree_depth: { type: "integer", minimum: 1 },
    },
  },
} satisfies Tool;

function errorResult(toolCall: ToolCall, error: unknown): ToolResultMessage {
  const message = error instanceof Error ? error.message : String(error);
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text: message || "Computer use failed" }],
    details: { kind: "cua" },
    isError: true,
    timestamp: Date.now(),
  };
}

export function createCuaTools(
  params: {
    conversationId?: string;
    android?: boolean;
    driver?: Awaited<ReturnType<typeof createMcpTools>>;
    driverServerIds?: readonly string[];
  } = {},
): BuiltinToolBundle {
  const adapter = createCuaDriverAdapter(params.driver, params.driverServerIds ?? []);
  const tool = params.android
    ? {
        ...cuaTool,
        description:
          "Operate apps on this Android device using native accessibility and touch input. Enable Xgent Computer Use in Android Accessibility settings first. Use list_apps to obtain package IDs, then get_app_state with app=package ID to launch and observe. Coordinates are full-screen screenshot pixels. Use the latest state_id for every action and inspect its returned state. type_text inserts into the focused text field; set_value replaces its value. press_key supports Back, Home, Enter and Control+A. Touch clicks are left-button taps. Use scroll once per observed screen. Screenshots require Android 11 or later; protected screens may only expose semantic elements.",
        parameters: {
          ...cuaTool.parameters,
          properties: {
            ...cuaTool.parameters.properties,
            operation: {
              type: "string",
              enum: CUA_OPERATIONS.filter(
                (operation) =>
                  !["input", "sequence", "perform_secondary_action"].includes(operation),
              ),
            },
          },
        },
      }
    : cuaTool;
  return {
    groupId: "system",
    tools: [tool],
    metadataByName: createBuiltinMetadataMap([
      [
        cuaTool.name,
        {
          groupId: "system",
          kind: "cua",
          isReadOnly: false,
          displayCategory: "system",
        },
      ],
    ]),
    async executeToolCall(toolCall: ToolCall, signal?: AbortSignal) {
      try {
        const input =
          toolCall.arguments && typeof toolCall.arguments === "object"
            ? { ...(toolCall.arguments as Record<string, unknown>) }
            : {};
        const operation = String(input.operation ?? "") as CuaOperation;
        if (!CUA_OPERATIONS.includes(operation)) {
          throw new Error(`Unknown CUA operation: ${operation || "(missing)"}`);
        }
        delete input.operation;

        return await waitForAbortablePromise(
          withCuaLock(async () => {
            const status = await invoke<{ enabled: boolean }>("cua_status");
            if (!status.enabled) {
              throw new Error(
                "CUA is disabled. Enable it in Settings > Computer use. This is not evidence that the target application is missing.",
              );
            }
            const started = performance.now();
            const runId = createToolRunId("cua", toolCall.id);
            const record = (response?: CuaCallResponse, step?: number) => {
              executionActivityStore.record(params.conversationId, {
                id: step === undefined ? runId : `${runId}:${step}`,
                kind: "cua",
                app: typeof input.app === "string" ? input.app : undefined,
                title: `${operation} · ${String(input.app ?? "")}`,
                ...activityObservation(response?.content ?? []),
                status: response ? (response.isError ? "error" : "complete") : "running",
              });
            };
            record();
            if (adapter?.owns(String(input.app ?? ""), input.state_id)) {
              try {
                const response = await adapter.execute(toolCall, operation, input, signal);
                record({
                  content: response.content,
                  isError: response.isError,
                  details: response.details,
                });
                return { ...response, toolName: toolCall.name };
              } catch (error) {
                record({
                  content: [{ type: "text", text: String(error) }],
                  isError: true,
                  details: null,
                });
                throw error;
              }
            }
            const unlisten = params.conversationId
              ? await listen<{ runId: string; step: number; response: CuaCallResponse }>(
                  "cua-activity",
                  ({ payload }) => {
                    if (payload.runId === runId) record(payload.response, payload.step);
                  },
                ).catch(() => undefined)
              : undefined;
            const cancel = () =>
              params.android
                ? void invoke("cua_cancel", { run_id: runId }).catch(() => undefined)
                : requestRuntimeCancel(runId);
            signal?.addEventListener("abort", cancel, { once: true });
            let response: CuaCallResponse;
            try {
              try {
                response = await invokeWithAbort<CuaCallResponse>(
                  "cua_call",
                  {
                    operation,
                    arguments: input,
                    run_id: runId,
                  },
                  undefined,
                );
              } catch (error) {
                response = {
                  content: [{ type: "text", text: String(error) }],
                  isError: true,
                  details: null,
                };
              }
            } finally {
              unlisten?.();
              signal?.removeEventListener("abort", cancel);
            }
            record(response);
            if (
              response.isError &&
              adapter &&
              !signal?.aborted &&
              ["list_apps", "get_app_state"].includes(operation)
            ) {
              try {
                const recovered = await adapter.execute(toolCall, operation, input);
                if (!recovered.isError) {
                  record({
                    content: recovered.content,
                    isError: false,
                    details: recovered.details,
                  });
                  return { ...recovered, toolName: toolCall.name };
                }
              } catch {
                /* Preserve the original correlated error if observation recovery fails. */
              }
            }
            return {
              role: "toolResult",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: response.content ?? [],
              details: {
                ...(response.details && typeof response.details === "object"
                  ? response.details
                  : {}),
                kind: "cua",
                operation,
                native: response.details,
                elapsedMs: Math.round(performance.now() - started),
              },
              isError: Boolean(response.isError),
              timestamp: Date.now(),
            };
          }, signal),
          signal,
        );
      } catch (error) {
        return errorResult(toolCall, error);
      }
    },
  };
}
