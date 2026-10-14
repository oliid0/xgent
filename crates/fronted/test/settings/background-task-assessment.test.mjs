import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const time = Date.now();
const capability = (id, state = "available") => ({ id, state, evidence: "version-command", detail: "Observed version" });
const host = (id, capabilities = [], patch = {}) => ({ hostId: id, platform: "windows", architecture: "x64", executorReady: true,
  acceptsBackgroundTasks: true, workspaceAvailable: true, workdir: "/host", inputSnapshotVersion: 1, sourceContextVersion: 1,
  providers: [{ id: "provider", models: ["model"] }], running: 0, pending: 0,
  inventory: { version: 1, observedAt: time, validUntil: time + 60000, capabilities }, ...patch });
const peer = h => ({ peerId: h.hostId, online: true, host: h });
const branch = (patch = {}) => ({ id: "work", requirement: "Current required outcome", dependsOn: [], kind: "task", effort: "small",
  locality: "portable", requirements: { capabilities: [], platforms: [] }, ...patch });
const plan = (branches = [branch()], continuity = "foreground") => ({ version: 1, continuity, branches });
const mobile = (installed = [], patch = {}) => ({ native: true, observedAt: time, execution: { available: true, installed: true,
  capabilities: { shell: true }, toolchains: installed.map(id => ({ id, installed: true })), ...patch } });
function fixture(reply = plan(), patch = {}) {
  const calls = [];
  const loader = createTsModuleLoader({ mocks: { "../providers/llm": {
    async completeAssistantMessage(options) { calls.push(options); if (patch.failure) throw new Error("No model result");
      if (patch.onCall) await patch.onCall(options);
      return { stopReason: patch.stopReason ?? "stop", content: [{ type: "text", text: typeof reply === "string" ? reply : JSON.stringify(reply) }] }; },
    assistantMessageToText: message => message.content.map(part => part.text ?? "").join(""),
  } } });
  const m = loader.loadModule("src/lib/automation/taskRoutingAssessment.ts");
  return { ...m, calls, assess: async (overrides = {}) => m.assessTaskRouting({ providerId: "codex", model: "configured-model", runtime: { apiKey: "private-config-key", baseUrl: "https://provider", nativeWebSearchEnabled: true },
    context: { systemPrompt: "Original memory and source policies", messages: [{ role: "user", content: "Create the current report", timestamp: 1 }] },
    request: "Create the current report", requestScope: "persisted-message-scope", signal: new AbortController().signal,
    local: host("local"), nativeMobile: false, mobileExecution: null, ...overrides }) };
}
const foregroundMobile = { native: false, execution: null, observedAt: time };

test("selected configured model assesses original request as task data without tools, hosted search or credentials in context", async () => {
  const f = fixture(); const result = await f.assess();
  assert.equal(result.version, 1); assert.equal(f.calls.length, 1);
  const call = f.calls[0]; assert.equal(call.model, "configured-model"); assert.equal(call.allowJsonOutput, true);
  assert.equal(call.context.tools, undefined); assert.equal(call.runtime.nativeWebSearchEnabled, false);
  assert.ok(call.context.messages[0].content[0].text.includes("Historical model-request snapshot"));
  assert.ok(call.context.messages[0].content[0].text.includes("Original memory"));
  assert.ok(call.context.messages[1].content.includes("Create the current report"));
  assert.equal(JSON.stringify(call.context).includes("private-config-key"), false);
  assert.ok(call.context.systemPrompt.includes("Include EVERY outcome"));
  assert.ok(call.context.systemPrompt.includes("never omit the phone branch"));
});

test("invalid JSON, unsupported APIs, incomplete and failed proposals remain unknown instead of creating remote work", async () => {
  for (const [reply, patch] of [["not JSON", {}], [{ ...plan(), estimatedSeconds: 3 }, {}], [plan([branch({ requirements: { capabilities: ["invented-xcode-api"], platforms: [] } })]), {}], [plan(), { stopReason: "length" }], [plan(), { failure: true }]]) {
    const f = fixture(reply, patch); assert.equal(await f.assess(), null);
  }
});

test("workspace dependency assessment is bounded and missing legacy evidence cannot claim inputs-only", async () => {
  const f = fixture();
  assert.equal(f.validateTaskRoutingAssessment(plan()).branches[0].workspace, undefined);
  for (const workspace of ["inputs-only", "current-project", "unknown"])
    assert.equal(f.validateTaskRoutingAssessment(plan([branch({ workspace })])).branches[0].workspace, workspace);
  assert.throws(() => f.validateTaskRoutingAssessment(plan([branch({ workspace: "same-project-guaranteed" })])));
  await f.assess({ selectedWorkspace: { device: "selected-peer", workdir: "/original-project" } });
  assert.ok(f.calls[0].context.systemPrompt.includes("does not prove matching project contents"));
  assert.equal(JSON.parse(f.calls[0].context.messages[1].content).selectedWorkspace.workdir, "/original-project");
});

test("project-dependent durable work stays with its native owner and cannot move to an idle peer with matching tools", () => {
  const f = fixture(), p = plan([branch({ workspace: "current-project", effort: "large" })], "persistent");
  const local = host("local", [], { pending: 10, running: 2 }), catalog = { peers: [peer(host("idle"))] };
  const own = f.selectAssessedTaskRoute(p, catalog, local, { ...foregroundMobile, workspaceDevice: "initiating-device" }, time);
  assert.equal(own.selected.host.hostId, "local"); assert.equal(own.selected.local, true);
  for (const observation of [foregroundMobile, { ...foregroundMobile, workspaceDevice: "selected-peer" }]) {
    const route = f.selectAssessedTaskRoute(p, catalog, local, observation, time);
    assert.equal(route.selected, null); assert.equal(route.reason, "uncertain");
  }
  const noOwner = f.selectAssessedTaskRoute(p, catalog, null, { ...foregroundMobile, workspaceDevice: "initiating-device" }, time);
  assert.equal(noOwner.selected, null); assert.equal(noOwner.reason, "no-worker");
});

test("explicitly unknown workspace requirements never admit a portable task to arbitrary workers", () => {
  const f = fixture();
  const route = f.selectAssessedTaskRoute(plan([branch({ workspace: "unknown", effort: "large" })], "persistent"), { peers: [peer(host("idle"))] }, host("local"), foregroundMobile, time);
  assert.equal(route.selected, null); assert.equal(route.reason, "uncertain");
});

test("explicit cancellation during assessment propagates instead of quietly executing in foreground", async () => {
  const stop = new AbortController();
  const f = fixture(plan(), { onCall: () => stop.abort(new Error("Explicit Stop")) });
  await assert.rejects(f.assess({ signal: stop.signal }), /Explicit Stop/);
});

test("open historical tool calls stop assessment before any model request", async () => {
  const f = fixture();
  await assert.rejects(f.assess({ context: { messages: [{ role: "assistant", content: [{ type: "toolCall", id: "pending", name: "Write" }] }] } }), /unfinished tool/);
  assert.equal(f.calls.length, 0);
});

test("complete paired historical effects are quoted data rather than live tools for the assessor", async () => {
  const f = fixture(); await f.assess({ context: { messages: [{ role: "assistant", content: [{ type: "toolCall", id: "sent", name: "Mail" }] }, { role: "toolResult", toolCallId: "sent", toolName: "Mail", content: [{ type: "text", text: "Already sent" }] }, { role: "user", content: "Only summarize", timestamp: 2 }] } });
  assert.equal(f.calls[0].context.messages.some(message => message.role === "toolResult"), false);
  assert.ok(f.calls[0].context.messages[0].content[0].text.includes("Already sent"));
});

test("task assessment rejects hidden fields, missing outcomes, cycles, unsupported prerequisites and invented timing", () => {
  const f = fixture();
  for (const bad of [plan([]), plan([branch({ dependsOn: ["work"] })]), plan([branch({ dependsOn: ["missing"] })]), plan([branch(), branch()]),
    plan([branch({ requirements: { capabilities: ["python"], platforms: [], accountGrant: true } })]), plan([branch({ requirements: { capabilities: [], platforms: ["ios"] } })]),
    plan([branch({ durationSeconds: 1 })]), plan([branch({ kind: "interactive", requirements: { capabilities: ["node"], platforms: [] } })]), plan([branch({ kind: "interactive" })], "persistent")]) {
    assert.throws(() => f.validateTaskRoutingAssessment(bad));
  }
});

test("small text work and interactive explanations stay with the current client even when a peer is idle and local worker is busy", () => {
  const f = fixture(), local = host("local", [], { running: 2, pending: 20 }), catalog = { peers: [peer(host("idle"))] };
  for (const p of [plan(), plan([branch({ kind: "interactive", effort: "large" })])]) {
    const route = f.selectAssessedTaskRoute(p, catalog, local, foregroundMobile, time);
    assert.equal(route.selected, null); assert.equal(route.reason, "small-local");
  }
});

test("mixed persistent tasks require an executor that enforces device-bound branches", () => {
  const f = fixture(), catalog = { peers: [peer(host("idle"))] };
  const p = plan([branch({ id: "documents", effort: "large" }), branch({ id: "calendar", locality: "initiating-device" }), branch({ id: "health", locality: "initiating-device" })], "persistent");
  const route = f.selectAssessedTaskRoute(p, catalog, null, mobile(), time);
  assert.equal(route.selected, null); assert.equal(route.reason, "no-worker");
  assert.equal(p.branches.length, 3);
  assert.equal(f.selectAssessedTaskRoute(p, { peers: [peer(host("routing-only", [], { sourceRoutingVersion: 1 }))] }, null, mobile(), time).reason, "no-worker");
  assert.equal(f.selectAssessedTaskRoute(p, { peers: [peer(host("channel-only", [], { sourceRoutingVersion: 1, deviceChannelVersion: 1 }))] }, null, mobile(), time).reason, "no-worker");
  const actual = f.selectAssessedTaskRoute(p, { peers: [peer(host("supported", [], { sourceRoutingVersion: 1, deviceChannelVersion: 1, deviceActionsVersion: 1 }))] }, null, mobile(), time);
  assert.equal(actual.reason, "mixed-devices"); assert.equal(actual.selected.host.hostId, "supported");
  const upgraded=f.selectAssessedTaskRoute(p,{peers:[peer(host("upgraded",[],{sourceRoutingVersion:2,deviceChannelVersion:1,deviceActionsVersion:1}))]},null,mobile(),time);
  assert.equal(upgraded.reason,"mixed-devices");assert.equal(upgraded.selected.host.hostId,"upgraded","v2 retains ordinary v1 task routing");
  assert.equal(p.branches.length, 3);
  for (const request of [plan([branch({ locality: "initiating-device" })], "persistent"), plan(p.branches, "foreground"),
    plan([branch({ id: "phone", locality: "initiating-device" }), branch({ id: "dependent", dependsOn: ["phone"] })], "persistent")])
    assert.equal(f.selectAssessedTaskRoute(request, { peers: [peer(host("supported", [], { sourceRoutingVersion: 1, deviceChannelVersion: 1, deviceActionsVersion: 1 }))] }, null, mobile(), time).reason, "device-local");
});

test("unknown account/data locality and ambiguous effort do not choose a random desktop", () => {
  const f = fixture(), catalog = { peers: [peer(host("idle"))] };
  for (const p of [null, plan([branch({ locality: "unknown" })], "persistent"), plan([branch({ effort: "unknown" })])]) {
    assert.equal(f.selectAssessedTaskRoute(p, catalog, host("local"), foregroundMobile, time).reason, "uncertain");
  }
});

test("small desktop environment work stays local when actual prerequisites are available", () => {
  const f = fixture(), p = plan([branch({ requirements: { capabilities: ["python"], platforms: [] } })]);
  assert.equal(f.selectAssessedTaskRoute(p, { peers: [peer(host("idle", [capability("python")]))] }, host("local", [capability("python")]), foregroundMobile, time).reason, "small-local");
});

test("observed missing local environment selects an eligible peer with native requirements; unknown local evidence stays unknown", () => {
  const f = fixture(), p = plan([branch({ requirements: { capabilities: ["python"], platforms: [] } })]), catalog = { peers: [peer(host("idle", [capability("python")]))] };
  const route = f.selectAssessedTaskRoute(p, catalog, host("local", [capability("python", "unavailable")]), foregroundMobile, time);
  assert.equal(route.selected.peerId, "idle"); assert.equal(route.reason, "missing-environment"); assert.deepEqual(route.requirements.capabilities, ["python"]);
  for (const local of [null, host("local", []), host("local", [capability("python", "unknown")]), host("local", [capability("python")], { inventory: { version: 1, observedAt: 0, validUntil: 1, capabilities: [] } })]) {
    assert.equal(f.selectAssessedTaskRoute(p, catalog, local, foregroundMobile, time).reason, "local-unobserved");
  }
});

test("actual installed mobile toolchain permits bounded foreground work, without pretending it is a persistent desktop worker", () => {
  const f = fixture(), p = plan([branch({ requirements: { capabilities: ["python"], platforms: [] } })]), catalog = { peers: [peer(host("idle", [capability("python")]))] };
  const route = f.selectAssessedTaskRoute(p, catalog, null, mobile(["python"]), time);
  assert.equal(route.selected, null); assert.equal(route.reason, "small-local");
  p.continuity = "persistent";
  assert.equal(f.selectAssessedTaskRoute(p, catalog, null, mobile(["python"]), time).selected.peerId, "idle");
});

test("failed, stale, malformed or merely installable mobile environments do not become installed tool evidence", () => {
  const f = fixture(), p = plan([branch({ requirements: { capabilities: ["python"], platforms: [] } })]), catalog = { peers: [peer(host("idle", [capability("python")]))] };
  for (const observation of [{ native: true, observedAt: time, execution: null }, { ...mobile(["python"]), observedAt: time - 60001 }, mobile([], { toolchains: undefined }), mobile([], { toolchains: [{ id: "python", installable: true }] }), mobile([])]) {
    assert.equal(f.selectAssessedTaskRoute(p, catalog, null, observation, time).reason, "local-unobserved");
  }
  const missing = mobile([], { installed: false });
  assert.equal(f.selectAssessedTaskRoute(p, catalog, null, missing, time).reason, "missing-environment");
});

test("a verified desktop-only task leaves the phone even without a mobile shell probe; a Mac label alone does not prove Xcode", () => {
  const f = fixture(), p = plan([branch({ requirements: { capabilities: ["xcode"], platforms: ["macos"] } })]);
  const catalog = { peers: [peer(host("mac-name", [], { platform: "macos" })), peer(host("verified-mac", [capability("xcode")], { platform: "macos" }))] };
  const route = f.selectAssessedTaskRoute(p, catalog, null, { native: true, execution: null, observedAt: time }, time);
  assert.equal(route.selected.peerId, "verified-mac"); assert.deepEqual(route.requirements, { capabilities: ["xcode"], platforms: ["macos"] });
  assert.ok(route.rejected.some(item => item.hostId === "mac-name"));
});

test("large foreground work stays with capable local device even when a peer is idle and the worker queue is busy", () => {
  const f = fixture(), p = plan([branch({ effort: "large", requirements: { capabilities: ["node"], platforms: [] } })]);
  const catalog = { peers: [peer(host("idle", [capability("node")])), peer(host("stale", [], { inventory: { version: 1, observedAt: 0, validUntil: 1, capabilities: [] } }))] };
  const route = f.selectAssessedTaskRoute(p, catalog, host("local", [capability("node")], { running: 2 }), foregroundMobile, time);
  assert.equal(route.selected, null); assert.equal(route.reason, "local-capable");
});

test("large foreground tasks require observed missing environment before offloading; unknown local evidence remains discovery", () => {
  const f = fixture(), p = plan([branch({ effort: "large", requirements: { capabilities: ["node"], platforms: [] } })]);
  const catalog = { peers: [peer(host("idle", [capability("node")]))] };
  const missing = f.selectAssessedTaskRoute(p, catalog, host("local", [capability("node", "unavailable")]), foregroundMobile, time);
  assert.equal(missing.selected.peerId, "idle"); assert.equal(missing.reason, "missing-environment");
  for (const local of [null, host("local", []), host("local", [capability("node", "unknown")]), host("local", [capability("node")], { inventory: { version: 1, observedAt: 0, validUntil: 1, capabilities: [] } })])
    assert.equal(f.selectAssessedTaskRoute(p, catalog, local, foregroundMobile, time).reason, "local-unobserved");
});

test("large foreground work uses observed mobile tools; data-only work does not require an arbitrary desktop executor", () => {
  const f = fixture(), catalog = { peers: [peer(host("idle", [capability("python")]))] };
  const p = plan([branch({ effort: "large", requirements: { capabilities: ["python"], platforms: [] } })]);
  assert.equal(f.selectAssessedTaskRoute(p, catalog, null, mobile(["python"]), time).reason, "local-capable");
  assert.equal(f.selectAssessedTaskRoute(p, catalog, null, mobile([]), time).reason, "local-unobserved");
  assert.equal(f.selectAssessedTaskRoute(plan([branch({ effort: "large" })]), catalog, null, mobile(), time).reason, "local-capable");
});

test("incompatible platform branches select a controller without claiming that one platform satisfies both", () => {
  const f = fixture(), p = plan([branch({ id: "ipa", requirements: { capabilities: ["xcode"], platforms: ["macos"] } }), branch({ id: "win", requirements: { capabilities: ["node"], platforms: ["windows"] } })], "persistent");
  const route = f.selectAssessedTaskRoute(p, { peers: [] }, host("local"), foregroundMobile, time);
  assert.equal(route.reason, "multiple-environments"); assert.equal(route.selected.local, true);
  assert.deepEqual(route.requirements.capabilities, []); assert.deepEqual(p.branches[0].requirements.capabilities, ["xcode"]);
});

test("a persistent request with no matching environment preserves foreground discovery and makes no phantom ownership", () => {
  const f = fixture(), p = plan([branch({ requirements: { capabilities: ["xcode"], platforms: ["macos"] } })], "persistent");
  const route = f.selectAssessedTaskRoute(p, { peers: [peer(host("wrong-os", [capability("node")]))] }, host("local"), foregroundMobile, time);
  assert.equal(route.selected, null); assert.equal(route.reason, "no-worker");
  assert.ok(route.rejected.length >= 2);
});
