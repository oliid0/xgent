import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness() {
  const states = [];
  const calls = [];
  let cursor = 0;
  let response = { exitCode: 0, stdout: "ok", stderr: "", cancelled: false };
  const mocks = Object.fromEntries([
    "Button", "Card", "Code", "EmptyState", "IconButton", "Layout", "Spinner", "Text", "TextInput", "Token",
  ].map((name) => [`@astryxdesign/core/${name}`, {}]));
  const loader = createTsModuleLoader({ mocks: {
    ...mocks,
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
      useRef(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = { current: initial };
        return states[index];
      },
      useMemo: (create) => create(),
      useCallback: (callback) => callback,
      useEffect() {},
    },
    "@xgent/runtime": { async invoke(command, args) { calls.push({ command, args }); return response; } },
    "../../../i18n": { useLocale: () => ({ t: (key) => key }) },
    "../../../components/icons": {},
    "../../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "./MobilePanelScaffold": { MobileFullscreenPanel: "MobileFullscreenPanel" },
  } });
  const { MobileTerminalPanel } = loader.loadModule("src/pages/chat/mobile/MobileTerminalPanel.tsx");
  const render = () => {
    cursor = 0;
    return MobileTerminalPanel({ open: true, workdir: "/project", onClose() {} }).props;
  };
  const run = async (command) => {
    render().handlers.get("command").run(command);
    await render().handlers.get("run").run(null);
    return calls.at(-1).args;
  };
  return { run, calls, render, setResponse: (value) => { response = value; } };
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
