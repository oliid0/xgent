import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function entry(slug, extra = {}) { return { slug, scope: "global", workdirHash: "", memoryType: "user", description: slug, updatedAt: 1000, createdAt: 500, unreviewed: true, ...extra }; }

function harness(options = {}) {
  const hooks = createReactHookHarness();
  const calls = [];
  const records = new Map((options.entries ?? [entry("one"), entry("project", { scope: "project", workdirHash: "hash", workdirPath: "/other-project" }), entry("daily", { memoryType: "daily" })]).map(e => [e.slug, { ...e, body: `body ${e.slug}` }]));
  const api = {
    formatMemoryError: e => e.message ?? String(e),
    memoryList: async args => { calls.push(["list", args]); return options.list ? options.list(args) : { entries: [...records.values()], quota: { used: records.size, limit: 100 } }; },
    memoryPathsInfo: async () => ({ root: "/memory", isInCloud: true, cloudProvider: "cloud" }),
    memoryRead: async args => { calls.push(["read", args]); if (options.read) return options.read(args); const e = records.get(args.slug); return { ...e, meta: { updatedAt: e.updatedAt, unreviewed: e.unreviewed }, totalLines: 1, window: { truncated: false } }; },
    memoryWrite: async args => { calls.push(["write", args]); if (options.write) await options.write(args); records.set(args.slug, { ...entry(args.slug), ...args }); return { slug: args.slug }; },
    memoryUpdate: async args => { calls.push(["update", args]); const e = records.get(args.slug); records.set(args.slug, { ...e, ...args, body: args.mode === "append" ? `${e.body}\n${args.body}` : args.body }); return { slug: args.slug }; },
    memoryAccept: async args => { calls.push(["accept", args]); records.get(args.slug).unreviewed = false; },
    memoryDelete: async args => { calls.push(["delete", args]); await options.delete?.(args); records.delete(args.slug); },
    memoryWipeAll: async () => { calls.push(["wipe"]); await options.wipe?.(); records.clear(); return { root: "/memory" }; },
  };
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react, "../../../lib/memory/api": api,
    "../../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => options.mobile !== false },
  } });
  const { useMemoryPanelData } = loader.loadModule("src/pages/settings/memory/useMemoryPanelData.ts");
  const { NativeMemoryPanel } = loader.loadModule("src/pages/settings/memory/NativeMemoryPanel.tsx");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  let workdir = "/current", data, backs = 0, settingsOpens = 0;
  const render = () => {
    const surface = hooks.render(() => {
      data = useMemoryPanelData({ workdir, t: key => key });
      return NativeMemoryPanel({ data, settings: { theme: "dark" }, workdir, t: key => key,
        onBack: () => backs++, onSettings: () => settingsOpens++, nativeSettingsSurfaceId: "settings-memory" });
    }).props;
    validatePresentationDocument({ ...surface.document, version: 1, surface: "settings-memory", revision: 1 }, surface.handlers);
    return surface;
  };
  const dispatch = async (action, value = null) => {
    const handler = render().handlers.get(action); assert.ok(handler, action);
    assert.ok(handler.enabled, `${action} is enabled`); assert.ok(handler.accepts(value), `${action} accepts ${value}`);
    await handler.run(value); await tick(); return render();
  };
  return { render, dispatch, calls, records, unmount: () => hooks.unmount(),
    setWorkdir: value => { workdir = value; }, get data() { return data; },
    get backs() { return backs; }, get settingsOpens() { return settingsOpens; } };
}

test("native memory searches/categories and edits through the shared API, retaining project identity", async () => {
  const h = harness(); h.render(); await tick();
  let surface = h.render(); assert.equal(surface.document.formFactor, "mobile");
  assert.equal(surface.sessionSurface, "settings-memory");
  assert.ok(JSON.stringify(surface.document).includes("cloud"));
  await h.dispatch("memory-category", "project");
  await h.dispatch("memory-filter", "project");
  await h.dispatch("memory-open:project:hash:project");
  assert.deepEqual(h.calls.filter(([name]) => name === "read").at(-1)[1], { slug: "project", scope: "project", workdir: "/other-project", workdirHash: "hash" });
  await h.dispatch("memory-edit-description", "new description");
  await h.dispatch("memory-edit-body", "new body");
  await h.dispatch("memory-save");
  assert.equal(h.records.get("project").body, "new body");
  await h.dispatch("memory-accept"); assert.equal(h.records.get("project").unreviewed, false);
  assert.equal(h.render().handlers.has("memory-accept"), false);
  h.unmount();
});

test("native memory create, daily append and destructive confirmation perform actual shared mutations", async () => {
  const h = harness({ mobile: false }); h.render(); await tick();
  await h.dispatch("memory-create");
  await h.dispatch("memory-slug", "created"); await h.dispatch("memory-description", "description");
  await h.dispatch("memory-body", "persisted body"); await h.dispatch("memory-create-save");
  assert.equal(h.records.get("created").body, "persisted body");
  await h.dispatch("memory-delete"); assert.equal(h.records.has("created"), true);
  await h.dispatch("memory-confirm-cancel"); assert.equal(h.records.has("created"), true);
  await h.dispatch("memory-delete"); await h.dispatch("memory-confirm-action"); assert.equal(h.records.has("created"), false);
  await h.dispatch("memory-category", "journal"); await h.dispatch("memory-open:global::daily");
  assert.equal(h.render().handlers.has("memory-edit-body"), false);
  await h.dispatch("memory-append", "append only"); await h.dispatch("memory-save");
  const update = h.calls.filter(([name]) => name === "update").at(-1)[1];
  assert.equal(update.mode, "append"); assert.equal(update.description, undefined);
  assert.equal(h.records.get("daily").body, "body daily\nappend only");
  await h.dispatch("back"); await h.dispatch("memory-wipe");
  assert.equal(h.records.size, 3); await h.dispatch("memory-confirm-action"); assert.equal(h.records.size, 0);
  assert.equal(h.render().document.formFactor, "desktop"); h.unmount();
});

test("failed native memory creation preserves the draft and a successful retry resets it", async () => {
  let fail = true;
  const h = harness({ write: async () => { if (fail) throw new Error("disk full"); } }); h.render(); await tick();
  await h.dispatch("memory-create"); await h.dispatch("memory-slug", "retry"); await h.dispatch("memory-body", "keep this");
  await h.dispatch("memory-create-save");
  assert.equal(h.records.has("retry"), false);
  assert.ok(JSON.stringify(h.render().document).includes("disk full"));
  assert.ok(JSON.stringify(h.render().document).includes("keep this"));
  fail = false; await h.dispatch("memory-create-save"); assert.equal(h.records.get("retry").body, "keep this");
  await h.dispatch("back"); await h.dispatch("memory-settings"); assert.equal(h.settingsOpens, 1);
  h.unmount();
});

test("shared memory reads ignore older selections and workspace completions", async () => {
  const first = deferred(), second = deferred();
  const h = harness({ entries: [entry("first"), entry("second")], read: args => args.slug === "first" ? first.promise : second.promise });
  h.render(); await tick(); h.render();
  const old = h.data.openEntry(entry("first")); const next = h.data.openEntry(entry("second"));
  second.resolve({ ...entry("second"), body: "current", meta: {} }); await next;
  first.resolve({ ...entry("first"), body: "obsolete", meta: {} }); await old;
  assert.equal(h.render().handlers.has("memory-save"), false);
  assert.equal(h.data.selected.slug, "second");
  h.setWorkdir("/next"); h.render(); await tick();
  assert.equal(h.data.selected, null); h.unmount();
});

test("shared memory mutation lock prevents duplicate writes and retires completion after workspace change", async () => {
  const pending = deferred();
  const h = harness({ write: () => pending.promise }); h.render(); await tick(); h.render();
  const data = h.data;
  const draft = { slug: "once", scope: "global", memoryType: "user", description: "", body: "body" };
  const first = data.createEntry(draft); const second = data.createEntry(draft);
  await second; assert.equal(h.calls.filter(([name]) => name === "write").length, 1);
  h.setWorkdir("/next"); h.render(); await tick();
  pending.resolve(); assert.equal(await first, false);
  assert.equal(h.data.saving, false);
  assert.equal(h.data.notice, null); h.unmount();
});

test("a delayed entry read cannot reopen native memory after Back or New entry", async () => {
  for (const action of ["back", "memory-create"]) {
    const pending = deferred();
    const h = harness({ entries: [entry("delayed")], read: () => pending.promise });
    h.render(); await tick();
    const opening = h.render().handlers.get("memory-open:global::delayed").run(null);
    await h.dispatch(action);
    pending.resolve({ ...entry("delayed"), body: "loaded", meta: {} }); await opening;
    assert.equal(h.render().handlers.has("memory-save"), false);
    assert.equal(h.render().handlers.has("memory-create-save"), action === "memory-create");
    h.unmount();
  }
});

test("native memory create and edit preserve the final accepted text before a new document is published", async () => {
  const h = harness(); h.render(); await tick();
  try {
    await h.dispatch("memory-create");
    await h.dispatch("memory-slug", "last-character"); await h.dispatch("memory-body", "Draft");
    let handlers = h.render().handlers;
    handlers.get("memory-body").run("Draft末尾🙂");
    handlers.get("memory-description").run("Final description");
    await handlers.get("memory-create-save").run(null); await tick(); h.render();
    assert.equal(h.records.get("last-character").body, "Draft末尾🙂");
    assert.equal(h.records.get("last-character").description, "Final description");
    handlers = h.render().handlers;
    handlers.get("memory-edit-body").run("Edited末尾🙂");
    handlers.get("memory-edit-description").run("Updated description");
    await handlers.get("memory-save").run(null); await tick(); h.render();
    assert.equal(h.records.get("last-character").body, "Edited末尾🙂");
    assert.equal(h.records.get("last-character").description, "Updated description");
    await h.dispatch("back"); await h.dispatch("memory-category", "journal"); await h.dispatch("memory-open:global::daily");
    await h.dispatch("memory-append", "append");
    handlers = h.render().handlers;
    handlers.get("memory-append").run("append末尾🙂");
    await handlers.get("memory-save").run(null);
    assert.equal(h.records.get("daily").body, "body daily\nappend末尾🙂");
  } finally { h.unmount(); }
});

test("failed memory deletion and wipe retain the confirmation and records for an explicit retry", async () => {
  let fail = true;
  const failing = async () => { if (fail) throw new Error("memory store unavailable"); };
  const h = harness({ delete: failing, wipe: failing }); h.render(); await tick();
  try {
    await h.dispatch("memory-open:global::one"); await h.dispatch("memory-delete");
    await h.dispatch("memory-confirm-action");
    assert.equal(h.records.has("one"), true);
    assert.ok(h.render().handlers.has("memory-confirm-cancel"));
    assert.ok(JSON.stringify(h.render().document).includes("memory store unavailable"));
    fail = false; await h.dispatch("memory-confirm-action");
    assert.equal(h.records.has("one"), false);
    assert.ok(!h.render().handlers.has("memory-confirm-cancel"));
    await h.dispatch("memory-wipe"); fail = true;
    await h.dispatch("memory-confirm-action");
    assert.equal(h.records.size, 2);
    assert.ok(h.render().handlers.has("memory-confirm-cancel"));
    fail = false; await h.dispatch("memory-confirm-action");
    assert.equal(h.records.size, 0);
    assert.ok(!h.render().handlers.has("memory-confirm-cancel"));
  } finally { h.unmount(); }
});
