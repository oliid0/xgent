import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const origin = "11111111-1111-4111-8111-111111111111", remote = "22222222-2222-4222-8222-222222222222";
const requirements = [
  { id: "report", requirement: "Process documents, create implementation plan", dependsOn: [], locality: "portable" },
  { id: "slides", requirement: "Create PPT from the plan", dependsOn: ["report"], locality: "portable" },
  { id: "calendar", requirement: "Arrange tomorrow on the initiating phone", dependsOn: [], locality: "initiating-device" },
  { id: "exercise", requirement: "Remind every evening", dependsOn: [], locality: "initiating-device" },
];
const routing = () => ({ version: 1, initiatingHostId: origin, branches: structuredClone(requirements) });
const plan = () => ({ version: 1, branches: requirements.map(b => ({ ...b, title: b.id, criteria: b.locality === "portable" ? [{ kind: "artifact", path: b.id === "slides" ? "report.pptx" : "plan.docx" }] : [{ kind: "unavailable", capability: "Original phone needed" }] })).map(({ locality, ...b }) => b) });
const module = createTsModuleLoader().loadModule("src/lib/automation/backgroundRoutingConstraints.ts");

test("mixed source graph captures every original requirement and dependency without mutable aliases or grants", () => {
  const assessment = { version: 1, continuity: "persistent", branches: structuredClone(requirements) };
  const captured = module.captureBackgroundSourceRouting(assessment, origin);
  assessment.branches[0].requirement = "Removed requirement"; assessment.branches[1].dependsOn.push("exercise");
  assert.deepEqual(captured, routing()); module.validateBackgroundRoutingPlan(plan(), captured, remote);
});

test("source graph rejects unknown device identity, locality, hidden grants, missing dependencies and cycles", () => {
  for (const change of [r => r.initiatingHostId = "PC name", r => r.accountGrant = true, r => r.branches[0].locality = "unknown", r => r.branches[0].dependsOn = ["missing"],
    r => r.branches[0].dependsOn = ["slides"], r => r.branches[1].dependsOn = ["report", "report"], r => r.branches[0].requirement = "文".repeat(1000)]) {
    const r = routing(); change(r); assert.throws(() => module.validateBackgroundSourceRouting(r));
  }
});

test("remote plans cannot drop or rewrite phone requirements, dependencies, or replace them with claimed completion", () => {
  for (const change of [p => p.branches.pop(), p => p.branches[2].requirement = "Answer only", p => p.branches[1].dependsOn = [],
    p => p.branches[2].criteria = [{ kind: "answer" }], p => p.branches[3].criteria = [{ kind: "artifact", path: "reminder.txt" }],
    p => p.branches[2].criteria = [{ kind: "operation", tool: "Calendar", arguments: { account: "PC account" } }]]) {
    const p = plan(); change(p); assert.throws(() => module.validateBackgroundRoutingPlan(p, routing(), remote));
  }
  const local = plan(); local.branches[2].criteria = [{ kind: "operation", tool: "MobilePersonalActions", arguments: {} }];
  module.validateBackgroundRoutingPlan(local, routing(), origin);
});

test("immutable source routing survives normal context validation and malformed recovery cannot silently lose constraints", () => {
  const { validateBackgroundSourceContext } = createTsModuleLoader().loadModule("src/lib/automation/backgroundSourceContext.ts");
  const context = { version: 1, requestScope: "original/turn", systemPrompt: "Original memory", messages: [{ role: "user", content: "Full request" }], routing: routing() };
  validateBackgroundSourceContext(context); context.routing.branches[2].locality = "anywhere";
  assert.throws(() => validateBackgroundSourceContext(context));
});

test("native read contracts preserve exact health scope in v2 and cannot become portable, hidden grants or v1 writes", () => {
  const r=routing();r.version=2;
  r.branches[2].observation={kind:"health_samples",metric:"heart_rate",startMs:1000,endMs:2000,limit:200};
  module.validateBackgroundSourceRouting(r);module.validateBackgroundRoutingPlan(plan(),r,remote);
  for(const change of [r=>r.version=1,r=>r.branches[2].locality="portable",r=>r.branches[2].observation.kind="calendar_event",
    r=>r.branches[2].observation.metric="invented",r=>r.branches[2].observation.limit=0,r=>r.branches[2].observation.limit=201,
    r=>r.branches[2].observation.endMs=1000,r=>r.branches[2].observation.endMs=604801001,
    r=>r.branches[2].observation.endMs=Infinity,r=>r.branches[2].observation.approved=true]) {
    const changed=structuredClone(r);change(changed);assert.throws(()=>module.validateBackgroundSourceRouting(changed));
  }
  const forged=plan();forged.branches[2].criteria=[{kind:"answer"}];
  assert.throws(()=>module.validateBackgroundRoutingPlan(forged,r,remote));
  const captured=module.captureBackgroundSourceRouting({version:1,continuity:"persistent",branches:r.branches},origin);
  assert.equal(captured.version,1);assert.equal(captured.branches[2].observation,undefined,"model routing assessments cannot manufacture the native read contract");
});
