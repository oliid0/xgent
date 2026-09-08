import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function setup(invoke) {
  const loader = createTsModuleLoader({ mocks: { "@xgent/runtime": { invoke: (command, args) => command === "cua_status" ? { enabled: true } : invoke(command, args) } } });
  return loader.loadModule("src/lib/tools/cuaTools.ts").createCuaTools();
}
const call = (id, operation = "get_app_state") => ({ id, name: "cua", arguments: { operation, app: "Blender" } });

test("concurrent held inputs and relative motion reach one native call with final observation", async () => {
  const input = { operation: "input", app: "Blender", state_id: "7", keys: ["Shift", "W"], buttons: ["middle"], dx: 120, dy: -20, duration_ms: 160, observation: "image", settle_ms: 0 };
  const calls = [];
  const bundle = setup(async (command, args) => {
    calls.push({ command, args });
    return { content: [{ type: "text", text: "state_id: 8" }], isError: false, details: { stateId: "8" } };
  });
  const result = await bundle.executeToolCall({ id: "burst", name: "cua", arguments: input });
  assert.equal(result.isError, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "cua_call");
  assert.equal(calls[0].args.operation, "input");
  const { operation, ...argumentsOnly } = input;
  assert.deepEqual(calls[0].args.arguments, argumentsOnly);
  assert.equal(result.details.stateId, "8");
});

async function waitForDispatch(dispatched) {
  const deadline = Date.now() + 5_000;
  while (!dispatched()) {
    assert.ok(Date.now() < deadline, "CUA never reached native invocation");
    await delay(10);
  }
}

test("CUA forwards native screenshots and correlated tool results to the model", async () => {
  const content = [{ type: "text", text: "state_id: 3" }, { type: "image", data: "cG5n", mimeType: "image/png" }];
  const bundle = setup(async (command, args) => {
    assert.equal(command, "cua_call");
    assert.equal(args.operation, "get_app_state");
    assert.equal(args.arguments.app, "Blender");
    assert.match(args.run_id, /^cua:call-1:/);
    return { content, isError: false, details: { stateId: "3" } };
  });
  const result = await bundle.executeToolCall(call("call-1"));
  assert.equal(result.toolCallId, "call-1");
  assert.equal(result.isError, false);
  assert.deepEqual(result.content, content);
  assert.equal(result.details.stateId, "3");
});

test("CUA serializes calls, cancels queued work and continues after native errors", async () => {
  let release;
  const started = [];
  const bundle = setup(async (_command, args) => {
    started.push(args.run_id.split(":")[1]);
    if (started.length === 1) await new Promise((resolve) => { release = resolve; });
    if (started.length === 2) throw new Error("Capture permission denied");
    return { content: [{ type: "text", text: "state" }], isError: false };
  });
  const first = bundle.executeToolCall(call("first"));
  await waitForDispatch(() => release);
  const abort = new AbortController();
  const cancelled = bundle.executeToolCall(call("cancelled"), abort.signal);
  const second = bundle.executeToolCall(call("second"));
  abort.abort();
  assert.equal((await cancelled).isError, true);
  assert.deepEqual(started, ["first"]);
  release();
  assert.equal((await first).isError, false);
  const failure = await second;
  assert.equal(failure.isError, true);
  assert.match(failure.content[0].text, /permission denied/);
  assert.equal((await bundle.executeToolCall(call("third"))).isError, false);
  assert.deepEqual(started, ["first", "second", "third"]);
});

test("CUA rejects unsupported operations before native invocation", async () => {
  let invoked = false;
  const bundle = setup(async () => { invoked = true; });
  const result = await bundle.executeToolCall(call("bad", "invented"));
  assert.equal(result.isError, true);
  assert.equal(invoked, false);
});

test("cancelling in-flight computer use keeps subsequent physical actions queued until native completion", async () => {
  let release;
  const starts = [];
  const bundle = setup(async (command, args) => {
    if (command === "runtime_cancel") return { cancelled: true };
    starts.push(args.operation);
    if (starts.length === 1) await new Promise((resolve) => { release = resolve; });
    return { content: [{ type: "text", text: "done" }], isError: false };
  });
  const abort = new AbortController();
  const first = bundle.executeToolCall(call("first"), abort.signal);
  await waitForDispatch(() => release);
  abort.abort();
  assert.equal((await first).isError, true);
  const second = bundle.executeToolCall(call("second", "click"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, ["get_app_state"]);
  release();
  await second;
  assert.deepEqual(starts, ["get_app_state", "click"]);
});

test("the model receives one unified tool without driver selection or provider-specific calls", () => {
  const bundle = setup(async () => ({}));
  assert.deepEqual(bundle.tools.map((tool) => tool.name), ["cua"]);
  const schema = bundle.tools[0].parameters;
  assert.equal(schema.properties.driver_tool, undefined);
  assert.equal(schema.properties.backend, undefined);
  assert.ok(schema.properties.operation.enum.includes("sequence"));
  assert.equal(schema.properties.steps.maxItems, 20);
});


test("disabled CUA cannot invoke native input or install a component", async () => {
  const calls = [];
  const loader = createTsModuleLoader({ mocks: { "@xgent/runtime": { invoke: async (command) => {
    calls.push(command);
    return { enabled: false };
  } } } });
  const bundle = loader.loadModule("src/lib/tools/cuaTools.ts").createCuaTools();
  const result = await bundle.executeToolCall(call("disabled"));
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Settings > Computer use/);
  assert.deepEqual(calls, ["cua_status"]);
});

test("background-only and precise editor targeting reach the native dispatcher without dropping intent", async () => {
  const calls = [];
  const bundle = setup(async (_command, args) => {
    calls.push(args);
    return { content: [{ type: "text", text: "Background value written" }], isError: false, details: { stateId: "9", windowId: 42 } };
  });
  const arguments_ = { operation: "set_value", app: "window:42", state_id: "8", element_index: "6", value: "你好123", allow_foreground: false, observation: "text", brief: "Record the requested text" };
  const result = await bundle.executeToolCall({ id: "targeted", name: "cua", arguments: arguments_ });
  assert.equal(result.isError, false);
  assert.equal(calls[0].arguments.allow_foreground, false);
  assert.equal(calls[0].arguments.element_index, "6");
  assert.equal(calls[0].arguments.value, "你好123");
  assert.equal(result.details.windowId, 42);
  assert.ok(bundle.tools[0].parameters.properties.allow_foreground);
});
