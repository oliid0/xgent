import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { validateBackgroundPlanCoverage } = createTsModuleLoader().loadModule("src/lib/automation/backgroundPlanCoverage.ts");
const prompt = "处理文档，制作PPT，安排明天行程，每晚提醒健身";
const plan = { version: 1, branches: ["documents", "slides", "calendar", "fitness"].map(id => ({ id, title: id, requirement: id, dependsOn: [], criteria: [{ kind: "answer" }] })) };
const review = () => ({ covered: true, requirements: ["处理文档", "制作PPT", "安排明天行程", "每晚提醒健身"].map((quote, i) => ({ quote, branchIds: [plan.branches[i].id] })), issues: [] });

test("coverage binds exact original quotes to proposal branches, without becoming execution evidence", () => {
  const value = review(); assert.deepEqual(validateBackgroundPlanCoverage(value, prompt, plan), value);
  value.covered = false; value.requirements[3].branchIds = [];
  value.issues = [{ quote: "每晚提醒健身", reason: "Recurring reminder omitted" }];
  assert.equal(validateBackgroundPlanCoverage(value, prompt, plan).covered, false);
});

test("a review cannot declare full coverage while silently omitting original tasks or constraints", () => {
  for (const omitted of ["安排明天行程", "每晚提醒健身"]) {
    const value = review();
    value.requirements = value.requirements.filter(entry => entry.quote !== omitted);
    assert.throws(() => validateBackgroundPlanCoverage(value, prompt, plan), /unquoted/);
  }
  const value = review();
  value.requirements[3].quote = "提醒健身";
  assert.throws(() => validateBackgroundPlanCoverage(value, prompt, plan), /unquoted/);
});

test("full coverage preserves qualifiers and repeated instructions while accepting punctuation and whitespace gaps", () => {
  const original = "处理文档；制作PPT。\n安排明天行程！ 每晚提醒健身（每晚提醒健身）";
  assert.equal(validateBackgroundPlanCoverage(review(), original, plan).covered, true);
  const missed = review(); missed.requirements[0].quote = "处理";
  assert.throws(() => validateBackgroundPlanCoverage(missed, original, plan), /unquoted/);
  const partial = review(); partial.covered = false; partial.requirements.pop();
  partial.issues = [{ quote: "每晚提醒健身", reason: "Recurring schedule is not represented" }];
  assert.equal(validateBackgroundPlanCoverage(partial, original, plan).covered, false);
});

test("version 2 preserves the actual original request without turning generated intake metadata into that request", () => {
  const { captureBackgroundSourceContext, validateBackgroundSourceContext } = createTsModuleLoader().loadModule("src/lib/automation/backgroundSourceContext.ts");
  const context = { systemPrompt: "Actual memory", messages: [{ role: "user", content: prompt }] };
  const source = captureBackgroundSourceContext(context, "original-conversation/turn", prompt);
  assert.equal(source.version, 2); assert.equal(source.originalRequest, prompt);
  context.messages[0].content = "Changed after acceptance";
  assert.equal(source.messages[0].content, prompt);
  validateBackgroundSourceContext(source);
  for (const value of [undefined, "", " ", "a".repeat(262145)]) {
    assert.throws(() => validateBackgroundSourceContext({ ...source, originalRequest: value }));
  }
  const legacy = captureBackgroundSourceContext(context, "legacy/turn");
  assert.equal(legacy.version, 1); assert.equal(legacy.originalRequest, undefined);
  assert.throws(() => validateBackgroundSourceContext({ ...legacy, originalRequest: prompt }));
});

test("invented quotes, branch IDs, authority fields, duplicate mappings and contradictory success are rejected", () => {
  const changes = [
    value => { value.requirements[0].quote = "读取所有健康数据"; },
    value => { value.requirements[1].branchIds = ["nonexistent"]; },
    value => { value.requirements[1].branchIds = ["slides", "slides"]; },
    value => { value.requirements.push(value.requirements[0]); },
    value => { value.requirements[2].branchIds = []; },
    value => { value.issues = [{ quote: "安排明天行程", reason: "Wrong calendar account" }]; },
    value => { value.issues = [{ quote: "new permission", reason: "Grant it" }]; },
    value => { value.requirements[0].authority = "invented"; },
    value => { value.issues = [{ quote: "制作PPT", reason: "Broken", branchIds: ["slides"] }]; },
    value => { value.executionComplete = true; },
    value => { value.covered = false; },
  ];
  for (const change of changes) { const value = review(); change(value); assert.throws(() => validateBackgroundPlanCoverage(value, prompt, plan)); }
});

test("empty, malformed, excessive and byte-oversized assessments cannot bypass the review boundary", () => {
  for (const value of [null, [], true, {}, { ...review(), covered: "true" }, { ...review(), requirements: [] },
    { ...review(), requirements: Array(97).fill(review().requirements[0]) },
    { ...review(), issues: Array(33).fill({ quote: "制作PPT", reason: "Wrong evidence" }) },
    { ...review(), covered: false, issues: [{ quote: "制作PPT", reason: "中".repeat(700) }] },
    { ...review(), covered: false, issues: [{ quote: "制作PPT", reason: " " }] },
    { ...review(), requirements: [{ quote: " ", branchIds: ["documents"] }] },
    { ...review(), requirements: [{ quote: "中".repeat(3000), branchIds: ["documents"] }] },
  ]) assert.throws(() => validateBackgroundPlanCoverage(value, `${prompt}${"中".repeat(3000)}`, plan));
  const huge = { ...review(), covered: false, issues: Array(32).fill({ quote: "制作PPT", reason: "a".repeat(2048) }) };
  assert.throws(() => validateBackgroundPlanCoverage(huge, prompt, plan), /bounded/);
});
