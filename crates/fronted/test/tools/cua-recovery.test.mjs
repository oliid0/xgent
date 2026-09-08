import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function setup({ actionError = false, observationErrorAfterAction = false } = {}) {
  const calls = [];
  const names = ["list_windows", "get_window_state", "click", "type_text", "press_key"];
  const parameters = { type: "object", properties: Object.fromEntries(
    ["pid", "window_id", "max_elements", "max_depth", "max_dimension", "include_screenshot", "include_accessibility_tree", "x", "y", "text", "key"].map((key) => [key, {}]),
  ) };
  const driver = {
    tools: names.map((name) => ({ name: `mcp_cua_${name}`, parameters })),
    toolNameMap: new Map(names.map((name) => [`mcp_cua_${name}`, { serverId: "cua", toolName: name }])),
    executeToolCall: async (call) => {
      calls.push(call);
      const name = call.name.replace("mcp_cua_", "");
      const data = name === "list_windows"
        ? { windows: [{ pid: 77, window_id: 12, app_name: "Blender", title: "Scene" }, { pid: 1, window_id: 13, app_name: "Xgent", title: "Chat" }] }
        : { snapshot_id: "snapshot", elements: [] };
      return { role: "toolResult", toolCallId: call.id, toolName: call.name,
        content: [{ type: "text", text: name === "get_window_state" ? "Scene ready" : "dispatched" },
          ...(name === "get_window_state" && call.arguments.include_screenshot !== false ? [{ type: "image", data: "cG5n", mimeType: "image/png" }] : [])],
        details: { mcp: { structuredContent: data } }, isError: (actionError && name === "click") ||
          (observationErrorAfterAction && name === "get_window_state" && calls.some((item) => item.name.endsWith("_type_text"))), timestamp: Date.now() };
    },
  };
  const loader = createTsModuleLoader({ mocks: { "@xgent/runtime": { invoke: async (command) => {
    if (command === "cua_status") return { hostPid: 1, enabled: true };
    return { content: [{ type: "text", text: "Native capture unavailable" }], isError: true };
  } } } });
  const bundle = loader.loadModule("src/lib/tools/cuaTools.ts").createCuaTools({ driver, driverServerIds: ["cua"] });
  const run = (operation, args = {}) => bundle.executeToolCall({ id: "call", name: "cua", arguments: { operation, app: "Blender", ...args } });
  return { calls, run };
}

test("observation recovery selects the exact target and hides transport-specific schemas", async () => {
  const { calls, run } = setup();
  const observed = await run("get_app_state", { observation: "text" });
  assert.equal(observed.isError, false);
  assert.equal(observed.toolName, "cua");
  assert.equal(calls.at(-1).arguments.pid, 77);
  assert.equal(calls.at(-1).arguments.include_screenshot, false);
  const invalid = await run("click", { state_id: observed.details.stateId, x: 1, y: 1 });
  assert.equal(invalid.isError, true);
  const visual = await run("get_app_state");
  const stateId = visual.details.stateId;
  const acted = await run("click", { state_id: stateId, x: 1, y: 1 });
  assert.equal(acted.details.actionApplied, true);
  await run("click", { state_id: stateId, x: 1, y: 1 });
  assert.equal(calls.filter((call) => call.name.endsWith("_click")).length, 1);
});

test("native action failures never replay through the recovery transport", async () => {
  const { calls, run } = setup();
  const failed = await run("click", { state_id: "native-state", x: 1, y: 1 });
  assert.equal(failed.isError, true);
  assert.equal(calls.length, 0);
});

test("sequence counts an applied action even when its observation fails and never continues", async () => {
  const { calls, run } = setup({ observationErrorAfterAction: true });
  const observed = await run("get_app_state");
  const response = await run("sequence", { state_id: observed.details.stateId, steps: [
    { operation: "type_text", text: "hello" },
    { operation: "press_key", key: "Enter" },
  ] });
  assert.equal(response.isError, true);
  assert.equal(response.details.actionApplied, true);
  assert.equal(response.details.completedSteps, 1);
  assert.equal(calls.filter((call) => call.name.endsWith("_press_key")).length, 0);
});

test("a local sequence stops at an unmet precondition without issuing the next action", async () => {
  const { calls, run } = setup();
  const observed = await run("get_app_state");
  const completed = await run("sequence", { state_id: observed.details.stateId, steps: [
    { operation: "type_text", text: "hello", expected_text: "Scene ready" },
    { operation: "press_key", key: "Enter", expected_text: "Render finished" },
  ] });
  assert.equal(completed.details.completedSteps, 1);
  assert.equal(completed.isError, true);
  assert.equal(calls.filter((call) => call.name.endsWith("_type_text")).length, 1);
  assert.equal(calls.filter((call) => call.name.endsWith("_press_key")).length, 0);
});
