import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const phone = "11111111-1111-4111-8111-111111111111", original = "22222222-2222-4222-8222-222222222222";
const fileSource = { version: 1, hostId: original, workdir: "/original/project" };
function harness(invoke = () => ({ exists: true, kind: "file" })) {
  const hooks = createReactHookHarness(), calls = [], opened = [], errors = [];
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "@tauri-apps/api/core": { async invoke(command, args) {
      calls.push([command, args]);
      if (command === "automation_device_identity") return { hostId: phone };
      return invoke(command, args);
    } },
    "@xgent/runtime": { invoke: () => assert.fail("Global file navigation used") },
  } });
  const { useChatFileLinkNavigation } = loader.loadModule("src/pages/chat/hooks/useChatFileLinkNavigation.ts");
  const params = { conversationId: "original-chat", conversationWorkdir: "/current-workspace", terminalProjectPathKey: "/current-workspace",
    notifyError: value => errors.push(value), onRevealInFileTree: () => assert.fail("Wrong current file tree"),
    openWorkspaceEditorFile: () => assert.fail("Wrong editor path"), openWorkspaceFilePreview: value => opened.push(value) };
  const render = () => hooks.render(() => useChatFileLinkNavigation(params));
  render(); return { params, render, calls, opened, errors, unmount: hooks.unmount };
}

test("history link opens its original-device workspace even when the current conversation has no working directory", async () => {
  const h = harness();
  try {
    h.params.conversationWorkdir = ""; await h.render()({ path: "report.md", source: "relative", fileSource });
    assert.equal(h.opened.length, 1);
    const request = h.opened[0]; assert.equal(request.workdir, fileSource.workdir); assert.deepEqual(request.fileSource, fileSource);
    await request.commandPort.invoke("fs_read_workspace_image", { workdir: request.workdir, path: request.path });
    assert.deepEqual(h.calls.filter(([command]) => command === "worker_peer_file_invoke").map(([, args]) => [args.peer_id, args.command, args.args.workdir]),
      [[original, "fs_path_status", fileSource.workdir], [original, "fs_read_workspace_image", fileSource.workdir]]);
  } finally { h.unmount(); }
});

test("unknown source and missing original file report errors without using the current host", async () => {
  const h = harness(() => ({ exists: false }));
  try {
    await h.render()({ path: "report.md", source: "relative", fileSource: null });
    assert.equal(h.calls.length, 0); assert.equal(h.errors.length, 1);
    await h.render()({ path: "report.md", source: "relative", fileSource });
    assert.equal(h.opened.length, 0); assert.equal(h.errors.length, 2);
  } finally { h.unmount(); }
});

test("conversation change and unmount retire delayed history file probes and failures", async () => {
  for (const close of [false, true]) for (const reject of [false, true]) {
    const wait = Promise.withResolvers(), h = harness(() => wait.promise);
    const running = h.render()({ path: "report.md", source: "relative", fileSource });
    await new Promise(setImmediate);
    if (close) h.unmount(); else { h.params.conversationId = "different-chat"; h.render(); }
    if (reject) wait.reject(new Error("obsolete peer failure")); else wait.resolve({ exists: true, kind: "file" });
    await running; assert.equal(h.opened.length, 0); assert.equal(h.errors.length, 0); h.unmount();
  }
});
