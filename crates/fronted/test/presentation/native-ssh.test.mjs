import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness() {
  const calls = [];
  const controller = new AbortController();
  const client = {
    async createSsh() { return { prompt: { id: "trust", kind: "hostKey", fingerprintSha256: "SHA256:verified" } }; },
    async answerSshPrompt(answer) { calls.push(["answer", answer]); return { snapshot: { session: { id: "session" } } }; },
    async cancelSshPrompt(id) { calls.push(["cancel-prompt", id]); },
    async close(id) { calls.push(["close", id]); },
  };
  const loader = createTsModuleLoader({ mocks: {
    "./tauriTerminalClient": { tauriTerminalClient: client },
    "@xgent/runtime": { async invoke(command, args) { calls.push([command, args]); return { stdout: "ready", exitCode: 0 }; } },
  } });
  const { runNativeSshCommand } = loader.loadModule("src/lib/terminal/runNativeSshCommand.ts");
  return { calls, controller, client, run: (prompt) => runNativeSshCommand({ hostId: "host", workdir: "/project", projectPathKey: "/project", command: "pwd", runId: "run", signal: controller.signal, prompt }) };
}

test("native desktop SSH requires explicit host trust and releases its authenticated session", async () => {
  const h = harness();
  const result = await h.run(async (prompt) => {
    assert.equal(prompt.fingerprintSha256, "SHA256:verified");
    assert.equal(h.calls.length, 0);
    return { trustHostKey: true };
  });
  assert.equal(result.stdout, "ready");
  assert.deepEqual(h.calls.map(([name]) => name), ["answer", "terminal_ssh_exec", "close"]);
  assert.equal(h.calls[1][1].session_id, "session");
});

test("cancelling native SSH while the trust sheet is open never executes the command", async () => {
  const h = harness();
  await assert.rejects(h.run(async () => { h.controller.abort(); return { trustHostKey: true }; }), { name: "AbortError" });
  assert.equal(h.calls.some(([name]) => name === "answer" || name === "terminal_ssh_exec"), false);
  assert.equal(h.calls.some(([name]) => name === "cancel-prompt"), true);
});

test("native SSH closes a session that finishes connecting after cancellation", async () => {
  const h = harness();
  h.client.createSsh = async () => { h.controller.abort(); return { snapshot: { session: { id: "late" } } }; };
  await assert.rejects(h.run(async () => ({})), { name: "AbortError" });
  assert.ok(h.calls.some(([name, id]) => name === "close" && id === "late"));
  assert.equal(h.calls.some(([name]) => name === "terminal_ssh_exec"), false);
});
