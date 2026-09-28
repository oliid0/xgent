import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

function harness(options = {}) {
  const hooks = createReactHookHarness();
  const calls = [];
  let response = { exitCode: 0, stdout: "ok", stderr: "", cancelled: false };
  let closes = 0;
  const props = { open: true, workdir: "/project", mode: "terminal", onClose() { closes++; },
    initialCommand: "", autoRunInitialCommand: false };
  const mocks = Object.fromEntries([
    "Button", "Card", "Code", "EmptyState", "IconButton", "Layout", "Spinner", "Text", "TextInput", "Token",
  ].map((name) => [`@astryxdesign/core/${name}`, Object.fromEntries(
    (name === "Layout" ? ["HStack", "StackItem", "VStack"] : name === "Text" ? ["Heading", "Text"] : [name])
      .map(symbol => [symbol, symbol]))]));
  const loader = createTsModuleLoader({ mocks: {
    ...mocks,
    "@astryxdesign/core/CodeBlock": { Code: "Code", CodeBlock: "CodeBlock" },
    react: hooks.react,
    "@xgent/runtime": { async invoke(command, args) {
      calls.push({ command, args });
      if (options.invoke) return options.invoke(command, args);
      if (command === "shell_cancel") return { cancelled: true };
      return response;
    } },
    "../../../i18n": { useLocale: () => ({ t: (key) => key }) },
    "../../../components/icons": {},
    "../../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../../runtime/applePresentation": { isApplePresentationRuntime: () => options.apple !== false },
    "./MobilePanelScaffold": { MobileFullscreenPanel: "MobileFullscreenPanel" },
  } });
  const { MobileTerminalPanel } = loader.loadModule("src/pages/chat/mobile/MobileTerminalPanel.tsx");
  const render = () => hooks.render(() => MobileTerminalPanel(props))?.props;
  const run = async (command) => {
    render().handlers.get("command").run(command);
    await render().handlers.get("run").run(null);
    return calls.at(-1).args;
  };
  function find(type, predicate = () => true, node = hooks.render(() => MobileTerminalPanel(props))) {
    if (Array.isArray(node)) return node.map(item => find(type, predicate, item)).find(Boolean);
    if (node?.type === type && predicate(node.props)) return node;
    return find(type, predicate, node?.props?.children ?? []);
  }
  return { run, calls, render, find, props, unmount: () => hooks.unmount(),
    replayEffects: () => hooks.replayEffects(), get closes() { return closes; },
    setResponse: (value) => { response = value; } };
}

test("mobile terminal sends compound cd commands and Shell syntax unchanged", async () => {
  const h = harness();
  for (const command of [
    "cd src && printf ready", "cd src; pwd", "cd src\npwd", "cd src | cat",
    "cd src > log", "cd src # comment", "cd $HOME", 'cd "$HOME"',
    "cd $(pwd)", "cd src*", "cd -P src", "cd path\\ with\\ spaces",
    "cd 'src' && pwd", 'cd "src" && pwd', "cd ''", "cd '~'", "cd ' trailing '",
  ]) {
    const request = await h.run(command);
    assert.equal(request.command, command);
    assert.equal(request.cwd, null);
  }
});

test("mobile terminal persists successful literal cd and restores the previous directory", async () => {
  const h = harness();
  assert.equal((await h.run("cd 'source files'")).cwd, "source files");
  assert.equal((await h.run("pwd")).cwd, "source files");
  assert.equal((await h.run("cd ../tests")).cwd, "tests");
  assert.equal((await h.run("cd -")).cwd, "source files");
  assert.equal((await h.run("cd /workspace")).cwd, null);
  assert.equal((await h.run('cd "a & b"')).command, "pwd");
  assert.equal((await h.run("pwd")).cwd, "a & b");
});

test("failed cd does not change the next command cwd and traversal never invokes Shell", async () => {
  const h = harness();
  await h.run("cd src");
  h.setResponse({ exitCode: 1, stdout: "", stderr: "missing", cancelled: false });
  await h.run("cd missing");
  assert.equal((await h.run("pwd")).cwd, "src");
  const before = h.calls.length;
  await h.run("cd ../../outside");
  assert.equal(h.calls.length, before);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("old terminal results and errors cannot overwrite a new workspace run", async () => {
  for (const fail of [false, true]) {
    const old = deferred(), next = deferred();
    const h = harness({ invoke: (command, args) => {
      if (command === "shell_cancel") return Promise.resolve({ cancelled: true });
      return args.workdir === "/project" ? old.promise : next.promise;
    } });
    h.render(); h.replayEffects();
    h.render().handlers.get("command").run("cd old");
    const runSurface = h.render();
    const oldRun = runSurface.handlers.get("run").run(null);
    const oldSurface = h.render();
    await runSurface.handlers.get("run").run(null);
    assert.equal(h.calls.filter(call => call.command === "shell_run").length, 1);
    const oldId = h.calls[0].args.run_id;
    h.props.workdir = "/other"; h.render();
    assert.deepEqual(h.calls.filter(call => call.command === "shell_cancel").map(call => call.args.run_id), [oldId]);
    h.render().handlers.get("command").run("pwd");
    const newRun = h.render().handlers.get("run").run(null);
    const newId = h.calls.at(-1).args.run_id;
    assert.notEqual(oldId, newId);
    await oldSurface.handlers.get("cancel").run(null);
    assert.equal(h.calls.some(call => call.command === "shell_cancel" && call.args.run_id === newId), false);
    if (fail) old.reject(new Error("obsolete output"));
    else old.resolve({ exitCode: 0, stdout: "obsolete output", stderr: "", cancelled: false });
    await oldRun;
    const mid = h.render();
    assert.equal(JSON.stringify(mid.document).includes("obsolete output"), false);
    assert.equal(mid.handlers.get("run").enabled, false);
    assert.equal(mid.handlers.get("cancel").enabled, true);
    next.resolve({ exitCode: 0, stdout: "current output", stderr: "", cancelled: false });
    await newRun;
    assert.equal(JSON.stringify(h.render().document).includes("current output"), true);
    assert.equal(h.render().handlers.get("run").enabled, false); // empty command
    assert.equal(h.render().handlers.get("cancel").enabled, false);
  }
});

test("closing, returning to the same workspace, and unmounting retire shell runs", async () => {
  for (const leave of ["close", "switch-back", "unmount"]) {
    const old = deferred();
    const h = harness({ invoke: command => command === "shell_cancel" ? Promise.resolve({ cancelled: true }) : old.promise });
    h.render().handlers.get("command").run("pwd");
    const pending = h.render().handlers.get("run").run(null);
    const oldId = h.calls[0].args.run_id;
    if (leave === "close") { h.props.open = false; h.render(); h.props.open = true; h.render(); }
    else if (leave === "switch-back") { h.props.workdir = "/other"; h.render(); h.props.workdir = "/project"; h.render(); }
    else h.unmount();
    assert.ok(h.calls.some(call => call.command === "shell_cancel" && call.args.run_id === oldId));
    old.resolve({ exitCode: 0, stdout: "stale", stderr: "", cancelled: false });
    await pending;
    if (leave !== "unmount") {
      assert.equal(JSON.stringify(h.render().document).includes("stale"), false);
      h.render().handlers.get("command").run("next");
      assert.equal(h.render().handlers.get("run").enabled, true);
    }
  }
});

test("stale native actions and presentation failures cannot affect the next mode", async () => {
  const h = harness();
  const old = h.render();
  h.props.mode = "git"; h.render();
  old.handlers.get("command").run("stale command");
  await old.handlers.get("run").run(null);
  old.handlers.get("close").run(null);
  old.onError("stale presentation error");
  assert.equal(h.calls.length, 0);
  assert.equal(h.closes, 0);
  assert.equal(JSON.stringify(h.render().document).includes("stale"), false);
  h.render().handlers.get("command").run("pwd");
  assert.equal(h.render().handlers.get("run").enabled, true);
});

test("cancelled cd does not change the session cwd and auto-run is once per scope", async () => {
  const h = harness();
  h.setResponse({ exitCode: 0, stdout: "/project/src", stderr: "", cancelled: true });
  await h.run("cd src");
  h.setResponse({ exitCode: 0, stdout: "/project", stderr: "", cancelled: false });
  assert.equal((await h.run("pwd")).cwd, null);
  const auto = harness();
  auto.props.initialCommand = "pwd";
  auto.props.autoRunInitialCommand = true;
  auto.render(); auto.render();
  assert.equal(auto.calls.filter(call => call.command === "shell_run").length, 1);
  auto.props.open = false; auto.render(); auto.props.open = true; auto.render();
  assert.equal(auto.calls.filter(call => call.command === "shell_run").length, 2);
});

test("Android terminal form uses the same scoped run and retires old output", async () => {
  const old = deferred(), next = deferred();
  const h = harness({ apple: false, invoke: (command, args) => command === "shell_cancel"
    ? Promise.resolve({ cancelled: true }) : args.workdir === "/project" ? old.promise : next.promise });
  h.find("TextInput").props.onChange("echo old");
  h.find("HStack", value => value.as === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls[0].args.workdir, "/project");
  h.props.workdir = "/other"; h.find("TextInput").props.onChange("echo new");
  h.find("HStack", value => value.as === "form").props.onSubmit({ preventDefault() {} });
  old.resolve({ exitCode: 0, stdout: "old output", stderr: "", cancelled: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.stringify(h.find("MobileFullscreenPanel")).includes("old output"), false);
  next.resolve({ exitCode: 0, stdout: "new output", stderr: "", cancelled: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.stringify(h.find("MobileFullscreenPanel")).includes("new output"), true);
});
