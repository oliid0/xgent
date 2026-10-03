import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const params = { cwd: "/project", projectPathKey: "/project", hostId: "host" };
const snapshot = { session: { id: "ssh", projectPathKey: "/project" } };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(overrides = {}) {
  const hooks = createReactHookHarness(), calls = [];
  const props = { key: "/project", open: true };
  const client = { async createSsh() { return { snapshot }; }, async answerSshPrompt() { return { snapshot }; },
    async cancelSshPrompt(id) { calls.push(["cancel", id]); }, async close(id, key) { calls.push(["close", id, key]); }, ...overrides };
  const loader = createTsModuleLoader({ mocks: { react: hooks.react } });
  const { useNativeSshConnection } = loader.loadModule("src/presentation/useNativeSshConnection.ts");
  const render = () => hooks.render(() => useNativeSshConnection(client, props.key, props.open));
  return { props, calls, render, unmount: () => hooks.unmount() };
}

test("cancel before initial SSH connection completes closes the late backend session", async () => {
  for (const leave of ["cancel", "retire", "unmount", "switch"]) {
    const pending = deferred(), h = harness({ createSsh: () => pending.promise });
    const connecting = h.render().connect(params); h.render();
    if (leave === "switch") { h.props.key = "/other"; h.render(); }
    else if (leave === "unmount") h.unmount();
    else h.render()[leave]();
    pending.resolve({ snapshot });
    assert.equal(await connecting, null);
    assert.deepEqual(h.calls, [["close", "ssh", "/project"]]);
    h.unmount();
  }
});

test("SSH cancellation retires pending authentication and late host-key challenges", async () => {
  const h = harness({ createSsh: async () => ({ prompt: { id: "auth", kind: "auth", message: "Password", answerEcho: false } }) });
  const connecting = h.render().connect(params); h.render(); await settle();
  h.render().setAnswer("private response");
  h.render().cancel();
  assert.equal(await connecting, null);
  assert.equal(h.render().prompt, null);
  assert.equal(h.render().answer, "");
  assert.deepEqual(h.calls, [["cancel", "auth"]]);
  h.unmount();
  const pending = deferred(), late = harness({ createSsh: () => pending.promise });
  const starting = late.render().connect(params);
  late.render().retire();
  pending.resolve({ prompt: { id: "late-trust", kind: "hostKey" } });
  assert.equal(await starting, null);
  assert.deepEqual(late.calls, [["cancel", "late-trust"]]);
  assert.equal(await late.render().connect(params), null);
  late.unmount();
});

test("SSH chains authentication prompts, preserves answerEcho and clears prior secret text", async () => {
  const answers = [];
  const h = harness({
    createSsh: async () => ({ prompt: { id: "first", kind: "auth", message: "Password", answerEcho: false } }),
    answerSshPrompt: async answer => {
      answers.push(answer);
      return answer.promptId === "first" ? { prompt: { id: "second", kind: "auth", message: "OTP", answerEcho: true } } : { snapshot };
    },
  });
  const connecting = h.render().connect(params); h.render(); await settle();
  h.render().setAnswer("password"); h.render().submit(); h.render(); await settle();
  assert.equal(h.render().prompt.answerEcho, true);
  assert.equal(h.render().answer, "");
  h.render().setAnswer("otp"); h.render().submit();
  assert.equal(await connecting, snapshot);
  assert.deepEqual(answers, [{ promptId: "first", answer: "password" }, { promptId: "second", answer: "otp" }]);
  assert.equal(h.render().connecting, false);
  assert.equal(h.render().prompt, null);
  assert.equal(h.render().answer, "");
  h.unmount();
});

test("SSH authentication errors retire the prompt and permit a fresh connection", async () => {
  const h = harness({ createSsh: async () => ({ prompt: { id: "auth", kind: "auth" } }),
    answerSshPrompt: async () => { throw new Error("Authentication rejected"); } });
  const connecting = h.render().connect(params); h.render(); await settle();
  h.render().setAnswer("secret"); h.render().submit();
  await assert.rejects(connecting, /Authentication rejected/);
  assert.equal(h.render().connecting, false);
  assert.equal(h.render().answer, "");
  assert.deepEqual(h.calls, [["cancel", "auth"]]);
  const retrying = h.render().connect(params); h.render(); await settle();
  assert.ok(h.render().prompt);
  h.render().cancel(); await retrying;
  h.unmount();
});

test("SSH submits the latest acknowledged secret once before publishing a new document", async () => {
  const answers = [], reply = deferred();
  const h = harness({
    createSsh: async () => ({ prompt: { id: "auth", kind: "auth", answerEcho: false } }),
    answerSshPrompt: answer => { answers.push(answer); return reply.promise; },
  });
  const connecting = h.render().connect(params); await settle();
  h.render().setAnswer("old");
  const surface = h.render();
  surface.setAnswer("最后一字 🔑");
  surface.submit(); surface.submit();
  surface.setAnswer("late edit after submit");
  await settle();
  assert.deepEqual(answers, [{ promptId: "auth", answer: "最后一字 🔑" }]);
  assert.equal(h.render().answer, "");
  h.render().cancel();
  assert.deepEqual(h.calls, [["cancel", "auth"]]);
  reply.resolve({ snapshot });
  assert.equal(await connecting, null);
  assert.ok(h.calls.some(call => call[0] === "close"));
  h.unmount();
});

test("retired SSH handlers cannot connect, edit or cancel after leaving and returning to a workspace", async () => {
  const h = harness({ createSsh: async () => ({ prompt: { id: "auth", kind: "auth" } }) });
  const first = h.render().connect(params); await settle();
  const old = h.render();
  h.props.key = "/other"; h.render();
  assert.equal(await first, null);
  h.props.key = "/project"; h.render();
  const current = h.render().connect(params); await settle();
  const surface = h.render(); surface.setAnswer("current password");
  old.setAnswer("obsolete"); old.submit(); old.cancel(); old.retire();
  assert.equal(await old.connect(params), null);
  assert.equal(h.render().answer, "current password");
  assert.equal(h.calls.filter(call => call[0] === "cancel").length, 1);
  h.render().submit();
  assert.equal(await current, snapshot);
  h.unmount();
});
