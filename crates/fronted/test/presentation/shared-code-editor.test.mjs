import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

async function harness(initial = {}) {
  const hooks = createReactHookHarness(), calls = [], options = {}, timers = new Map(), listeners = new Map();
  Object.assign(options, initial);
  const disk = new Map();
  const fileKey = args => JSON.stringify([args.workdir, args.path]);
  const put = (path, content = "Original", workdir = "/project") => {
    disk.set(fileKey({ workdir, path }), { path, content, contentHash: `initial:${workdir}:${path}`, mtimeMs: 10,
      totalLines: content.split("\n").length, sizeBytes: Buffer.byteLength(content) });
  };
  put("a.py"); put("b.py", "Second"); put("a.py", "Other workspace", "/other");
  let model = null, timer = 0, closed = 0, hidden = 0;
  const previousWindow = globalThis.window, previousEnvironment = globalThis.MonacoEnvironment;
  globalThis.window = {
    setTimeout(callback, delay) { const id = ++timer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { const id = ++timer; timers.set(id, { callback, delay: 0 }); return id; },
    cancelAnimationFrame: id => timers.delete(id),
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event, callback) => { if (listeners.get(event) === callback) listeners.delete(event); },
  };
  const write = args => {
    const before = disk.get(fileKey(args));
    assert.equal(args.expected_content_hash, before.contentHash);
    const next = { ...before, content: args.content, contentHash: `written:${before.mtimeMs + 1}`, mtimeMs: before.mtimeMs + 1,
      totalLines: args.content.split("\n").length, sizeBytes: Buffer.byteLength(args.content) };
    disk.set(fileKey(args), next); return next;
  };
  const editor = { getModel: () => model, setModel: next => { model = next; }, focus() {}, dispose() {},
    saveViewState: () => ({}), restoreViewState() {}, trigger() {} };
  const translate = key => key;
  const mocks = {
    react: hooks.react,
    "../../i18n": { useLocale: () => ({ t: translate }) },
    "@xgent/runtime": { invoke: async (command, args) => {
      calls.push([command, args]); return options.invoke ? options.invoke(command, args) : { stdout: "Output", stderr: "", exitCode: 0 };
    } },
    "../../lib/tools/fsBackend": { isFsBackendError: error => typeof error?.code === "string", invokeFs: async (command, args) => {
      calls.push([command, args]);
      return command.startsWith("fs_read") ? (options.read ? options.read(args) : disk.get(fileKey(args))) : (options.write ? options.write(args) : write(args));
    } },
    "../astryx/AdaptiveDialog": { AdaptiveDialog: "AdaptiveDialog" }, "../icons": {}, "../MacOsTitleBarSpacer": {},
    "@astryxdesign/core/hooks": { useMediaQuery: () => false },
    "monaco-editor": { Uri: { from: value => value }, editor: {
      create: () => editor, setTheme() {}, setModelLanguage: (model, language) => { model.language = language; },
      createModel(value, language) {
        const callbacks = [];
        return { language, disposed: false, getValue: () => value, getLineCount: () => value.split("\n").length,
          getLanguageId() { return this.language; }, onDidChangeContent: callback => callbacks.push(callback),
          setValue(next) { value = next; callbacks.forEach(callback => callback()); }, dispose() { this.disposed = true; } };
      },
    } },
  };
  for (const name of ["Banner", "Button", "CodeBlock", "EmptyState", "Icon", "IconButton", "Layout", "MoreMenu", "Spinner", "TabList", "Text", "Token", "Toolbar"]) {
    mocks[`@astryxdesign/core/${name}`] = Object.fromEntries([name, "HStack", "VStack", "Layout", "LayoutHeader", "LayoutFooter", "LayoutContent", "StackItem", "Heading", "Text", "Tab", "TabList"].map(name => [name, name]));
  }
  for (const name of ["editor/editor", "language/css/css", "language/html/html", "language/json/json", "language/typescript/ts"]) {
    mocks[`monaco-editor/${name}.worker?worker`] = { default: class {} };
  }
  const loader = createTsModuleLoader({ mocks });
  const { WorkspaceCodeEditorOverlay } = loader.loadModule("src/components/workspace-editor/WorkspaceCodeEditorOverlay.tsx");
  const props = { isOpen: true, theme: "light", closeRequestId: 1,
    openRequest: { id: 1, projectPathKey: "/project", workdir: "/project", path: "a.py" },
    onHide: () => hidden++, onClose: () => closed++, onPreviewFile() {} };
  const elements = item => {
    if (!item || typeof item !== "object") return [];
    if (Array.isArray(item)) return item.flatMap(elements);
    return [item, ...Object.values(item.props ?? {}).flatMap(value => typeof value === "function" ? [] : elements(value))];
  };
  const render = () => hooks.render(() => {
    const view = WorkspaceCodeEditorOverlay(props);
    for (const element of elements(view)) if (element.props?.ref && typeof element.props.ref === "object") element.props.ref.current = {};
    return view;
  });
  const find = predicate => elements(render()).find(predicate);
  const control = (label, type = "IconButton") => find(element => element.type === type && element.props.label === label);
  const flush = async () => { await new Promise(setImmediate); return render(); };
  const waitFor = async predicate => {
    for (let index = 0; index < 100; index++) { await flush(); if (predicate()) return; }
    throw new Error(`Editor did not settle: ${find(element => element.type === "Banner")?.props.description}`);
  };
  render(); if (!initial.defer) await waitFor(() => model !== null);
  return { props, options, calls, disk, put, write, render, flush, find, control, waitFor,
    get model() { return model; }, get closed() { return closed; }, get hidden() { return hidden; },
    text: () => model?.getValue(), input: value => model.setValue(value),
    getFile: (path = "a.py", workdir = "/project") => disk.get(fileKey({ path, workdir })),
    async open(path, workdir = "/project") { props.openRequest = { ...props.openRequest, id: props.openRequest.id + 1, path, workdir }; render(); await flush(); },
    dialog: () => find(element => element.type === "AdaptiveDialog" && element.props.title?.startsWith("workspaceEditor.close")),
    finishAnimation() { for (const [id, timer] of [...timers]) if (timer.delay === 180) { timers.delete(id); timer.callback(); } render(); },
    replayEffects: hooks.replayEffects,
    unmount() { hooks.unmount(); if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
      if (previousEnvironment === undefined) delete globalThis.MonacoEnvironment; else globalThis.MonacoEnvironment = previousEnvironment; } };
}

test("discard-close retires an outstanding read so its late result cannot reopen the editor", async () => {
  const pending = Promise.withResolvers(), h = await harness({ defer: true, read: () => pending.promise });
  try {
    h.props.closeRequestId++; h.render();
    assert.ok(h.dialog());
    h.control("workspaceEditor.discard", "Button").props.onClick(); h.finishAnimation();
    assert.equal(h.closed, 1);
    pending.resolve(h.getFile()); await h.flush();
    assert.equal(h.model, null); assert.equal(h.dialog(), undefined);
    assert.equal(h.closed, 1);
  } finally { pending.resolve({}); h.unmount(); }
});

test("tabbed editor saves immediate input once and rebases later edits returning to old disk content", async () => {
  const h = await harness(), pending = Promise.withResolvers();
  try {
    h.options.write = async args => { await pending.promise; return h.write(args); };
    const save = h.control("workspaceEditor.save");
    h.input("Sent 😀"); save.props.onClick(); save.props.onClick();
    h.input("Original"); await h.flush();
    assert.equal(h.calls.filter(([command]) => command === "fs_write_text").length, 1);
    pending.resolve(); await h.waitFor(() => !h.control("workspaceEditor.save").props.isLoading);
    assert.equal(h.getFile().content, "Sent 😀"); assert.equal(h.text(), "Original");
    assert.equal(h.control("workspaceEditor.save").props.isDisabled, false);
    h.options.write = undefined; h.control("workspaceEditor.save").props.onClick();
    await h.waitFor(() => h.control("workspaceEditor.save").props.isDisabled);
    assert.equal(h.getFile().content, "Original"); assert.equal(h.calls.at(-1)[1].expected_content_hash, "written:11");
  } finally { pending.resolve(); h.unmount(); }
});

test("save-before-close waits for an existing write and keeps input made after that submission", async () => {
  const h = await harness(), pending = Promise.withResolvers();
  try {
    h.options.write = async args => { await pending.promise; return h.write(args); };
    h.input("Submitted"); h.control("workspaceEditor.save").props.onClick();
    h.control("workspaceEditor.closeTab").props.onClick(); h.render();
    const saveDialog = h.control("workspaceEditor.save", "Button");
    saveDialog.props.onClick(); saveDialog.props.onClick(); h.input("Later input");
    pending.resolve(); await h.waitFor(() => !h.control("workspaceEditor.save", "Button").props.isLoading);
    assert.ok(h.dialog()); assert.equal(h.model.disposed, false); assert.equal(h.text(), "Later input");
    assert.equal(h.calls.filter(([command]) => command === "fs_write_text").length, 1);
    h.options.write = undefined; h.control("workspaceEditor.save", "Button").props.onClick();
    await h.waitFor(() => !h.dialog()); assert.equal(h.model, null); assert.equal(h.getFile().content, "Later input");
  } finally { pending.resolve(); h.unmount(); }
});

test("cancelling a save-close dialog retires its close continuation without cancelling the actual write", async () => {
  const h = await harness(), pending = Promise.withResolvers();
  try {
    h.options.write = async args => { await pending.promise; return h.write(args); };
    h.input("Saved"); h.control("workspaceEditor.closeTab").props.onClick(); h.render();
    h.control("workspaceEditor.save", "Button").props.onClick();
    h.control("workspaceEditor.cancel", "Button").props.onClick(); pending.resolve();
    await h.waitFor(() => !h.control("workspaceEditor.save").props.isLoading);
    assert.equal(h.text(), "Saved"); assert.equal(h.getFile().content, "Saved"); assert.equal(h.closed, 0);
    assert.equal(h.dialog(), undefined);
  } finally { pending.resolve(); h.unmount(); }
});

test("reload cannot replace input typed while reading or report an error for a disposed tab", async () => {
  const h = await harness(), read = Promise.withResolvers();
  try {
    h.options.read = () => read.promise;
    h.control("workspaceEditor.reload").props.onClick(); await h.flush(); h.input("Typed during reload");
    read.resolve({ ...h.getFile(), content: "External version", contentHash: "external" });
    await h.waitFor(() => !h.control("workspaceEditor.reload").props.isLoading);
    assert.equal(h.text(), "Typed during reload"); assert.equal(h.control("workspaceEditor.save").props.isDisabled, false);
    h.options.read = undefined; h.control("workspaceEditor.save").props.onClick();
    await h.waitFor(() => h.control("workspaceEditor.save").props.isDisabled);
    assert.equal(h.calls.at(-1)[1].expected_content_hash, "initial:/project:a.py");
    const late = Promise.withResolvers(); h.options.read = () => late.promise;
    h.control("workspaceEditor.reload").props.onClick(); await h.flush();
    const retiredSave = h.control("workspaceEditor.save"), retiredModel = h.model;
    h.control("workspaceEditor.closeTab").props.onClick(); h.render();
    late.reject(new Error("Retired reload failure")); await h.flush();
    h.options.read = undefined; await h.open("a.py");
    await h.waitFor(() => h.model && h.model !== retiredModel);
    h.input("Reopened"); const count = h.calls.length; retiredSave.props.onClick(); await h.flush();
    assert.equal(h.calls.length, count); assert.equal(h.text(), "Reopened");
    assert.equal(h.find(element => element.type === "Banner" && element.props.description === "Retired reload failure"), undefined);
  } finally { read.resolve({}); h.unmount(); }
});

test("same-named files in separate working directories have separate tabs and guarded writes", async () => {
  const h = await harness();
  try {
    h.input("First draft"); await h.open("a.py", "/other");
    await h.waitFor(() => h.text() === "Other workspace"); h.input("Second draft");
    h.control("workspaceEditor.save").props.onClick(); await h.waitFor(() => h.control("workspaceEditor.save").props.isDisabled);
    assert.equal(h.getFile("a.py", "/other").content, "Second draft"); assert.equal(h.getFile().content, "Original");
    await h.open("a.py"); assert.equal(h.text(), "First draft");
    assert.equal(h.calls.filter(([command]) => command === "fs_read_editable_text").length, 2);
  } finally { h.unmount(); }
});

test("run reserves its save and launch before rendering and refuses to execute later unsaved input", async () => {
  const h = await harness(), pending = Promise.withResolvers();
  try {
    h.options.write = async args => { await pending.promise; return h.write(args); };
    h.input("print('Sent')"); const run = h.control("workspaceEditor.run", "Button");
    run.props.onClick(); run.props.onClick(); h.input("print('Later')"); pending.resolve();
    await h.waitFor(() => !h.control("workspaceEditor.run", "Button").props.isDisabled);
    assert.equal(h.calls.filter(([command]) => command === "fs_write_text").length, 1);
    assert.equal(h.calls.filter(([command]) => command === "shell_run").length, 0);
    h.options.write = undefined; h.control("workspaceEditor.run", "Button").props.onClick();
    await h.waitFor(() => h.calls.some(([command]) => command === "shell_run"));
    assert.equal(h.getFile().content, "print('Later')");
    assert.equal(h.calls.find(([command]) => command === "shell_run")[1].command, 'python -- "a.py"');
  } finally { pending.resolve(); h.unmount(); }
});

test("retired shared run result controls cannot dismiss or stop a later run", async () => {
  const first = Promise.withResolvers(), second = Promise.withResolvers(); let runs = 0;
  const h = await harness({ invoke: command => command === "shell_run" ? (++runs === 1 ? first.promise : second.promise) : true });
  try {
    h.control("workspaceEditor.run", "Button").props.onClick(); await h.waitFor(() => !!h.control("workspaceEditor.stopRun", "Button"));
    const oldStop = h.control("workspaceEditor.stopRun", "Button"), oldDialog = h.find(node => node.type === "AdaptiveDialog" && node.props.title?.startsWith("workspaceEditor.runOutput"));
    first.resolve({ stdout: "First", stderr: "", exitCode: 0 }); await h.waitFor(() => !!h.control("workspaceEditor.closeRunOutput", "Button"));
    const oldClose = h.control("workspaceEditor.closeRunOutput", "Button"); oldClose.props.onClick(); h.render();
    h.control("workspaceEditor.run", "Button").props.onClick(); await h.waitFor(() => !!h.control("workspaceEditor.stopRun", "Button"));
    oldStop.props.onClick(); oldClose.props.onClick(); oldDialog.props.onOpenChange(false); await h.flush();
    assert.equal(h.calls.filter(([command]) => command === "shell_cancel").length, 0);
    assert.ok(h.control("workspaceEditor.stopRun", "Button"));
    h.control("workspaceEditor.stopRun", "Button").props.onClick(); await h.flush();
    assert.equal(h.calls.filter(([command]) => command === "shell_cancel").length, 1);
  } finally { first.resolve({ stdout: "", stderr: "", exitCode: 0 }); second.resolve({ stdout: "", stderr: "", exitCode: 0 }); h.unmount(); }
});

test("shared cancellation is reserved until its acknowledgement and reports stopped output", async () => {
  const response = Promise.withResolvers(), cancel = Promise.withResolvers();
  const h = await harness({ invoke: command => command === "shell_run" ? response.promise : cancel.promise });
  try {
    h.control("workspaceEditor.run", "Button").props.onClick();
    await h.waitFor(() => !!h.control("workspaceEditor.stopRun", "Button"));
    const stop = h.control("workspaceEditor.stopRun", "Button"); stop.props.onClick(); stop.props.onClick(); await h.flush();
    assert.equal(h.calls.filter(([command]) => command === "shell_cancel").length, 1);
    assert.equal(h.control("workspaceEditor.stopRun", "Button").props.isDisabled, true);
    cancel.resolve(false); await h.waitFor(() => !h.control("workspaceEditor.stopRun", "Button").props.isDisabled);
    response.resolve({ stdout: "Partial", stderr: "", exitCode: 0, cancelled: true });
    await h.waitFor(() => !!h.find(node => node.type === "Banner" && node.props.title === "workspaceEditor.runCancelled"));
    assert.equal(h.find(node => node.type === "Banner" && node.props.title === "workspaceEditor.runCancelled").props.status, "warning");
  } finally { response.resolve({ stdout: "", stderr: "", exitCode: 0 }); cancel.resolve(false); h.unmount(); }
});

test("shared cancellation failure remains retryable and timeout or missing exit code cannot announce success", async () => {
  for (const response of [{ stdout: "Partial", stderr: "", exit_code: 0, timed_out: true }, { stdout: "Unknown", stderr: "" }]) {
    const pending = Promise.withResolvers(); let stops = 0;
    const h = await harness({ invoke: command => {
      if (command === "shell_run") return pending.promise;
      if (++stops === 1) throw new Error("Cannot cancel"); return false;
    } });
    try {
      h.control("workspaceEditor.run", "Button").props.onClick(); await h.waitFor(() => !!h.control("workspaceEditor.stopRun", "Button"));
      h.control("workspaceEditor.stopRun", "Button").props.onClick();
      await h.waitFor(() => !!h.find(node => node.type === "Banner" && node.props.description === "Cannot cancel"));
      h.control("workspaceEditor.stopRun", "Button").props.onClick(); await h.flush(); assert.equal(stops, 2);
      pending.resolve(response);
      const label = response.timed_out ? "workspaceEditor.runTimedOut" : "workspaceEditor.runFailed";
      await h.waitFor(() => !!h.find(node => node.type === "Banner" && node.props.title === label));
      assert.equal(h.find(node => node.type === "Banner" && node.props.title === label).props.status, "error");
    } finally { pending.resolve({ stdout: "", stderr: "", exitCode: 0 }); h.unmount(); }
  }
});

test("StrictMode run retirement clears pending UI ownership without accepting the old process result", async () => {
  const pending = Promise.withResolvers(); const h = await harness({ invoke: () => pending.promise });
  try {
    h.control("workspaceEditor.run", "Button").props.onClick(); await h.waitFor(() => !!h.control("workspaceEditor.stopRun", "Button"));
    h.replayEffects(); await h.flush();
    assert.equal(h.control("workspaceEditor.stopRun", "Button"), undefined);
    pending.resolve({ stdout: "Old process output", stderr: "", exitCode: 0 }); await h.flush();
    assert.equal(h.find(node => node.type === "CodeBlock" && node.props.code === "Old process output"), undefined);
    assert.equal(h.control("workspaceEditor.run", "Button").props.isDisabled, false);
  } finally { pending.resolve({ stdout: "", stderr: "", exitCode: 0 }); h.unmount(); }
});

test("close animation rechecks immediate new input and conflicts require explicit discard before reload", async () => {
  const h = await harness();
  try {
    h.props.closeRequestId++; h.render(); h.input("During close animation"); h.finishAnimation();
    assert.equal(h.closed, 0); assert.ok(h.dialog());
    h.control("workspaceEditor.cancel", "Button").props.onClick();
    h.options.write = () => { throw { code: "stale_file" }; };
    h.control("workspaceEditor.save").props.onClick(); await h.waitFor(() => !!h.control("workspaceEditor.reloadFromDisk", "Button"));
    const before = h.calls.filter(([command]) => command.startsWith("fs_read")).length;
    h.control("workspaceEditor.reloadFromDisk", "Button").props.onClick(); h.render();
    assert.equal(h.calls.filter(([command]) => command.startsWith("fs_read")).length, before);
    assert.ok(h.find(element => element.type === "AdaptiveDialog" && element.props.title === "workspaceEditor.reloadDirtyTitle"));
    h.control("workspaceEditor.discard", "Button").props.onClick(); await h.waitFor(() => h.text() === "Original");
  } finally { h.unmount(); }
});

test("reopening a discarded tab waits for its requested write and never revives its old edit callback", async () => {
  const h = await harness(), pending = Promise.withResolvers();
  try {
    h.options.write = async args => { await pending.promise; return h.write(args); };
    const oldModel = h.model;
    h.input("Requested write"); h.control("workspaceEditor.save").props.onClick(); h.input("Discard this later input");
    h.control("workspaceEditor.closeTab").props.onClick(); h.render();
    h.control("workspaceEditor.discard", "Button").props.onClick(); h.render();
    await h.open("a.py"); assert.equal(h.model, null);
    assert.equal(h.calls.filter(([command]) => command === "fs_read_editable_text").length, 1);
    pending.resolve(); await h.waitFor(() => h.model !== null);
    assert.equal(h.text(), "Requested write"); oldModel.setValue("Retired queued edit"); h.render();
    assert.equal(h.text(), "Requested write"); assert.equal(h.control("workspaceEditor.save").props.isDisabled, true);
  } finally { pending.resolve(); h.unmount(); }
});

test("out-of-order file reads do not steal the most recently requested tab", async () => {
  const h = await harness(), second = Promise.withResolvers(), third = Promise.withResolvers();
  try {
    h.put("c.py", "Third");
    h.options.read = args => args.path === "b.py" ? second.promise : third.promise;
    await h.open("b.py"); await h.open("c.py");
    third.resolve(h.getFile("c.py")); await h.waitFor(() => h.text() === "Third");
    second.resolve(h.getFile("b.py")); await h.flush(); assert.equal(h.text(), "Third");
    await h.open("b.py"); assert.equal(h.text(), "Second");
    assert.equal(h.calls.filter(([command]) => command.startsWith("fs_read")).length, 3);
  } finally { second.resolve({}); third.resolve({}); h.unmount(); }
});

test("save-all does not close edits made to an earlier tab while a later tab is saving", async () => {
  const h = await harness(), pending = Promise.withResolvers();
  try {
    h.input("First save"); await h.open("b.py"); h.input("Second save"); await h.open("a.py");
    h.options.write = async args => { if (args.path === "b.py") await pending.promise; return h.write(args); };
    h.props.closeRequestId++; h.render(); h.control("workspaceEditor.saveAll", "Button").props.onClick();
    await h.waitFor(() => h.calls.some(([command, args]) => command === "fs_write_text" && args.path === "b.py"));
    h.input("Later first input"); pending.resolve();
    await h.waitFor(() => !h.control("workspaceEditor.saveAll", "Button").props.isLoading);
    h.finishAnimation(); assert.equal(h.closed, 0); assert.ok(h.dialog()); assert.equal(h.text(), "Later first input");
    h.options.write = undefined; h.control("workspaceEditor.saveAll", "Button").props.onClick();
    await h.waitFor(() => !h.dialog()); h.finishAnimation();
    assert.equal(h.closed, 1); assert.equal(h.getFile().content, "Later first input");
    assert.equal(h.getFile("b.py").content, "Second save");
  } finally { pending.resolve(); h.unmount(); }
});

test("old dialog controls cannot save or dismiss a replacement confirmation", async () => {
  const h = await harness();
  try {
    h.input("First draft"); h.control("workspaceEditor.closeTab").props.onClick(); h.render();
    const oldSave = h.control("workspaceEditor.save", "Button"), oldDiscard = h.control("workspaceEditor.discard", "Button");
    h.control("workspaceEditor.cancel", "Button").props.onClick(); await h.open("b.py");
    h.input("Second draft"); h.control("workspaceEditor.closeTab").props.onClick(); h.render();
    oldSave.props.onClick(); oldDiscard.props.onClick(); await h.flush();
    assert.ok(h.dialog()); assert.equal(h.text(), "Second draft");
    assert.equal(h.calls.filter(([command]) => command === "fs_write_text").length, 0);
  } finally { h.unmount(); }
});

test("StrictMode effect replay retries retired initial loading and ignores its late failure", async () => {
  const first = Promise.withResolvers(), second = Promise.withResolvers(); let reads = 0;
  const h = await harness({ defer: true, read: () => ++reads === 1 ? first.promise : second.promise });
  try {
    await h.flush(); assert.equal(reads, 1);
    h.replayEffects(); await h.flush(); assert.equal(reads, 2);
    first.reject(new Error("Retired initial load")); second.resolve({ ...h.getFile(), content: "Current replay" });
    await h.waitFor(() => h.text() === "Current replay");
    assert.equal(h.find(element => element.type === "Banner" && element.props.description === "Retired initial load"), undefined);
  } finally { first.resolve({}); second.resolve({}); h.unmount(); }
});

test("shared native location normalization rejects malformed lines and preserves UTF16 column requests", () => {
  const { workspaceCodeLocation } = createTsModuleLoader().loadModule("src/components/workspace-editor/workspaceCodeLocation.ts");
  assert.deepEqual(workspaceCodeLocation({ id: 2, line: 100, column: 5, endLine: 101 }), { request: "2", line: 100, endLine: 101, column: 5 });
  for (const line of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) assert.equal(workspaceCodeLocation({ id: 1, line }), null);
  assert.deepEqual(workspaceCodeLocation({ id: 1, line: 1, column: -1, endLine: Infinity }), { request: "1", line: 1 });
});
