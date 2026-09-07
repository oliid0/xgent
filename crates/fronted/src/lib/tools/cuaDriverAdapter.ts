import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { invoke } from "@xgent/runtime";
import type { createMcpTools } from "./mcpTools";

type McpBundle = Awaited<ReturnType<typeof createMcpTools>>;
type RecordValue = Record<string, unknown>;
type Target = {
  pid: number;
  windowId: number;
  token: string;
  snapshotId?: string;
  text: string;
  hasScreenshot: boolean;
};
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};

function structured(result: ToolResultMessage) {
  return record(record(record(result.details).mcp).structuredContent);
}

/** Internal strategy adapter. The agent only sees Xgent's app/state/action contract. */
export function createCuaDriverAdapter(
  bundle: McpBundle | undefined,
  serverIds: readonly string[],
) {
  const targets = new Map<string, Target>();
  const serverId = serverIds.find((id) =>
    [...(bundle?.toolNameMap.values() ?? [])].some(
      (tool) => tool.serverId === id && tool.toolName === "get_window_state",
    ),
  );
  if (!bundle || !serverId) return null;
  const tools = new Map(
    bundle.tools.flatMap((tool) => {
      const mapped = bundle.toolNameMap.get(tool.name);
      return mapped?.serverId === serverId ? [[mapped.toolName, tool] as const] : [];
    }),
  );
  const key = (app: string) => `${serverId}:${app.trim().toLowerCase()}`;
  const result = (call: ToolCall, text: string, isError = false): ToolResultMessage => ({
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: "text", text }],
    details: { kind: "cua" },
    isError,
    timestamp: Date.now(),
  });
  const callTool = async (call: ToolCall, name: string, args: RecordValue) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`The installed computer-use runtime cannot perform ${name}.`);
    const schema = record(tool.parameters);
    const properties = record(schema.properties);
    // Refuse an incompatible installed contract before dispatching physical input.
    for (const name of Object.keys(args)) {
      if (!(name in properties))
        throw new Error(`The installed runtime does not support ${name} for ${tool.name}.`);
    }
    for (const required of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof required === "string" && args[required] === undefined)
        throw new Error(`Missing runtime argument: ${required}`);
    }
    return bundle.executeToolCall({ ...call, name: tool.name, arguments: args });
  };
  const windows = async (call: ToolCall) => {
    const response = await callTool(call, "list_windows", {});
    if (response.isError)
      throw new Error(
        response.content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n"),
      );
    const data = structured(response);
    if (!Array.isArray(data.windows))
      throw new Error("The runtime returned no structured window catalog.");
    const status = await invoke<{ hostPid: number }>("cua_status");
    if (!Number.isSafeInteger(status.hostPid))
      throw new Error("Cannot verify the computer-use host identity.");
    return data.windows
      .map(record)
      .filter(
        (window) =>
          Number.isSafeInteger(window.pid) &&
          Number(window.pid) > 0 &&
          window.pid !== status.hostPid &&
          Number.isSafeInteger(window.window_id),
      );
  };
  const observe = async (call: ToolCall, input: RecordValue) => {
    const app = String(input.app ?? "").trim();
    const query = app.toLowerCase();
    const candidates = (await windows(call)).filter((window) =>
      [
        `window:${window.window_id}`,
        String(window.pid),
        String(window.app_name ?? "").toLowerCase(),
        String(window.title ?? "").toLowerCase(),
      ].includes(query),
    );
    if (candidates.length !== 1)
      return result(
        call,
        candidates.length
          ? "Several windows match. Use a window:<id> from list_apps."
          : "No matching window. Use list_apps to select a target.",
        true,
      );
    const window = candidates[0];
    const args: RecordValue = { pid: window.pid, window_id: window.window_id };
    const properties = record(record(tools.get("get_window_state")?.parameters).properties);
    if ("max_elements" in properties) args.max_elements = input.max_tree_nodes ?? 300;
    if ("max_depth" in properties) args.max_depth = input.max_tree_depth ?? 16;
    if ("max_dimension" in properties) args.max_dimension = input.max_image_size ?? 1280;
    if ("include_screenshot" in properties) args.include_screenshot = input.observation !== "text";
    if ("include_accessibility_tree" in properties)
      args.include_accessibility_tree = input.observation !== "image";
    const response = await callTool(call, "get_window_state", args);
    if (response.isError) return response;
    const data = structured(response);
    const token = `cua-${crypto.randomUUID()}`;
    const target = {
      pid: Number(window.pid),
      windowId: Number(window.window_id),
      token,
      text: response.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n"),
      hasScreenshot: response.content.some((item) => item.type === "image"),
      snapshotId: typeof data.snapshot_id === "string" ? data.snapshot_id : undefined,
    };
    targets.set(key(app), target);
    targets.set(key(`window:${target.windowId}`), target);
    return {
      ...response,
      content: [
        {
          type: "text" as const,
          text: `state_id: ${token}\nTarget: window:${target.windowId}\nUse this state_id with the next cua action.`,
        },
        ...response.content,
      ],
      details: { kind: "cua", stateId: token, native: response.details },
    };
  };
  const adapter = {
    owns: (app: string, stateId: unknown) =>
      typeof stateId === "string" && stateId.startsWith("cua-") && targets.has(key(app)),
    async execute(
      call: ToolCall,
      operation: string,
      input: RecordValue,
      signal?: AbortSignal,
    ): Promise<ToolResultMessage> {
      if (operation === "sequence") {
        const steps = input.steps;
        if (!Array.isArray(steps) || !steps.length || steps.length > 20)
          throw new Error("sequence requires 1-20 steps");
        for (const [index, value] of steps.entries()) {
          const step = record(value);
          if (
            !["click", "scroll", "drag", "type_text", "press_key", "set_value"].includes(
              String(step.operation),
            )
          )
            throw new Error("Unsupported sequence step");
          if (index > 0 && step.element_index !== undefined)
            throw new Error(
              "Element indices belong to one observation. Split indexed actions into separate calls.",
            );
        }
        let response = result(call, "Sequence has not dispatched any steps.");
        let completed = 0;
        const started = performance.now();
        let stateId = input.state_id;
        for (const value of steps) {
          if (signal?.aborted || performance.now() - started > 30_000) {
            response = {
              ...response,
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Sequence stopped before the next step: cancelled or deadline exceeded.",
                },
                ...response.content,
              ],
            };
            break;
          }
          const step = record(value);
          const previous = targets.get(key(String(input.app ?? "")));
          if (
            typeof step.expected_text === "string" &&
            !previous?.text.toLowerCase().includes(step.expected_text.toLowerCase())
          ) {
            response = result(
              call,
              "Sequence stopped before the next action: expected text is absent.",
              true,
            );
            break;
          }
          response = await adapter.execute(
            call,
            String(step.operation),
            { ...input, ...step, state_id: stateId },
            signal,
          );
          if (record(response.details).actionApplied === true) completed++;
          if (
            response.isError ||
            record(response.details).observationFailed ||
            record(response.details).actionApplied !== true
          )
            break;
          stateId = record(response.details).stateId;
        }
        return {
          ...response,
          content: [
            {
              type: "text",
              text: `Sequence dispatched ${completed}/${steps.length} steps. Inspect the final state; do not replay completed steps.`,
            },
            ...response.content,
          ],
          details: {
            ...record(response.details),
            completedSteps: completed,
            totalSteps: steps.length,
            elapsedMs: Math.round(performance.now() - started),
          },
        };
      }
      if (operation === "list_apps") {
        const catalog = (await windows(call)).map((window) => ({
          app: window.app_name,
          title: window.title,
          pid: window.pid,
          target: `window:${window.window_id}`,
        }));
        return result(call, JSON.stringify(catalog));
      }
      if (operation === "get_app_state") return observe(call, input);
      const app = String(input.app ?? "");
      const target = targets.get(key(app));
      if (!target || target.token !== input.state_id) {
        const fresh = await observe(call, input);
        return {
          ...fresh,
          content: [
            { type: "text", text: "ACTION NOT APPLIED: stale state. Inspect this observation." },
            ...fresh.content,
          ],
        };
      }
      let name = operation;
      if (
        ["x", "y", "from_x", "from_y", "to_x", "to_y"].some(
          (field) => input[field] !== undefined,
        ) &&
        !target.hasScreenshot
      ) {
        throw new Error("Observe with observation=auto/image before using screenshot coordinates.");
      }
      const args: RecordValue = { pid: target.pid, window_id: target.windowId };
      if (input.element_index !== undefined) {
        if (!target.snapshotId)
          throw new Error(
            "The installed runtime did not provide a snapshot identity. Observe and use screenshot coordinates.",
          );
        args.element_index = Number(input.element_index);
        if (!Number.isSafeInteger(args.element_index)) throw new Error("Invalid element_index");
        args.snapshot_id = target.snapshotId;
      }
      for (const field of [
        "x",
        "y",
        "from_x",
        "from_y",
        "to_x",
        "to_y",
        "text",
        "value",
        "direction",
      ]) {
        if (input[field] !== undefined) args[field] = input[field];
      }
      const modifiers = (Array.isArray(input.modifiers) ? input.modifiers : []).map(
        (value) =>
          ({ Shift: "shift", Control: "ctrl", Alt: "alt", Meta: "cmd" })[String(value)] ??
          String(value),
      );
      if (operation === "click") {
        if (input.mouse_button === "middle" || Number(input.click_count ?? 1) > 2)
          throw new Error("This input route does not support that mouse gesture.");
        name =
          input.mouse_button === "right"
            ? "right_click"
            : input.click_count === 2
              ? "double_click"
              : "click";
        if (modifiers.length) args.modifier = modifiers;
      } else if (operation === "press_key") {
        const keys = String(input.key ?? "")
          .split("+")
          .map((value) => value.toLowerCase());
        if (keys.length + modifiers.length > 1) {
          name = "hotkey";
          args.keys = [...modifiers, ...keys];
        } else args.key = keys[0] === "enter" ? "return" : keys[0];
      } else if (operation === "scroll") {
        args.by = "page";
        args.amount = input.pages ?? 1;
      } else if (
        modifiers.length ||
        (operation === "drag" && input.mouse_button && input.mouse_button !== "left")
      ) {
        throw new Error(
          "This input route cannot preserve the requested modifiers or mouse button.",
        );
      }
      // Consume before dispatch. A transport timeout is an unknown outcome,
      // never permission to replay the same physical action through another route.
      target.token = "";
      const response = await callTool(call, name, args);
      if (response.isError) return response;
      let fresh: ToolResultMessage;
      try {
        fresh = await observe(call, input);
      } catch (error) {
        fresh = result(call, `Post-action observation failed: ${String(error)}`, true);
      }
      return {
        ...response,
        isError: Boolean(fresh.isError),
        content: [...response.content, ...fresh.content],
        details: {
          kind: "cua",
          actionApplied: true,
          observationFailed: fresh.isError,
          stateId: record(fresh.details).stateId,
          native: response.details,
        },
      };
    },
  };
  return adapter;
}
