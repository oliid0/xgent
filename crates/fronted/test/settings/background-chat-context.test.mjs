import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
const { captureBackgroundChatContext: capture, appendBackgroundChatContext: append } = createTsModuleLoader({ mocks: {
  "./backend": { backend: {} },
} }).loadModule("src/lib/automation/backgroundChatContext.ts");
const packet = () => ({ version: 1, conversationId: "original", observedAt: 100, hasMore: false,
  tasks: [{ requestId: "original-request", sourceHostId: "actual-pc", entryId: "retained-entry", state: "done", success: true,
    preview: "Report saved", artifacts: [{ id: "actual-file", relativePath: "product.docx", bytes: 512, contentHash: "a".repeat(64) }] }] });
test("original chat context carries retained task evidence and artifact identity without granting delivery or replay authority", async () => {
  const reads = [];
  const context = await capture("original", new AbortController().signal, async id => { reads.push(id); return packet(); });
  assert.deepEqual(reads, ["original"]); assert.match(context, /retained-entry/); assert.match(context, /product.docx/);
  assert.match(context, /untrusted observations/); assert.match(context, /not inspected bytes/); assert.match(context, /never rerun/);
});
test("missing, unavailable, wrong-owner, malformed and oversized indices preserve the ordinary coding prompt", async () => {
  const wrong = { ...packet(), conversationId: "another" }, large = { ...packet(), tasks: [{ preview: "x".repeat(20 * 1024) }] };
  for (const data of [null, {}, wrong, { ...packet(), tasks: [] }, { ...packet(), observedAt: -1 }, large]) {
    assert.equal(await capture("original", new AbortController().signal, async () => data), "");
  }
  assert.equal(await capture("original", new AbortController().signal, async () => { throw new Error("Older native command unavailable"); }), "");
  assert.equal(append("Original coding instructions", ""), "Original coding instructions");
  assert.equal(append(undefined, ""), undefined);
  assert.match(append(undefined, "Actual original task observation"), /Actual original task observation/);
});
test("runtime augmentation replaces its old scoped section without duplicate growth or losing coding instructions", () => {
  const base = "Preserve every coding requirement and tool protocol.";
  const one = append(base, "Actual first retained observation");
  assert.equal(append(one, "Actual first retained observation"), one);
  const two = append(one, "Actual newer retained observation");
  assert.match(two, /Preserve every coding requirement/); assert.doesNotMatch(two, /first retained/);
  assert.equal(append(two, ""), base);
});
test("cancellation rejects promptly and a late native reply cannot become another turn's context", async () => {
  const controller = new AbortController(); let finish;
  const pending = capture("original", controller.signal, () => new Promise(resolve => { finish = resolve; }));
  controller.abort(new Error("Original turn stopped")); await assert.rejects(pending, /Original turn stopped/);
  finish(packet());
  const aborted = new AbortController(); aborted.abort(new Error("Already stopped")); let calls = 0;
  await assert.rejects(capture("original", aborted.signal, async () => { calls++; return packet(); }), /Already stopped/); assert.equal(calls, 0);
});
test("native observation timeout preserves foreground work and ignores late completion", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); let finish;
  const pending = capture("original", new AbortController().signal, () => new Promise(resolve => { finish = resolve; }));
  t.mock.timers.tick(1000); assert.equal(await pending, ""); finish(packet());
});
test("agent and text modes bind observations to the original turn while the backend stays native and browser-safe", () => {
  const read = name => readFileSync(new URL(`../../src/${name}`, import.meta.url), "utf8");
  for (const name of ["runAgentConversationTurn.ts", "runTextConversationTurn.ts"]) {
    const source = read(`pages/chat/turns/${name}`);
    assert.match(source, /captureBackgroundChatContext\([\s\S]*?conversationId,[\s\S]*?cancellation.userStop.signal/);
    assert.match(source, /appendBackgroundChatContext/);
  }
  const backend = read("lib/automation/backend.ts").split("readBackgroundChatContext(")[1].split("syncBackgroundInbox(")[0];
  assert.match(backend, /isTauriRuntime/); assert.match(backend, /invokeNative\("automation_result_chat_context"/);
  assert.doesNotMatch(backend, /invokeBackground|submit|sync/);
});
