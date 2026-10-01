import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const session = (id, extra = {}) => ({ id, kind: "local", projectPathKey: "/project", cwd: "/project",
  title: id, shell: "/bin/sh", running: true, cols: 80, rows: 24, createdAt: 1, updatedAt: 1, ...extra });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(options = {}) {
  const hooks = createReactHookHarness(), calls = [], attached = [], listeners = new Set();
  const confirm = options.confirm ?? (async () => true), cancel = () => {};
  let closes = 0;
  const props = { open: true, workdir: "/project", projectPathKey: "/project",
    settings: { theme: "dark", ssh: { hosts: [] } }, onClose() { closes++; }, ...options.props };
  const client = {
    async list(key) { calls.push(["list", key]); return options.list ? options.list(key) : [session("one")]; },
    async shellOptions() { return { defaultShell: "/bin/sh", options: [
      { id: "sh", label: "sh", command: "/bin/sh" }, { id: "duplicate", label: "sh", command: "/bin/sh" },
      { id: "zsh", label: "zsh", command: "/bin/zsh" },
    ] }; },
    async create(params) { calls.push(["create", params]); return options.create ? options.create(params) : { session: session("new", { shell: params.shell }) }; },
    async rename(id, title, key) { calls.push(["rename", id, title, key]); return session(id, { title }); },
    async close(id, key) { calls.push(["close", id, key]); return session(id, { running: false }); },
    async createSsh(params) { calls.push(["createSsh", params]); return options.createSsh?.(params); },
    async answerSshPrompt(params) { calls.push(["answer", params]); return options.answerSshPrompt?.(params); },
    async cancelSshPrompt(id) { calls.push(["cancelPrompt", id]); },
    async sshReconnect(id, key) { calls.push(["reconnect", id, key]); return session(id, { kind: "ssh", running: true, ssh: { status: "connected" } }); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    stream: { async attach(target) {
      const handle = { id: target.id, disposed: false, writes: [],
        snapshot: { session: target, bytes: new TextEncoder().encode(target.title), outputStartOffset: 0, outputEndOffset: target.title.length },
        write(bytes) { handle.writes.push(Array.from(bytes)); return true; }, resize() {},
        dispose() { handle.disposed = true; }, subscribeOutput() { return () => {}; },
        subscribeInputState(listener) { listener({ paused: false }); return () => {}; },
      }; attached.push(handle); return handle;
    } },
  };
  props.client = client;
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react, "../i18n": { useLocale: () => ({ t: key => key }) },
    "../components/astryx/useConfirmDialog": { useConfirmDialog: () => ({ confirm, cancel, dialog: null }) },
    "./NativeSurface": { NativeSurface: "NativeSurface" },
    "./nativeTheme": { createNativePresentationTheme: () => undefined },
  } });
  const { NativeDesktopTerminalPanel } = loader.loadModule("src/presentation/NativeDesktopTerminalPanel.tsx");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const render = () => {
    const root = hooks.render(() => NativeDesktopTerminalPanel(props));
    const surface = root?.props.children[0]?.props;
    if (surface) validatePresentationDocument({ ...surface.document, version: 1, surface: "terminal", revision: 1 }, surface.handlers);
    return surface;
  };
  const action = (id, value = null) => {
    const handler = render().handlers.get(id);
    assert.ok(handler?.enabled, `${id} must be enabled`);
    assert.ok(handler.accepts(value), `${id} must accept its value`);
    const pending = handler.run(value); render(); return pending;
  };
  const dispatch = async (id, value = null) => { await action(id, value); await settle(); return render(); };
  const node = id => {
    function find(nodes) { for (const item of nodes) { if (item.id === id) return item; const child = find(item.children ?? []); if (child) return child; } }
    return find(render().document.nodes);
  };
  return { props, calls, attached, render, action, dispatch, node, emit(event) { for (const listener of listeners) listener(event); },
    unmount: () => hooks.unmount(), get closes() { return closes; } };
}

test("native terminal loads only this project's local sessions and keeps shell choices unique", async () => {
  const h = harness({ list: () => [session("one"), session("two"), session("ssh", { kind: "ssh" }), session("other", { projectPathKey: "/other" })] });
  h.render(); await settle(); h.render(); await settle();
  assert.deepEqual(h.node("terminal-session").options.map(item => item.value), ["one", "two"]);
  assert.equal(h.node("terminal-session").value, "two");
  assert.deepEqual(h.node("terminal-shell").options.map(item => item.value), ["/bin/sh", "/bin/zsh"]);
  await h.dispatch("terminal-shell", "/bin/zsh");
  await h.dispatch("terminal-new"); await settle();
  assert.equal(h.calls.find(([type]) => type === "create")[1].shell, "/bin/zsh");
  assert.equal(h.node("terminal-session").value, "new");
  await h.dispatch("terminal-rename");
  await h.dispatch("terminal-name", "  task shell  ");
  await h.dispatch("terminal-name-save");
  assert.deepEqual(h.calls.find(([type]) => type === "rename"), ["rename", "new", "task shell", "/project"]);
  assert.equal(h.node("terminal-session").options.find(item => item.value === "new").label, "task shell");
  h.unmount();
});

test("native terminal confirms running closes, consumes metadata-free closed events, and retires raw input on hide", async () => {
  let allow = false;
  const h = harness({ confirm: async () => allow, list: () => [session("one"), session("two")] });
  h.render(); await settle(); h.render(); await settle();
  await h.dispatch("terminal-end");
  assert.equal(h.calls.some(([type]) => type === "close"), false);
  allow = true; await h.dispatch("terminal-end");
  assert.deepEqual(h.calls.find(([type]) => type === "close"), ["close", "two", "/project"]);
  h.emit({ kind: "closed", sessionId: "one", projectPathKey: "/project" });
  assert.ok(h.node("terminal-empty"));
  h.emit({ kind: "created", session: session("third"), projectPathKey: "/project" });
  h.render(); await settle();
  const old = h.render().handlers.get("terminal-events:third");
  const value = JSON.stringify({ sessionId: "third", type: "input", bytes: "DQ==" });
  old.run(value);
  const handle = h.attached.at(-1);
  await h.dispatch("close");
  assert.equal(h.closes, 1);
  assert.equal(handle.disposed, true);
  assert.throws(() => old.run(value), /no longer/);
  assert.deepEqual(handle.writes, [[13]]);
  h.unmount();
});

test("native terminal retries list failures and ignores obsolete create completions after workspace changes", async () => {
  let broken = true;
  const pending = deferred();
  const h = harness({ list: key => { if (broken) throw new Error("list unavailable"); return [session(key, { projectPathKey: key })]; }, create: () => pending.promise });
  h.render(); await settle();
  assert.ok(JSON.stringify(h.render().document).includes("list unavailable"));
  broken = false; await h.dispatch("terminal-reconnect");
  const creating = h.action("terminal-new");
  h.props.projectPathKey = "/other"; h.props.workdir = "/other";
  h.render(); await settle();
  pending.resolve({ session: session("obsolete") }); await creating; await settle();
  assert.deepEqual(h.node("terminal-session").options.map(item => item.value), ["/other"]);
  h.unmount();
});

test("native SSH handles host trust and authentication, preserves project associations and reconnects ended sessions", async () => {
  const host = { id: "host", name: "Server", host: "example.test", port: 22, username: "user" };
  const h = harness({ props: { kind: "ssh", settings: { theme: "dark", ssh: { hosts: [host] } }, associatedHostIds: [],
    onAssociatedHostIdsChange(ids) { h.props.associatedHostIds = ids; } },
    list: () => [session("ended", { kind: "ssh", running: false, ssh: { status: "disconnected" } })],
    createSsh: () => ({ prompt: { id: "trust", kind: "hostKey", hostId: "host", message: "Trust host?", fingerprintSha256: "SHA256:real" } }),
    answerSshPrompt: answer => answer.promptId === "trust" ? { prompt: { id: "auth", kind: "auth", message: "Password", answerEcho: false } }
      : { snapshot: { session: session("connected", { kind: "ssh", ssh: { status: "connected" } }) } },
  });
  h.render(); await settle(); h.render(); await settle();
  await h.dispatch("terminal-associate-host", true);
  assert.deepEqual(h.props.associatedHostIds, ["host"]);
  await h.dispatch("terminal-ssh-reconnect");
  assert.ok(h.calls.some(([type]) => type === "reconnect"));
  const connecting = h.action("terminal-new"); await settle();
  assert.equal(h.node("terminal-auth-fingerprint").text, "projectTools.sshConnectionFingerprint: SHA256:real");
  await h.dispatch("terminal-auth-submit");
  assert.equal(h.node("terminal-auth-answer").secure, true);
  await h.dispatch("terminal-auth-answer", "secret");
  await h.dispatch("terminal-auth-submit"); await connecting; await settle();
  assert.ok(h.calls.some(([type, args]) => type === "answer" && args.trustHostKey === true));
  assert.ok(h.calls.some(([type, args]) => type === "answer" && args.answer === "secret"));
  assert.equal(h.node("terminal-session").value, "connected");
  assert.equal(JSON.stringify(h.render().document).includes("secret"), false);
  h.unmount();
});
