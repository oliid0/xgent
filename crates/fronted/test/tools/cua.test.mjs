import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function setup(invoke) {
  const loader = createTsModuleLoader({ mocks: { "@xgent/runtime": { invoke } } });
  return loader.loadModule("src/lib/tools/cuaTools.ts").createCuaTools();
}
const call = (id, operation = "get_app_state") => ({ id, name: "cua", arguments: { operation, app: "Blender" } });

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
