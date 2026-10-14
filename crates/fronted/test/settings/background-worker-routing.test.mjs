import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
const api = createTsModuleLoader().loadModule("src/lib/automation/workerRouting.ts");
const now = 100000;
const inventory = capabilities => ({ version: 1, observedAt: now - 10, validUntil: now + 59990, capabilities: capabilities.map(id => ({ id, state: "available", evidence: id === "android-sdk" ? "sdk-layout" : "version-command", detail: "Actual observed evidence" })) });
const host = (id, overrides = {}) => ({ hostId: id, platform: "macos", architecture: "aarch64", executorReady: true, acceptsBackgroundTasks: true, workdir: "/real/workspace", workspaceAvailable: true, inputSnapshotVersion: 1, pending: 0, running: 0, observedAt: now, providers: [{ models: ["actual"] }], inventory: inventory(["xcode", "node"]), ...overrides });
const peers = hosts => ({ peers: hosts.map(h => ({ peerId: h.hostId, online: true, host: h })) });
const requirements = api.normalizeWorkerRequirements({ capabilities: ["xcode"], platforms: ["macos"] });

test("five-PC routing uses observed requirements, rejects unavailable hosts and prefers an eligible local desktop", () => {
  const catalog = peers([host("mac-one"), host("mac-two", { running: 2 }), host("win-one", { platform: "windows" }), host("win-two", { platform: "windows" }), host("win-three", { platform: "windows" })]);
  const routes = api.rankWorkerRoutes(catalog, host("local-mac"), requirements, { now });
  assert.equal(routes.selected.local, true); assert.equal(routes.selected.peerId, null);
  assert.equal(routes.rejected.length, 3); assert.deepEqual(routes.candidates.map(c => c.host.hostId), ["local-mac", "mac-one", "mac-two"]);
  assert.equal(api.rankWorkerRoutes(catalog, host("local-mac", { running: 2 }), requirements, { now }).selected.peerId, "mac-one");
});

test("queue/load ordering is deterministic across device enumeration order and locality can be disabled", () => {
  const a = host("a"), b = host("b"), loaded = host("loaded", { pending: 3, running: 2 });
  for (const hosts of [[b, a, loaded], [loaded, a, b]]) assert.equal(api.rankWorkerRoutes(peers(hosts), host("z"), requirements, { now, preferLocal: false }).selected.peerId, "a");
  assert.equal(api.rankWorkerRoutes(peers([loaded, host("lighter", { pending: 1, running: 2 })]), null, requirements, { now }).selected.peerId, "lighter");
});

test("offline, expired, unknown, legacy, identity-changed and ancestor hosts cannot be selected", () => {
  const unknown = inventory(["xcode"]); unknown.capabilities[0].state = "unknown";
  const catalog = peers([host("expired", { inventory: { ...inventory(["xcode"]), observedAt: now - 70000, validUntil: now - 10000 } }), host("unknown", { inventory: unknown }), host("legacy", { inventory: undefined }), host("ancestor"), host("offline"), host("changed")]);
  catalog.peers[4].online = false; catalog.peers[5].peerId = "original";
  const routes = api.rankWorkerRoutes(catalog, null, requirements, { now, excludedHostIds: ["ancestor"] });
  assert.equal(routes.selected, null); assert.equal(routes.rejected.length, 6); assert.ok(routes.rejected.every(r => r.reason));
});

test("Android routing requires actual JDK/SDK observations instead of an OS label", () => {
  const req = api.normalizeWorkerRequirements({ capabilities: ["java", "javac", "android-sdk"] });
  const complete = host("sdk-pc", { platform: "windows", inventory: inventory(["java", "javac", "android-sdk"]) });
  const incomplete = host("windows-only", { platform: "windows", inventory: inventory(["java"]) });
  assert.equal(api.rankWorkerRoutes(peers([incomplete, complete]), null, req, { now }).selected.peerId, "sdk-pc");
});

test("malformed requirement/evidence bounds fail without fabricating a candidate", () => {
  for (const req of [{}, { capabilities: ["invented-connector"] }, { platforms: ["ios"] }, { capabilities: ["node"], typo: true }, { capabilities: Array(9).fill("node") }]) assert.throws(() => api.normalizeWorkerRequirements(req));
  const normalized = api.normalizeWorkerRequirements({ capabilities: ["node", "git", "node"] }); assert.deepEqual(normalized, { capabilities: ["git", "node"], platforms: [] });
  for (const inv of [{ ...inventory(["xcode"]), capabilities: [...inventory(["xcode"]).capabilities, ...inventory(["xcode"]).capabilities] }, { ...inventory(["xcode"]), validUntil: now + 70000 }]) assert.equal(api.rankWorkerRoutes(peers([host("bad", { inventory: inv })]), null, requirements, { now }).selected, null);
});

test("local loopback duplicates are removed and rejected workspace/model/queue evidence cannot gain a slot", () => {
  const routes = api.rankWorkerRoutes(peers([host("local"), host("no-workdir", { workspaceAvailable: false }), host("no-model", { providers: [] }), host("bad-count", { pending: -1 })]), host("local"), requirements, { now });
  assert.equal(routes.candidates.length, 1); assert.equal(routes.candidates[0].local, true); assert.equal(routes.rejected.length, 3);
});
