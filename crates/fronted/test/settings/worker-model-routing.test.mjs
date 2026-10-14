import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
const loader = createTsModuleLoader();
const { selectWorkerModelBinding: select } = loader.loadModule("src/lib/automation/workerModelRouting.ts");
const { normalizeWorkerRequirements: normalize, rankWorkerRoutes: rank } = loader.loadModule("src/lib/automation/workerRouting.ts");
const now = 100000;
const profile = (model, skills, counts = {}) => ({ model, skills, backgroundPending: 0, backgroundRunning: 0, backgroundWaiting: 0, ...counts });
const provider = (id, profiles) => ({ id, name: id, providerType: "codex", models: profiles.map(p => p.model), modelProfiles: profiles });
const host = (id, providers, extra = {}) => ({ hostId: id, platform: "macos", workdir: "/work", executorReady: true, acceptsBackgroundTasks: true, workspaceAvailable: true, inputSnapshotVersion: 1, modelRoutingVersion: 1, observedAt: now, pending: 0, running: 0, providers, ...extra });
const peers = hosts => ({ peers: hosts.map(host => ({ peerId: host.hostId, online: true, host })) });
const skills = normalize({ modelSkills: ["coding"] });

test("specialty-only requirements normalize without changing old requirement serialization", () => {
  assert.deepEqual(skills, { capabilities: [], platforms: [], modelSkills: ["coding"] });
  assert.deepEqual(normalize({ capabilities: ["node"] }), { capabilities: ["node"], platforms: [] });
  assert.deepEqual(normalize({ capabilities: ["node"], modelSkills: [] }), { capabilities: ["node"], platforms: [] });
  assert.deepEqual(normalize({ modelSkills: ["research", "coding", "coding"] }).modelSkills, ["coding", "research"]);
  for (const modelSkills of [[], ["Opus"], ["has spaces"], ["生图"], [42], Array(17).fill("coding")]) assert.throws(() => normalize({ modelSkills }));
});

test("same model on multiple providers stays distinct and idle declared specialist wins", () => {
  const h = host("mac", [provider("busy", [profile("same", ["coding"], { backgroundRunning: 1 })]), provider("idle", [profile("same", ["coding"])])]);
  assert.deepEqual(select(h, {}, skills, now), { providerId: "idle", model: "same" });
  assert.deepEqual(select(h, { providerId: "busy", model: "same" }, skills, now), { providerId: "busy", model: "same" });
  assert.throws(() => select(h, { providerId: "other", model: "same" }, skills, now));
});

test("models are selected by configured specialties rather than names or current primary", () => {
  const h = host("pc", [provider("p", [profile("opus5", []), profile("declared", ["coding", "research"])])]);
  assert.deepEqual(select(h, { current: { customProviderId: "p", model: "opus5" } }, skills, now), { providerId: "p", model: "declared" });
  assert.throws(() => select(h, { model: "opus5" }, skills, now));
  assert.throws(() => select(h, {}, normalize({ modelSkills: ["coding", "video"] }), now));
});

test("legacy, expired, malformed and duplicate model profiles never supply specialties", () => {
  const valid = provider("p", [profile("m", ["coding"])]);
  for (const extra of [{ modelRoutingVersion: undefined }, { observedAt: now - 60001 }, { observedAt: now + 60001 }, { observedAt: NaN }]) assert.throws(() => select(host("x", [valid], extra), {}, skills, now));
  for (const profiles of [[profile("m", ["coding"], { backgroundRunning: -1 })], [profile("m", ["coding"], { backgroundPending: 0.5 })], [profile("m", ["coding", "coding"])], [profile("m", ["coding"]), profile("m", ["coding"])]]) {
    assert.throws(() => select(host("x", [{ ...valid, modelProfiles: profiles }]), {}, skills, now));
  }
});

test("joint device/model routing rejects an ineligible local host and honors exact model pins", () => {
  const local = host("local", [provider("lp", [profile("general", [])])]);
  const coding = host("coding", [provider("cp", [profile("coder", ["coding"])])]);
  const research = host("research", [provider("rp", [profile("analyst", ["research"])])]);
  const routed = rank(peers([research, coding]), local, skills, { now });
  assert.equal(routed.selected.peerId, "coding"); assert.deepEqual(routed.selected.model, { providerId: "cp", model: "coder" }); assert.equal(routed.rejected.length, 2);
  assert.equal(rank(peers([coding, research]), local, skills, { now, modelSelection: { providerId: "rp", model: "analyst" } }).selected, null);
  assert.equal(rank(peers([coding]), local, skills, { now, excludedHostIds: ["coding"] }).selected, null);
});

test("original single-model preference and explicit provider selection work without profile protocol", () => {
  const h = host("legacy", [provider("first", [profile("a", [])]), provider("second", [profile("b", [])])], { modelRoutingVersion: undefined });
  assert.deepEqual(select(h, { current: { customProviderId: "second", model: "b" } }), { providerId: "second", model: "b" });
  assert.deepEqual(select(h, { providerId: "first", current: { customProviderId: "second", model: "b" } }), { providerId: "first", model: "a" });
});
