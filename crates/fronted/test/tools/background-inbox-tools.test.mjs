import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
function setup(failure) {
  const calls = []; const backend = Object.fromEntries(["listBackgroundInbox", "readBackgroundInbox", "acknowledgeBackgroundInbox", "syncBackgroundInbox", "getReceivedBackgroundTask", "getReceivedResponseState", "resumeReceivedBackgroundTask", "listBackgroundSubmissions", "getBackgroundSubmissionState"].map((name) => [name, async (...args) => { calls.push([name, ...args]); if (failure) throw new Error(failure); return name === "readBackgroundInbox" ? { entryId: args[0], offset: args[1], text: "actual", nextOffset: 16384 } : { actual: true }; }]));
  const api = createTsModuleLoader({ mocks: { "../automation/backend": { backend } } }).loadModule("src/lib/tools/backgroundInboxTools.ts");
  return { ...api, tools: api.createBackgroundInboxTools(), calls };
}
const call = (action, args = {}) => ({ id: "call", name: "BackgroundInbox", arguments: { action, ...args } });
test("saved submissions recover bounded local metadata without sending, acknowledging or exposing attachment input", async () => {
  const f = setup();
  assert.equal((await f.tools.executeToolCall(call("submissions", { cursor: 35, limit: 4 }))).isError, false);
  assert.equal((await f.tools.executeToolCall(call("submission_state", { request_id: "original-request" }))).isError, false);
  assert.deepEqual(f.calls, [["listBackgroundSubmissions", 35, 4], ["getBackgroundSubmissionState", "original-request"]]);
  assert.equal(f.isBackgroundInboxReadOnly(call("submissions")), true); assert.equal(f.isBackgroundInboxReadOnly(call("submission_state")), true);
  for (const args of [call("submissions", { limit: 0 }), call("submission_state"), call("submission_state", { request_id: " " })]) assert.equal((await f.tools.executeToolCall(args)).isError, true);
  assert.equal(f.calls.length, 2);
});
test("local inbox tools retain actual cursor/chunk IDs and never ACK by reading", async () => {
  const f = setup(); await f.tools.executeToolCall(call("list", { cursor: 25, limit: 7, unread_only: true }));
  const read = await f.tools.executeToolCall(call("read", { entry_id: "actual-entry", offset: 16384 }));
  assert.equal(read.isError, false); assert.deepEqual(f.calls, [["listBackgroundInbox", 25, 7, true], ["readBackgroundInbox", "actual-entry", 16384]]);
  assert.equal(JSON.parse(read.content[0].text).text, "actual");
});

test("failed native acknowledgment or refresh returns an error instead of claiming reception", async () => {
  const f = setup("Actual native persistence failure");
  for (const input of [call("acknowledge", { entry_id: "notice" }), call("refresh")]) {
    const result = await f.tools.executeToolCall(input); assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).error, "Actual native persistence failure");
  }
});
test("notice acknowledgment and bounded refresh report actual native effects", async () => {
  const f = setup(); const result = await f.tools.executeToolCall(call("acknowledge", { entry_id: "notice" })); await f.tools.executeToolCall(call("refresh"));
  assert.equal(JSON.parse(result.content[0].text).status, "notice_acknowledged"); assert.deepEqual(f.calls, [["acknowledgeBackgroundInbox", "notice"], ["syncBackgroundInbox"]]);
  assert.equal(f.isBackgroundInboxReadOnly(call("read")), true); assert.equal(f.isBackgroundInboxReadOnly(call("acknowledge")), false);
});
test("invalid input or cancellation does not acknowledge or sync", async () => {
  const f = setup(); for (const input of [call("read"), call("list", { limit: 0 }), call("list", { cursor: -1 }), call("list", { unread_only: "yes" }), call("read", { entry_id: "x", offset: 0.5 })]) assert.equal((await f.tools.executeToolCall(input)).isError, true);
  const abort = new AbortController(); abort.abort(); assert.equal((await f.tools.executeToolCall(call("refresh"), abort.signal)).isError, true); assert.deepEqual(f.calls, []);
});
test("current and saved response recovery use received entry ownership while resume requires actual bounded information", async () => {
  const f = setup(); await f.tools.executeToolCall(call("current", { entry_id: "received" })); await f.tools.executeToolCall(call("response_state", { entry_id: "received" })); await f.tools.executeToolCall(call("resume", { entry_id: "received", response: "Actual input" }));
  assert.deepEqual(f.calls, [["getReceivedBackgroundTask", "received"], ["getReceivedResponseState", "received"], ["resumeReceivedBackgroundTask", "received", "Actual input"]]);
  for (const response of ["", " ", "中".repeat(11000)]) assert.equal((await f.tools.executeToolCall(call("resume", { entry_id: "received", response }))).isError, true);
  assert.equal(f.isBackgroundInboxReadOnly(call("current")), true); assert.equal(f.isBackgroundInboxReadOnly(call("resume")), false);
});
