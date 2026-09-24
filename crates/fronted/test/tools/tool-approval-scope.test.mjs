import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness() {
  return createTsModuleLoader().loadModule("src/lib/tools/toolApproval.ts");
}

function call(action, name = "MobilePersonalData") {
  return { name, arguments: { action } };
}

test("session approval for one personal capability cannot authorize another or a write", async () => {
  const api = harness();
  const scope = api.toolApprovalScope(call("list_calendar_events"));
  const pending = api.requestToolApproval({
    toolCallId: "calendar-1", toolName: "MobilePersonalData", sessionScope: scope,
    summary: "list_calendar_events", conversationId: "chat-1",
  });
  const visible = api.listPendingToolApprovalsForConversation("chat-1");
  assert.equal(visible[0].toolName, "MobilePersonalData");
  assert.equal(visible[0].summary, "list_calendar_events");
  assert.equal(api.answerToolApproval("calendar-1", "approve_session").ok, true);
  assert.equal((await pending).decision, "approve_session");
  assert.equal(api.isSessionApproved("chat-1", scope), true);
  for (const next of [
    call("get_current_location"), call("read_clipboard"), call("list_reminders"),
    call("create_calendar_event", "MobilePersonalActions"), call("unrecognized_action"),
  ]) assert.equal(api.isSessionApproved("chat-1", api.toolApprovalScope(next)), false);
  assert.equal(api.isSessionApproved("chat-1", "MobilePersonalData"), false);
  assert.equal(api.isSessionApproved("chat-2", scope), false);
  api.cancelPendingToolApprovalsForConversation("chat-1");
  assert.equal(api.isSessionApproved("chat-1", scope), false);
});

test("Bluetooth discovery actions share their capability while unrelated tools keep existing scopes", () => {
  const api = harness();
  assert.equal(api.toolApprovalScope(call("scan_bluetooth")), api.toolApprovalScope(call("discover_devices")));
  assert.equal(api.toolApprovalScope({ name: "Read", arguments: { path: "a.txt" } }), "Read");
});

test("single approval, denial, timeout and cancellation never create a capability session grant", async () => {
  for (const decision of ["approve", "deny", "timeout", "cancel"]) {
    const api = harness();
    const scope = api.toolApprovalScope(call("get_current_location"));
    const controller = new AbortController();
    const pending = api.requestToolApproval({
      toolCallId: decision, toolName: "MobilePersonalData", sessionScope: scope,
      conversationId: "chat", signal: controller.signal,
      timeoutMs: decision === "timeout" ? 0 : 1000,
    });
    if (decision === "cancel") controller.abort();
    else if (decision !== "timeout") api.answerToolApproval(decision, decision);
    await pending;
    assert.equal(api.isSessionApproved("chat", scope), false);
    assert.equal(api.listPendingToolApprovalsForConversation("chat").length, 0);
  }
});

test("ordinary tools retain tool-name session approval compatibility", async () => {
  const api = harness();
  const pending = api.requestToolApproval({ toolCallId: "read", toolName: "Read", conversationId: "chat" });
  api.answerToolApproval("read", "approve_session");
  await pending;
  assert.equal(api.isSessionApproved("chat", "Read"), true);
});
