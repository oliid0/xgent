import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const viewModel = loader.loadModule("src/lib/trajectory/viewModel.ts");
const sections = loader.loadModule("src/lib/trajectory/sections.ts");

const addressedId = (prefix, value) =>
  `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;

test("trajectory event parser rejects non-arrays and drops malformed rows", () => {
  assert.throws(() => viewModel.parseTrajectoryEvents("{}"), /must be an array/);
  assert.deepEqual(
    viewModel.parseTrajectoryEvents(
      JSON.stringify([{ k: "user", at: 1, t: 1 }, null, { k: "bad" }, { at: 2 }]),
    ),
    [{ k: "user", at: 1, t: 1 }],
  );
});

test("trajectory merge keeps repeated events but removes the persisted live prefix", () => {
  const first = { k: "step_start", at: 1, t: 1, s: 1 };
  const repeated = { k: "first_token", at: 2, t: 1, s: 1 };
  const tail = { k: "step_end", at: 3, t: 1, s: 1, st: "complete" };
  assert.deepEqual(
    viewModel.mergeTrajectoryEvents([first, repeated], [first, repeated, repeated, tail]),
    [first, repeated, repeated, tail],
  );
});

test("trajectory grouping attaches header records to their active turn", () => {
  const events = [
    { k: "user", at: 1, t: 1 },
    { k: "header", at: 2, hid: "h1" },
    { k: "turn_end", at: 3, t: 1, st: "complete" },
    { k: "compaction_start", at: 4, t: null },
  ];
  const groups = viewModel.groupTrajectoryEvents(events);
  assert.deepEqual(
    groups.map((group) => [group.turn, group.events.map((event) => event.k)]),
    [
      [1, ["user", "header", "turn_end"]],
      [null, ["compaction_start"]],
    ],
  );
});

test("trajectory headers use the backend-compatible ordered SHA-256 wire format", () => {
  const built = sections.buildTrajectoryHeader({
    base: "BASE",
    toolsSuffix: "TOOLS",
    toolCatalog: '[{"name":"Read"}]',
  });
  assert.deepEqual(built.refs, [
    addressedId("s", "BASE"),
    null,
    null,
    null,
    addressedId("s", "TOOLS"),
    addressedId("s", '[{"name":"Read"}]'),
    null,
  ]);
  assert.equal(built.headerId, addressedId("h", built.refs.map((ref) => ref ?? "-").join("\0")));
  assert.equal(built.change, "initial");
  assert.equal(sections.composeTrajectorySystemPrompt({ base: " BASE ", toolsSuffix: "TOOLS" }), "BASE\n\nTOOLS");
});

test("trajectory timeline preserves inherited header turn and pairs execution spans", () => {
  const timeline = viewModel.buildTrajectoryTimeline([
    { k: "user", at: 100, t: 2 },
    { k: "header", at: 110, hid: "h2", sec: [] },
    { k: "step_start", at: 120, t: 2, s: 1, hid: "h2" },
    { k: "tool_start", at: 140, t: 2, s: 1, id: "call-1", n: "Read" },
    { k: "tool_end", at: 170, t: 2, s: 1, id: "call-1" },
    { k: "step_end", at: 200, t: 2, s: 1, st: "complete" },
    { k: "turn_end", at: 210, t: 2, st: "complete" },
  ]);
  assert.equal(timeline.find((item) => item.event.k === "header").turn, 2);
  assert.equal(timeline.find((item) => item.event.k === "step_start").durationMs, 80);
  assert.equal(timeline.find((item) => item.event.k === "tool_start").durationMs, 30);
  assert.equal(timeline.some((item) => item.event.k === "tool_end"), false);
});
