import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("terminal output merges overlapping waits without duplicating UTF-8 and preserves terminal status", () => {
  const { executionActivityStore: store, recordShellActivity } = createTsModuleLoader().loadModule("src/lib/chat/executionActivityStore.ts");
  store.record("stream", { id: "session", sessionId: "session", kind: "shell", title: "echo", text: "", status: "running", outputCursor: 0 });
  const record = (text, cursor, status = "running") => recordShellActivity("stream", { session_id: "session", output: [{ text }], cursor, status });
  record("你好", 6);
  record("你好 world", 12);
  record("你好", 6);
  record("", 12, "completed");
  assert.equal(store.getSnapshot("stream")[0].text, "你好 world");
  assert.equal(store.getSnapshot("stream")[0].status, "complete");
  recordShellActivity("other", { session_id: "session", output: [{ text: "wrong" }], cursor: 20, status: "running" });
  assert.equal(store.getSnapshot("other").length, 0);
});

test("activity observations survive transcript settlement without crossing conversations and remain bounded", () => {
  const { executionActivityStore: store } = createTsModuleLoader().loadModule("src/lib/chat/executionActivityStore.ts");
  const activity = { id: "same-provider-id", kind: "shell", title: "python task.py", text: "A", status: "running" };
  store.record("a", activity);
  store.record("b", { ...activity, text: "B" });
  assert.equal(store.getSnapshot("a")[0].text, "A");
  assert.equal(store.getSnapshot("b")[0].text, "B");
  store.record("a", { ...activity, text: "finished", status: "complete" });
  assert.equal(store.getSnapshot("a").length, 1);
  assert.equal(store.getSnapshot("a")[0].status, "complete");
  for (let i = 0; i < 100; i++) store.record("a", { ...activity, id: String(i), text: "x".repeat(100_000), imageUrl: "data:image/png;base64,cG5n" });
  assert.equal(store.getSnapshot("a").length, 24);
  assert.equal(store.getSnapshot("a").filter((frame) => frame.imageUrl).length, 3);
  assert.equal(store.getSnapshot("a").at(-1).text.length, 65_536);
  for (let i = 0; i < 12; i++) store.record(`other-${i}`, activity);
  assert.equal(store.getSnapshot("a").length, 0);
});

test("CUA native sequence events correlate to their invocation and listeners are released", async () => {
  let handler;
  let removed = false;
  const loader = createTsModuleLoader({ mocks: { "@xgent/runtime": {
    listen: async (_name, callback) => { handler = callback; return () => { removed = true; }; },
    invoke: async (_name, args) => {
      if (_name === "cua_status") return { enabled: true };
      handler({ payload: { runId: "another-run", step: 0, response: { content: [{ type: "text", text: "wrong" }] } } });
      handler({ payload: { runId: args.run_id, step: 0, response: { content: [{ type: "text", text: "typed" }] } } });
      return { content: [{ type: "text", text: "verified" }], isError: false };
    },
  } } });
  const bundle = loader.loadModule("src/lib/tools/cuaTools.ts").createCuaTools({ conversationId: "cua-test" });
  await bundle.executeToolCall({ id: "call", name: "cua", arguments: { operation: "get_app_state", app: "Notepad" } });
  const frames = loader.loadModule("src/lib/chat/executionActivityStore.ts").executionActivityStore.getSnapshot("cua-test");
  assert.deepEqual(frames.map((frame) => frame.text), ["typed", "verified"]);
  assert.equal(removed, true);
});

test("mobile shell displays split UTF-8 output before completion and releases its listener", async () => {
  let handler;
  let release;
  let entered;
  let removed = false;
  const dispatched = new Promise((resolve) => { entered = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  const loader = createTsModuleLoader({ mocks: {
    "@xgent/runtime": {
      listenNativePlugin: async (_plugin, _event, callback) => {
        handler = callback;
        return async () => { removed = true; };
      },
      invoke: async (command, args) => {
      assert.equal(command, "shell_run");
      assert.ok(handler, "listener must exist before dispatch");
      handler({ runId: "other", stream: "stdout", data: Buffer.from("wrong").toString("base64") });
      const bytes = Buffer.from("中文\n");
      handler({ runId: args.run_id, stream: "stdout", data: bytes.subarray(0, 2).toString("base64") });
      handler({ runId: args.run_id, stream: "stdout", data: bytes.subarray(2).toString("base64") });
      entered();
      await pending;
      return { exit_code: 0, shell: "sh", stdout: "中文\n", stderr: "", duration_ms: 10 };
    } },
  } });
  const bundle = loader.loadModule("src/lib/tools/shellTools.ts").createShellTools({
    workdir: "/repo", providerId: "claude_code", runtimePlatform: "android", conversationId: "shell-test",
  });
  const call = bundle.executeToolCall({ id: "call", name: "Bash", arguments: { command: "python task.py" } });
  await dispatched;
  const store = loader.loadModule("src/lib/chat/executionActivityStore.ts").executionActivityStore;
  assert.equal(store.getSnapshot("shell-test")[0].text, "中文\n");
  assert.equal(store.getSnapshot("shell-test")[0].status, "running");
  release();
  assert.equal((await call).isError, false);
  assert.equal(removed, true);
  assert.equal(store.getSnapshot("shell-test")[0].status, "complete");
});


test("activity replay restores persisted results and merges live steps without duplicates", () => {
  const { collectActivityItems } = createTsModuleLoader().loadModule("src/lib/chat/activityTimeline.ts");
  const tool = (id, text) => ({ kind: "tool", item: { toolCall: { id, name: "Bash" }, ...(text ? { toolResult: { content: [{ type: "text", text }] } } : {}) } });
  const history = [{ kind: "assistant", rounds: [{ round: 0, blocks: [tool("a", "finished")] }] }];
  const settled = { isSettled: true, liveRounds: [] };
  assert.equal(collectActivityItems(history, settled)[0].toolResult.content[0].text, "finished");
  const live = { isSettled: false, liveRounds: [{ round: 1, runningToolCallIds: ["b"], blocks: [tool("a"), tool("b")] }] };
  const items = collectActivityItems(history, live);
  assert.deepEqual(items.map(item => [item.toolCall.id, item.running]), [["a", false], ["b", true]]);
  assert.equal(items[0].toolResult.content[0].text, "finished");
  assert.equal(collectActivityItems(history, { ...live, isSettled: true })[1].running, false);
  assert.deepEqual(collectActivityItems([], settled), []);
});
