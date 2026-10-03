import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness(options = {}) {
  const hooks = createReactHookHarness(), calls = [];
  const loader = createTsModuleLoader({ mocks: { react: hooks.react, "@xgent/runtime": { invoke: async (command, args) => {
    calls.push([command, args]); return options.invoke?.(command, args) ?? { stdout: "Output", stderr: "", exitCode: 0 };
  } } } });
  const { useWorkspaceEditorExecution } = loader.loadModule("src/components/workspace-editor/useWorkspaceEditorExecution.ts");
  const props = { beforeRun: async () => true, canRun: () => true, failure: "Run failed", stopFailure: "Stop failed", ...options };
  const render = () => hooks.render(() => useWorkspaceEditorExecution(props));
  render();
  return { render, calls, props, replay: () => hooks.replayEffects(), unmount: () => hooks.unmount() };
}
const target = { key: "file", session: 1, workdir: "/project", path: "a.py" };

test("execution reserves before consuming native source and retires before-launch work on effect replay", async () => {
  const saving = Promise.withResolvers(), h = harness({ beforeRun: () => saving.promise }); let prepared = 0;
  try {
    const run = h.render().run(target, () => { prepared++; return true; });
    assert.equal(await h.render().run(target, () => { prepared++; return true; }), false);
    assert.equal(prepared, 1);
    h.replay(); assert.equal(h.render().busy, false);
    saving.resolve(true); assert.equal(await run, false);
    assert.equal(h.calls.some(([command]) => command === "shell_run"), false);
    assert.equal(h.render().result, null);
  } finally { saving.resolve(true); h.unmount(); }
});

test("execution rechecks the saved origin and ignores a process result after editor unmount", async () => {
  const saving = Promise.withResolvers(), process = Promise.withResolvers(); let ready = true;
  const h = harness({ beforeRun: () => saving.promise, canRun: (_target, saved) => !saved || ready, invoke: () => process.promise });
  try {
    const invalid = h.render().run(target); ready = false; saving.resolve(true);
    assert.equal(await invalid, false); assert.equal(h.calls.length, 0);
    ready = true; const run = h.render().run(target); await new Promise(setImmediate);
    assert.equal(h.render().result.phase, "running");
    h.unmount(); process.resolve({ stdout: "Retired", stderr: "", exitCode: 0 }); assert.equal(await run, false);
    assert.equal(h.render().result.output, "");
  } finally { saving.resolve(true); process.resolve({ stdout: "", stderr: "", exitCode: 0 }); h.unmount(); }
});

test("execution clears a preceding result during save and old direct controls cannot target the next process", async () => {
  const saving = Promise.withResolvers(), process = Promise.withResolvers(); let delaySave = false, launches = 0;
  const h = harness({ beforeRun: () => delaySave ? saving.promise : Promise.resolve(true), invoke: command => command === "shell_run" ? (++launches === 1 ? { stdout: "First", stderr: "", exitCode: 0 } : process.promise) : false });
  try {
    await h.render().run(target); const dismiss = h.render().dismiss;
    delaySave = true; const run = h.render().run(target);
    assert.equal(h.render().result, null); assert.equal(dismiss(), false);
    saving.resolve(true); await new Promise(setImmediate); const oldStop = h.render().stop;
    process.resolve({ stdout: "Second", stderr: "", exitCode: 0 }); await run;
    assert.equal(await oldStop(), false); assert.equal(h.calls.filter(([command]) => command === "shell_cancel").length, 0);
  } finally { saving.resolve(true); process.resolve({ stdout: "", stderr: "", exitCode: 0 }); h.unmount(); }
});
