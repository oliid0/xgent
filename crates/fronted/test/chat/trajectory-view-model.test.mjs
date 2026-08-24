import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const viewModel = loader.loadModule("src/lib/trajectory/viewModel.ts");

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
