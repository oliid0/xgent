import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

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

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mobileSshHarness(invoke, options = {}) {
  const hooks = createReactHookHarness();
  const calls = [];
  let closes = 0;
  const props = {
    open: true, workdir: "/project", projectPathKey: "/project",
    hosts: [{ id: "host", name: "Server", host: "server.test", port: 22,
      username: "user", authType: "password" }],
    associatedHostIds: [], onAssociatedHostIdsChange() {}, onOpenSettings() {},
    onClose() { closes++; },
  };
  const mocks = Object.fromEntries([
    "Banner", "Button", "Card", "ClickableCard", "EmptyState", "IconButton", "Layout",
    "Spinner", "Switch", "Text", "TextInput", "Token",
  ].map(name => [`@astryxdesign/core/${name}`, Object.fromEntries(
    (name === "Layout" ? ["HStack", "StackItem", "VStack"] : name === "Text"
      ? ["Heading", "Text"] : [name]).map(symbol => [symbol, symbol]))]));
  const loader = createTsModuleLoader({ mocks: {
    ...mocks,
    "@astryxdesign/core/CodeBlock": { Code: "Code", CodeBlock: "CodeBlock" },
    react: hooks.react,
    "@xgent/runtime": { async invoke(command, args) {
      calls.push({ command, args });
      return invoke(command, args);
    } },
    "../../../components/icons": {},
    "../../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => options.mobile !== false },
    "../../../lib/terminal/runNativeSshCommand": { runNativeSshCommand: options.runNativeSshCommand ?? (() => {
      throw new Error("desktop SSH should not be used on mobile");
    }) },
    "../../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "./MobilePanelScaffold": { MobileFullscreenPanel: "MobileFullscreenPanel" },
  } });
  const { MobileSshPanel } = loader.loadModule("src/pages/chat/mobile/MobileSshPanel.tsx");
  const render = () => hooks.render(() => MobileSshPanel(props))?.props;
  const selectHost = () => { render().handlers.get("host:connect").run(null); render(); };
  return { props, calls, render, selectHost, unmount: () => hooks.unmount(),
    get closes() { return closes; } };
}

test("mobile SSH reserves duplicate submits and retires the old workspace run", async () => {
  const old = deferred(), next = deferred();
  const h = mobileSshHarness((command, args) => command === "shell_cancel"
    ? Promise.resolve({ cancelled: true })
    : args.workdir === "/project" ? old.promise : next.promise);
  h.selectHost();
  h.render().handlers.get("command").run("pwd");
  const oldSurface = h.render();
  const oldRun = oldSurface.handlers.get("run").run(null);
  await oldSurface.handlers.get("run").run(null);
  const oldId = h.calls.find(call => call.command === "mobile_ssh_exec").args.run_id;
  assert.equal(h.calls.filter(call => call.command === "mobile_ssh_exec").length, 1);
  h.props.workdir = "/other";
  h.props.projectPathKey = "/other";
  h.render();
  assert.ok(h.calls.some(call => call.command === "shell_cancel" && call.args.run_id === oldId));
  oldSurface.handlers.get("command").run("stale command");
  await oldSurface.handlers.get("run").run(null);
  h.render().handlers.get("command").run("uname -a");
  const newRun = h.render().handlers.get("run").run(null);
  const newId = h.calls.filter(call => call.command === "mobile_ssh_exec").at(-1).args.run_id;
  assert.notEqual(newId, oldId);
  await oldSurface.handlers.get("cancel").run(null);
  assert.equal(h.calls.some(call => call.command === "shell_cancel" && call.args.run_id === newId), false);
  old.reject(new Error("obsolete failure"));
  await oldRun;
  assert.equal(JSON.stringify(h.render().document).includes("obsolete failure"), false);
  assert.equal(h.render().handlers.get("cancel").enabled, true);
  next.resolve({ exitCode: 0, stdout: "current", stderr: "", cancelled: false });
  await newRun;
  assert.ok(JSON.stringify(h.render().document).includes("current"));
  assert.equal(h.render().handlers.get("cancel").enabled, false);
});

test("closing or unmounting mobile SSH cancels pending runs without reviving old output", async () => {
  for (const leave of ["close", "unmount"]) {
    const pending = deferred();
    const h = mobileSshHarness(command => command === "shell_cancel"
      ? Promise.resolve({ cancelled: true }) : pending.promise);
    h.selectHost();
    h.render().handlers.get("command").run("pwd");
    const oldSurface = h.render();
    const running = oldSurface.handlers.get("run").run(null);
    const runId = h.calls[0].args.run_id;
    if (leave === "close") {
      oldSurface.handlers.get("close").run(null);
      h.props.open = false; h.render();
      h.props.open = true; h.render();
      assert.equal(h.closes, 1);
    } else h.unmount();
    assert.ok(h.calls.some(call => call.command === "shell_cancel" && call.args.run_id === runId));
    pending.resolve({ exitCode: 0, stdout: "stale", stderr: "", cancelled: false });
    await running;
    if (leave === "close") assert.equal(JSON.stringify(h.render().document).includes("stale"), false);
  }
});

test("mobile SSH uses the latest command and keyboard response before a document refresh", async () => {
  const pending = deferred();
  const h = mobileSshHarness(command => command === "shell_cancel" ? Promise.resolve({}) : pending.promise);
  h.props.hosts[0].authType = "keyboardInteractive";
  h.selectHost();
  h.render().handlers.get("command").run("old command");
  h.render().handlers.get("challenge").run("old password");
  const surface = h.render();
  assert.equal(surface.handlers.get("run").enabled, true);
  surface.handlers.get("command").run("printf '最后一字 🔑'");
  surface.handlers.get("challenge").run("验证码 123456");
  const running = surface.handlers.get("run").run(null);
  await surface.handlers.get("run").run(null);
  assert.equal(h.calls.filter(call => call.command === "mobile_ssh_exec").length, 1);
  assert.equal(h.calls[0].args.remote_command, "printf '最后一字 🔑'");
  assert.equal(h.calls[0].args.keyboard_response, "验证码 123456");
  const waiting = h.render();
  assert.equal(JSON.stringify(waiting.document).includes("验证码 123456"), false);
  pending.resolve({ exitCode: 7, stdout: "stdout", stderr: "stderr", cancelled: true, timedOut: true });
  await running;
  const rendered = h.render();
  const nodes = rendered.document.nodes.flatMap(function walk(node) { return [node, ...(node.children ?? []).flatMap(walk)]; });
  assert.equal(nodes.find(node => node.id === "mobile-ssh-layout").kind, "TerminalLayout");
  assert.ok(nodes.some(node => node.kind === "CodeBlock" && node.text === "stdout"));
  assert.ok(nodes.some(node => node.kind === "CodeBlock" && node.text === "stderr"));
  assert.ok(nodes.some(node => node.kind === "Badge" && node.label === "chat.mobileTerminal.cancelled"));
  assert.ok(nodes.some(node => node.kind === "Badge" && node.label === "chat.mobileTerminal.timedOut"));
  assert.equal(rendered.handlers.get("clear").enabled, true);
  rendered.handlers.get("clear").run(null);
  assert.equal(JSON.stringify(h.render().document).includes("stdout"), false);
  h.unmount();
});

test("command SSH authentication consumes the latest secret once and clears it after submission", async () => {
  const answers = [], completed = deferred();
  const h = mobileSshHarness(() => Promise.resolve({}), {
    mobile: false,
    async runNativeSshCommand(options) {
      answers.push(await options.prompt({ id: "password", kind: "auth", message: "Password", answerEcho: false }));
      return completed.promise;
    },
  });
  h.selectHost(); h.render().handlers.get("command").run("pwd");
  const running = h.render().handlers.get("run").run(null);
  const surface = h.render();
  surface.handlers.get("ssh-answer").run("最后密码 🔑");
  surface.handlers.get("ssh-confirm").run(null);
  surface.handlers.get("ssh-confirm").run(null);
  await Promise.resolve();
  assert.deepEqual(answers, [{ answer: "最后密码 🔑" }]);
  assert.equal(JSON.stringify(h.render().document).includes("最后密码 🔑"), false);
  completed.resolve({ exitCode: 0, stdout: "ready", stderr: "", cancelled: false });
  await running;
  h.unmount();
});
