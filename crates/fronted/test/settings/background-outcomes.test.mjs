import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const lease = { attempt: 2, generation: 3, token: "11111111-1111-4111-8111-111111111111" };
const branch = (id, criterion) => ({ id, title: id, requirement: `Original ${id} requirement`, dependsOn: [], criteria: [criterion] });
const plan = { version: 1, branches: [branch("report", { kind: "artifact", path: "report.docx" }), branch("slides", { kind: "artifact", path: "slides.pptx" }), branch("calendar", { kind: "operation", tool: "Calendar", arguments: { calendar: "accepted", day: "tomorrow" } }), branch("exercise", { kind: "unavailable", capability: "phone notification connector" })] };
const report = (value = plan, state = "pending") => ({ verified: state === "verified", branches: value.branches.map((branch) => ({ branch, state, evidence: null, reason: null })) });

test("accepted dependency waits propagate transitively without changing stored states, criteria or evidence", async () => {
  const pending = (id, dependencies = []) => ({ branch: { ...branch(id, { kind: "artifact", path: `${id}.docx` }), dependsOn: dependencies }, state: "pending", reason: null, evidence: null });
  const original = { verified: false, branches: [pending("slides", ["plan"]), pending("plan", ["documents"]),
    { ...pending("documents"), state: "waiting", reason: "Original child still running" }, pending("reminder")] };
  const before = JSON.stringify(original), f = setup({ existing: original });
  const observed = await f.readBackgroundOutcomeReport("execution", lease);
  assert.deepEqual(observed.branches.map(item => item.state), ["waiting", "waiting", "waiting", "pending"]);
  assert.match(observed.branches[0].reason, /plan/);
  assert.match(f.backgroundOutcomeSection(original), /"dependencyReadyBranchIds":\["reminder"\]/);
  assert.equal(JSON.stringify(original), before); assert.equal(observed.verified, false);
  original.branches[2].state = "verified";
  const recovered = await f.readBackgroundOutcomeReport("execution", lease);
  assert.deepEqual(recovered.branches.map(item => item.state), ["pending", "pending", "verified", "pending"]);
  assert.match(f.backgroundOutcomeSection(recovered), /"dependencyReadyBranchIds":\["plan","reminder"\]/);
  assert.equal(recovered.branches[0].evidence, null);
});
function setup(options = {}) {
  const calls = [], proposals = [], reviews = [], commits = [], controller = new AbortController();
  let read = 0, reviewRead = 0;
  const loader = createTsModuleLoader({ mocks: {
    "./backend": { backend: {
      async readBackgroundOutcomes(id, authority) { calls.push(["read", id, authority]); return options.existing ?? null; },
      async saveBackgroundPlan(id, proposal, authority) { commits.push({ id, proposal, authority }); if (options.commitFails) throw new Error("native dependency conflict / acceptance reply lost"); return report(proposal); },
      async resolveBackgroundPlan(id, proposal, tools, authority) { commits.push({ id, proposal, tools, authority }); if (options.commitFails) throw new Error("native resolution ACK lost"); return report(proposal); },
    } },
    "../providers/llm": {
      assistantMessageToText: (message) => message.content[0].text,
      async completeAssistantMessage(params) {
        await params.beforeModelRequest?.();
        if (params.sessionId.endsWith(":outcome-plan-coverage")) {
          reviews.push(params);
          const input = JSON.parse(params.context.messages.at(-1).content);
          const text = options.reviewResponses?.[Math.min(reviewRead++, options.reviewResponses.length - 1)] ?? JSON.stringify({ covered: true, requirements: [{ quote: input.originalRequest, branchIds: [input.proposal.branches[0].id] }], issues: [] });
          await options.onReview?.({ params, input, controller });
          return { role: "assistant", stopReason: options.reviewStopReason ?? "stop", content: [{ type: "text", text }] };
        }
        proposals.push(params); const text = options.responses?.[Math.min(read++, options.responses.length - 1)] ?? JSON.stringify(plan);
        return { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] };
      },
    },
  } });
  const api = loader.loadModule("src/lib/automation/backgroundOutcomes.ts");
  const run = (overrides = {}) => api.ensureBackgroundPlan({ request: { executionId: "task", prompt: "Documents, report, slides, tomorrow calendar and nightly exercise", model: "accepted-model", startedAt: 1 },
    lease, context: { systemPrompt: "Pinned workspace and real capabilities", messages: [], tools: [{ name: "Calendar", parameters: { type: "object" } }] },
    providerId: "openai", runtime: { baseUrl: "https://accepted.example", apiKey: "secret-not-in-context" }, signal: controller.signal,
    async verifyConfiguration() { calls.push(["verify"]); if (options.revoked) throw new Error("account permissions changed"); },
    ...overrides,
  });
  return { ...api, run, calls, proposals, reviews, commits, controller };
}

test("delegate coverage reviews the accepted child brief while the historical compound request remains reference data",async()=>{
  const brief="Create actual slides from the accepted document";
  const parent={version:2,requestScope:"phone/turn",systemPrompt:"Original history",originalRequest:"Report, slides, tomorrow calendar and nightly exercise",
    messages:[{role:"user",content:"Original documents"}],requestClock:{timestampMs:Date.parse("2026-10-14T06:30:00Z"),timeZone:"America/Los_Angeles"}};
  const {captureDelegatedBackgroundSourceContext}=createTsModuleLoader().loadModule("src/lib/automation/backgroundSourceContext.ts");
  const source=captureDelegatedBackgroundSourceContext(parent,"child",brief);
  const proposal={version:1,branches:[{id:"slides",title:"Slides",requirement:brief,dependsOn:[],criteria:[{kind:"artifact",path:"slides.pptx"}]}]};
  const f=setup({responses:[JSON.stringify(proposal)]});
  await f.run({request:{executionId:"child",prompt:brief,model:"configured",startedAt:1},originalRequest:source.originalRequest});
  assert.equal(JSON.parse(f.reviews[0].context.messages.at(-1).content).originalRequest,brief);
  assert.deepEqual(f.commits[0].proposal.branches.map(branch=>branch.id),["slides"]);
  assert.equal(parent.originalRequest,"Report, slides, tomorrow calendar and nightly exercise");
});

test("mixed source branches survive bounded plan repair before any native commit", async () => {
  const routing = { version: 1, initiatingHostId: "11111111-1111-4111-8111-111111111111", branches: [
    { id: "report", requirement: "Original report requirement", dependsOn: [], locality: "portable" },
    { id: "phone", requirement: "Schedule on the original phone", dependsOn: [], locality: "initiating-device" },
  ] };
  const valid = { version: 1, branches: [branch("report", { kind: "artifact", path: "report.docx" }),
    { ...branch("phone", { kind: "unavailable", capability: "Original phone connector" }), requirement: routing.branches[1].requirement },
  ] };
  const f = setup({ responses: [JSON.stringify({ version: 1, branches: [valid.branches[0]] }), JSON.stringify(valid)] });
  const result = await f.run({ routing, executingHostId: "22222222-2222-4222-8222-222222222222" });
  assert.equal(result.verified, false); assert.equal(result.branches.length, 2);
  assert.equal(f.proposals.length, 2); assert.equal(f.commits.length, 1);
  assert.deepEqual(f.commits[0].proposal, valid);
  assert.match(f.proposals[0].context.systemPrompt, new RegExp(routing.initiatingHostId));
});

test("a protected phone branch waits without model retries or account rebinding on the PC", async () => {
  const phone = branch("phone", { kind: "unavailable", capability: "Original phone Calendar connector" });
  const existing = report({ version: 1, branches: [phone] }, "waiting");
  const routing = { version: 1, initiatingHostId: "11111111-1111-4111-8111-111111111111", branches: [
    { id: phone.id, requirement: phone.requirement, dependsOn: [], locality: "initiating-device" },
  ] };
  const f = setup({ existing });
  assert.equal(await f.run({ routing, executingHostId: "22222222-2222-4222-8222-222222222222" }), existing);
  assert.equal(f.proposals.length, 0); assert.equal(f.commits.length, 0);
});

test("new PC capabilities may repair portable work while original phone authority remains unavailable", async () => {
  const base = { version: 1, branches: [branch("portable", { kind: "unavailable", capability: "Calendar tool discovery" }), branch("phone", { kind: "unavailable", capability: "Original phone calendar" })] };
  const existing = report(base, "waiting");
  const routing = { version: 1, initiatingHostId: "11111111-1111-4111-8111-111111111111", branches: base.branches.map((b) => ({
    id: b.id, requirement: b.requirement, dependsOn: b.dependsOn, locality: b.id === "phone" ? "initiating-device" : "portable",
  })) };
  const valid = structuredClone(base);
  valid.branches[0].criteria = [{ kind: "operation", tool: "Calendar", arguments: { calendar: "accepted" } }];
  const rebound = structuredClone(valid); rebound.branches[1].criteria = valid.branches[0].criteria;
  const f = setup({ existing, responses: [JSON.stringify(rebound), JSON.stringify(valid)] });
  await f.run({ routing, executingHostId: "22222222-2222-4222-8222-222222222222" });
  assert.equal(f.proposals.length, 2); assert.equal(f.commits.length, 1);
  assert.deepEqual(f.commits[0].proposal.branches[1], base.branches[1]);
  assert.deepEqual(f.commits[0].proposal.branches[0].criteria, valid.branches[0].criteria);
});

test("compound planning preserves separate file, action and unavailable outcomes and persists only a real proposal", async () => {
  const f = setup(); const result = await f.run();
  assert.equal(result.verified, false); assert.equal(result.branches.length, 4);
  assert.equal(f.commits.length, 1); assert.deepEqual(f.commits[0].authority, lease);
  assert.equal(f.proposals[0].context.tools, undefined);
  assert.equal(f.proposals[0].allowJsonOutput, true);
  assert.equal(f.proposals[0].runtime.nativeWebSearchEnabled, false);
  assert.match(f.proposals[0].context.systemPrompt, /EVERY independent requested outcome/);
  assert.equal(JSON.stringify(f.proposals[0].context).includes(lease.token), false);
  assert.equal(JSON.stringify(f.proposals[0].context).includes("secret-not-in-context"), false);
});

test("planning repair spends the same stream admission hook and refusal cannot commit a plan", async () => {
  let admissions = 0;
  const f = setup({ responses: ["invalid JSON", JSON.stringify(plan)] });
  await f.run({ beforeModelRequest: async () => { admissions++; if (admissions > 1) throw new Error("Shared execution budget exhausted"); } }).then(() => assert.fail("must stop before repair request"), error => assert.match(error.message, /budget exhausted/));
  assert.equal(admissions, 2); assert.equal(f.proposals.length, 1); assert.equal(f.commits.length, 0);
});

test("restart reuses the immutable native plan without replanning or granting new requirements", async () => {
  const f = setup({ existing: report() });
  assert.equal((await f.run()).branches[3].branch.id, "exercise");
  assert.equal(f.proposals.length, 0); assert.equal(f.commits.length, 0);
});

test("a resumed unavailable branch gains concrete action criteria without altering completed requirements", async () => {
  const blockedPlan = { version: 1, branches: [branch("report", { kind: "artifact", path: "report.docx" }), branch("calendar", { kind: "unavailable", capability: "Calendar discovery offline" })] };
  const existing = report(blockedPlan, "waiting"); existing.branches[0].state = "verified";
  const resolved = structuredClone(blockedPlan); resolved.branches[1].criteria = [{ kind: "operation", tool: "Calendar", arguments: { calendar: "accepted", day: "tomorrow" } }];
  const f = setup({ existing, responses: [JSON.stringify(resolved)] });
  const result = await f.run(); assert.equal(result.verified, false);
  assert.deepEqual(f.commits[0].tools, ["Calendar"]); assert.deepEqual(f.commits[0].authority, lease);
  assert.equal(f.proposals[0].context.tools, undefined); assert.match(f.proposals[0].sessionId, /capability-resolution/);
});

test("capability resolution cannot remove requirements, weaken existing criteria or replace an action with prose", async () => {
  const base = { version: 1, branches: [branch("calendar", { kind: "unavailable", capability: "Calendar connector offline" })] };
  const existing = report(base, "waiting"); const f = setup();
  for (const invalid of [
    { version: 1, branches: [] },
    { version: 1, branches: [{ ...base.branches[0], requirement: "Different request", criteria: [{ kind: "operation", tool: "Calendar", arguments: {} }] }] },
    { version: 1, branches: [{ ...base.branches[0], criteria: [{ kind: "answer" }] }] },
  ]) assert.throws(() => f.validateResolvedBackgroundPlan(invalid, existing, [{ name: "Calendar" }]));
  const lost = setup({ existing, commitFails: true, responses: [JSON.stringify({ version: 1, branches: [{ ...base.branches[0], criteria: [{ kind: "operation", tool: "Calendar", arguments: {} }] }] })] });
  await assert.rejects(lost.run(), /resolution ACK lost/); assert.equal(lost.proposals.length, 1); assert.equal(lost.commits.length, 1);
});

test("unchanged unavailable criteria remain waiting and spend no native resolution write", async () => {
  const base = { version: 1, branches: [branch("calendar", { kind: "unavailable", capability: "Missing permission" })] };
  const f = setup({ existing: report(base, "waiting"), responses: [JSON.stringify(base)] });
  assert.equal((await f.run()).branches[0].state, "waiting"); assert.equal(f.commits.length, 0);
});

test("cyclic dependencies, escaped paths, unknown fields and oversized criteria are repaired before native acceptance", async () => {
  const a = branch("a", { kind: "answer" }), b = branch("b", { kind: "answer" }); a.dependsOn = ["b"]; b.dependsOn = ["a"];
  const proposals = [
    { version: 1, branches: [a, b] },
    { version: 1, branches: [branch("escape", { kind: "artifact", path: "../report.pptx" })] },
    { ...plan, authority: "invented" },
    { version: 1, branches: [branch("large", { kind: "unavailable", capability: "中".repeat(1000) })] },
  ];
  for (const proposal of proposals) {
    const f = setup({ responses: [JSON.stringify(proposal), JSON.stringify(plan)] });
    await f.run(); assert.equal(f.proposals.length, 2); assert.equal(f.commits.length, 1);
    assert.deepEqual(f.commits[0].proposal, plan);
  }
});

test("a malformed or invented-tool proposal has one bounded repair before any commit", async () => {
  for (const bad of ["not JSON", JSON.stringify({ ...plan, branches: [branch("wrong", { kind: "operation", tool: "InventedApi", arguments: {} })] })]) {
    const f = setup({ responses: [bad, JSON.stringify(plan)] });
    await f.run(); assert.equal(f.proposals.length, 2); assert.equal(f.commits.length, 1);
    assert.match(f.proposals[1].context.messages.at(-1).content, /SAME original request/);
  }
  const alwaysBad = setup({ responses: ["bad"] });
  await assert.rejects(alwaysBad.run(), /planning failed before actions/);
  assert.equal(alwaysBad.commits.length, 0);
});

test("revocation, cancellation and native lost acceptance never trigger another proposal", async () => {
  const revoked = setup({ revoked: true }); await assert.rejects(revoked.run(), /permissions changed/); assert.equal(revoked.proposals.length, 0);
  const lost = setup({ commitFails: true }); await assert.rejects(lost.run(), /acceptance reply lost/); assert.equal(lost.proposals.length, 1); assert.equal(lost.commits.length, 1);
  const aborted = setup(); aborted.controller.abort(); await assert.rejects(aborted.run()); assert.equal(aborted.calls.length, 0);
});

test("pending/waiting requirements and inconsistent native success cannot pass the completion gate", async () => {
  const pending = report(); pending.branches[0].state = "verified"; pending.branches[3].state = "waiting"; pending.branches[3].reason = "phone offline";
  const f = setup({ existing: pending });
  await assert.rejects(f.requireBackgroundOutcomes("task", lease), /slides.*calendar.*exercise.*phone offline/);
  await assert.rejects(setup({ existing: { ...pending, verified: true } }).run(), /inconsistent/);
  const complete = setup({ existing: report(plan, "verified") }); assert.equal((await complete.requireBackgroundOutcomes("task", lease)).verified, true);
});

test("outcome context preserves criteria and state while keeping complete stored answer bodies out of the prompt", () => {
  const f = setup(); const source = report(); source.branches[0].evidence = { artifactIds: ["real-artifact"], callIds: [], answer: "long private text ".repeat(3000) };
  const section = f.backgroundOutcomeSection(source);
  assert.match(section, /report\.docx/); assert.match(section, /real-artifact/); assert.match(section, /answerStored/);
  assert.doesNotMatch(section, /long private text/);
});

test("dependency frontier separates ready, waiting and blocked work without claiming it was dispatched", () => {
  const value = { version: 1, branches: [
    branch("research", { kind: "answer" }),
    { ...branch("slides", { kind: "artifact", path: "slides.pptx" }), dependsOn: ["research"] },
    branch("calendar", { kind: "unavailable", capability: "original phone unavailable" }),
    { ...branch("delivery", { kind: "answer" }), dependsOn: ["slides", "calendar"] },
    branch("website", { kind: "artifact", path: "index.html" }),
  ] };
  const source = report(value); source.branches[0].state = "verified"; source.branches[2].state = "waiting";
  const section = setup().backgroundOutcomeSection(source);
  const snapshot = JSON.parse(section.split("\n")[3]);
  assert.deepEqual(snapshot.dependencyReadyBranchIds, ["slides", "website"]);
  assert.deepEqual(snapshot.waitingBranchIds, ["calendar", "delivery"]);
  assert.equal(source.branches[3].state, "pending");
  assert.deepEqual(snapshot.blockedDependencies, [{ branchId: "delivery", dependsOn: ["slides", "calendar"] }]);
  assert.match(section, /never duplicate accepted or uncertain actions/); assert.match(section, /do not poll them with repeated model turns/);
  assert.equal(snapshot.verified, false);
});

test("inconsistent native dependency graphs cannot become planning authority", () => {
  const api = setup();
  for (const branches of [[branch("same", { kind: "answer" }), branch("same", { kind: "answer" })],
    [{ ...branch("missing", { kind: "answer" }), dependsOn: ["absent"] }],
    [{ ...branch("cycle", { kind: "answer" }), dependsOn: ["cycle"] }],
    [{ ...branch("bad", { kind: "answer" }), dependsOn: null }]])
    assert.throws(() => api.backgroundOutcomeSection(report({ version: 1, branches })), /dependencies/);
});

test("omitted calendar and nightly recurrence trigger one complete repair before durable acceptance", async () => {
  const omitted = { version: 1, branches: plan.branches.slice(0, 2) };
  const rejected = { covered: false, requirements: [
    { quote: "report", branchIds: ["report"] }, { quote: "slides", branchIds: ["slides"] },
    { quote: "tomorrow calendar", branchIds: [] }, { quote: "nightly exercise", branchIds: [] },
  ], issues: [{ quote: "tomorrow calendar", reason: "Calendar action is omitted" }, { quote: "nightly exercise", reason: "Recurring schedule is omitted" }] };
  let admissions = 0;
  // The corrected second proposal receives an actual second assessment; do
  // not reuse the first rejection or pretend it proves anything completed.
  const responses = [JSON.stringify(rejected), JSON.stringify({ covered: true, requirements: [
    { quote: "Documents, report", branchIds: ["report"] }, { quote: "slides", branchIds: ["slides"] },
    { quote: "tomorrow calendar", branchIds: ["calendar"] }, { quote: "and nightly exercise", branchIds: ["exercise"] },
  ], issues: [] })];
  const g = setup({ responses: [JSON.stringify(omitted), JSON.stringify(plan)], reviewResponses: responses });
  const result = await g.run({ beforeModelRequest: () => { admissions++; } });
  assert.equal(admissions, 4); assert.equal(g.proposals.length, 2); assert.equal(g.reviews.length, 2);
  assert.equal(g.commits.length, 1); assert.deepEqual(g.commits[0].proposal, plan); assert.deepEqual(g.commits[0].authority, lease);
  assert.equal(result.verified, false); assert.match(g.proposals[1].context.messages.at(-1).content, /nightly exercise.*SAME original request/);
  for (const review of g.reviews) {
    assert.equal(review.model, "accepted-model"); assert.equal(review.context.tools, undefined);
    assert.equal(review.runtime.nativeWebSearchEnabled, false); assert.equal(review.allowJsonOutput, true);
    assert.equal(JSON.parse(review.context.messages.at(-1).content).originalRequest, "Documents, report, slides, tomorrow calendar and nightly exercise");
    assert.doesNotMatch(JSON.stringify(review.context), /secret-not-in-context/); assert.equal(JSON.stringify(review.context).includes(lease.token), false);
  }
});

test("invalid or repeated negative coverage cannot commit or start an execution", async () => {
  const failures = ["not JSON", JSON.stringify({ covered: true, requirements: [], issues: [] }),
    JSON.stringify({ covered: false, requirements: [{ quote: "nightly exercise", branchIds: [] }], issues: [{ quote: "nightly exercise", reason: "Not represented" }] })];
  for (const response of failures) {
    const f = setup({ reviewResponses: [response] });
    await assert.rejects(f.run(), /planning failed before actions/);
    assert.equal(f.proposals.length, 2); assert.equal(f.reviews.length, 2); assert.equal(f.commits.length, 0);
  }
});

test("coverage budget denial, provider error, cancellation and revocation never become proposal retries", async () => {
  let admissions = 0;
  const denied = setup();
  await assert.rejects(denied.run({ beforeModelRequest: () => { if (++admissions === 2) throw new Error("Shared execution budget exhausted"); } }), /budget exhausted/);
  assert.equal(denied.proposals.length, 1); assert.equal(denied.reviews.length, 0); assert.equal(denied.commits.length, 0);
  const failed = setup({ reviewStopReason: "error" });
  await assert.rejects(failed.run(), /coverage model request failed/);
  assert.equal(failed.proposals.length, 1); assert.equal(failed.reviews.length, 1); assert.equal(failed.commits.length, 0);
  const cancelled = setup({ onReview: ({ controller }) => controller.abort() });
  await assert.rejects(cancelled.run());
  assert.equal(cancelled.proposals.length, 1); assert.equal(cancelled.reviews.length, 1); assert.equal(cancelled.commits.length, 0);
  const config = { onReview() { config.revoked = true; } }, revoked = setup(config);
  await assert.rejects(revoked.run(), /permissions changed/);
  assert.equal(revoked.proposals.length, 1); assert.equal(revoked.reviews.length, 1); assert.equal(revoked.commits.length, 0);
});

test("coverage does not rewrite accepted plans or retry lost native acceptance", async () => {
  const existing = setup({ existing: report() }); await existing.run();
  assert.equal(existing.proposals.length, 0); assert.equal(existing.reviews.length, 0);
  const lost = setup({ commitFails: true }); await assert.rejects(lost.run(), /acceptance reply lost/);
  assert.equal(lost.proposals.length, 1); assert.equal(lost.reviews.length, 1); assert.equal(lost.commits.length, 1);
});

test("both requested compound examples retain files, analysis and original-phone unavailable work in assessed proposals", async () => {
  for (const example of [
    { prompt: "处理这些文档，给出实施方案，然后做好ppt汇报给我，对了，再帮我安排一下明天的行程，每天晚上提醒我健身", quotes: ["处理这些文档", "给出实施方案", "然后做好ppt汇报给我", "对了，再帮我安排一下明天的行程", "每天晚上提醒我健身"], branches: [
      branch("analysis", { kind: "answer" }), { ...branch("plan", { kind: "artifact", path: "implementation.docx" }), dependsOn: ["analysis"] },
      { ...branch("slides", { kind: "artifact", path: "report.pptx" }), dependsOn: ["plan"] }, branch("calendar", { kind: "unavailable", capability: "Original phone Calendar" }),
      branch("fitness", { kind: "unavailable", capability: "Original phone recurring reminder" }),
    ] },
    { prompt: "查询关于这个公司的文档，整理成ppt汇报，然后写一个类似的官网，并生成宣传视频", quotes: ["查询关于这个公司的文档", "整理成ppt汇报", "然后写一个类似的官网", "并生成宣传视频"], branches: [
      branch("research", { kind: "answer" }), { ...branch("slides", { kind: "artifact", path: "company.pptx" }), dependsOn: ["research"] },
      { ...branch("site", { kind: "artifact", path: "website/index.html" }), dependsOn: ["research"] }, branch("video", { kind: "unavailable", capability: "Video provider not configured" }),
    ] },
  ]) {
    const proposal = { version: 1, branches: example.branches };
    const review = { covered: true, requirements: example.quotes.map((quote, i) => ({ quote, branchIds: [example.branches[i].id] })), issues: [] };
    const f = setup({ responses: [JSON.stringify(proposal)], reviewResponses: [JSON.stringify(review)] });
    const result = await f.run({ request: { executionId: "original-compound-task", prompt: example.prompt, model: "accepted-model", startedAt: 1 } });
    assert.equal(f.commits.length, 1); assert.equal(f.commits[0].id, "original-compound-task"); assert.deepEqual(f.commits[0].proposal, proposal);
    assert.equal(result.verified, false); assert.equal(result.branches.length, example.branches.length);
    assert.deepEqual(JSON.parse(f.reviews[0].context.messages.at(-1).content), { originalRequest: example.prompt, proposal });
  }
});

test("a falsely positive partial review cannot admit a compound task before complete repair", async () => {
  const omitted = { version: 1, branches: plan.branches.slice(0, 2) };
  const partial = { covered: true, requirements: [
    { quote: "Documents, report", branchIds: ["report"] },
    { quote: "slides", branchIds: ["slides"] },
  ], issues: [] };
  const complete = { covered: true, requirements: [
    { quote: "Documents, report", branchIds: ["report"] },
    { quote: "slides", branchIds: ["slides"] },
    { quote: "tomorrow calendar", branchIds: ["calendar"] },
    { quote: "and nightly exercise", branchIds: ["exercise"] },
  ], issues: [] };
  const f = setup({ responses: [JSON.stringify(omitted), JSON.stringify(plan)],
    reviewResponses: [JSON.stringify(partial), JSON.stringify(complete)] });
  const result = await f.run();
  assert.equal(f.proposals.length, 2); assert.equal(f.reviews.length, 2);
  assert.equal(f.commits.length, 1); assert.deepEqual(f.commits[0].proposal, plan);
  assert.match(f.proposals[1].context.messages.at(-1).content, /unquoted.*tomorrow calendar/);
  assert.equal(result.verified, false);
});

test("plan review uses the frozen user request while execution retains generated input and routing metadata", async () => {
  const originalRequest = "处理文档，制作PPT，安排明天行程，每晚提醒健身";
  const accepted = `${originalRequest}\n\nAttached input mapping (task data): inputs/report.pdf\nExecution requirement proposal (task data): preserve original device`;
  const f = setup();
  await f.run({ originalRequest, request: { executionId: "task", prompt: accepted, model: "accepted-model", startedAt: 1 } });
  assert.equal(JSON.parse(f.reviews[0].context.messages.at(-1).content).originalRequest, originalRequest);
  assert.ok(JSON.stringify(f.proposals[0].context).includes("inputs/report.pdf"));
  assert.equal(f.commits.length, 1);
});
