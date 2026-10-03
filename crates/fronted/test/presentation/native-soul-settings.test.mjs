import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const nodes = values => values.flatMap(node => [node, ...nodes(node.children ?? [])]);
function fixture(options = {}) {
  const hooks = createReactHookHarness();
  const model = createTsModuleLoader().loadModule("src/lib/soul/model.ts");
  const first = { id: "first", metadata: { ...model.DEFAULT_SOUL_METADATA }, body: "Initial personality" };
  const second = { id: "second", metadata: { ...model.DEFAULT_SOUL_METADATA, name: "Second" }, body: "Other personality" };
  const calls = [];
  const soul = {
    document: first, activeId: first.id, presets: [first, second], loading: false, saving: false, error: null,
    async save(draft) { calls.push(["save", draft]); await options.save?.(draft); soul.document = { ...draft, id: soul.activeId }; return soul.document; },
    async create(draft) { calls.push(["create", draft]); soul.document = { ...draft, id: "created" }; soul.presets.push(soul.document); soul.activeId = "created"; return soul.document; },
    async select(id) { calls.push(["select", id]); soul.activeId = id; soul.document = soul.presets.find(preset => preset.id === id); },
    async remove(id) { calls.push(["remove", id]); soul.presets = soul.presets.filter(preset => preset.id !== id); soul.document = soul.presets[0]; soul.activeId = soul.document.id; },
    async reload() { calls.push(["reload"]); },
  };
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => options.mobile !== false },
    "../../lib/soul": { ...model, useSoul: () => soul },
    "../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../presentation/nativeTheme": { createNativePresentationTheme: () => ({}) },
    "../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
  } });
  const { SoulSection } = loader.loadModule("src/pages/settings/SoulSection.tsx");
  let rendered;
  const render = () => {
    rendered = hooks.render(() => SoulSection({ settings: { theme: "system" }, onBack() {}, nativeSettingsSurfaceId: "soul-session" }));
    return rendered.props.children[0].props;
  };
  render();
  return { hooks, soul, calls, render, run: (id, value = null) => rendered.props.children[0].props.handlers.get(id).run(value),
    get alert() { return rendered.props.children[1]?.props; }, all: () => nodes(rendered.props.children[0].props.document.nodes) };
}

test("native Soul includes all identity and personality details, drafts, presets and explicit deletion confirmation", async () => {
  const f = fixture();
  try {
    assert.equal(f.render().sessionSurface, "soul-session");
    assert.equal(f.all().find(node => node.id === "soul-body").minHeight, 240);
    assert.equal(f.all().find(node => node.id === "soul-body").fill, undefined);
    for (const id of ["soul-name-hint", "soul-style-hint", "soul-body-hint"]) assert.ok(f.all().find(node => node.id === id)?.text);
    assert.equal(f.all().find(node => node.id === "soul-language").text, "settings.soulLanguageHint");
    await f.run("soul-name", `${"a".repeat(63)}🙂overflow`); f.render();
    assert.equal(f.all().find(node => node.id === "soul-name").value, `${"a".repeat(63)}🙂`);
    await f.run("soul-create"); f.render();
    assert.equal(f.all().find(node => node.id === "soul-save").disabled, true);
    assert.ok(f.all().some(node => node.id === "soul-validation"));
    await f.run("soul-name", "Native persona"); await f.run("soul-language", "ja-JP");
    await f.run("soul-style", "Direct and brief"); await f.run("soul-body", "Use the project conventions."); f.render();
    await f.run("soul-save"); f.render();
    assert.equal(f.calls.find(([action]) => action === "create")[1].metadata.lang, "ja-JP");
    assert.equal(f.soul.document.body, "Use the project conventions.");
    await f.run("soul-delete"); f.render();
    assert.equal(f.alert.document.mode, "alert");
    assert.ok(!f.calls.some(([action]) => action === "remove"));
    await f.alert.handlers.get("cancel-delete").run(null); f.render();
    assert.equal(f.alert, undefined);
    await f.run("soul-delete"); f.render();
    await f.alert.handlers.get("confirm-delete").run(null); f.render();
    assert.deepEqual(f.calls.find(([action]) => action === "remove"), ["remove", "created"]);
    await f.run("soul-preset", "second"); f.render();
    assert.equal(f.all().find(node => node.id === "soul-body").value, "Other personality");
    await f.run("soul-reload");
    assert.ok(f.calls.some(([action]) => action === "reload"));
  } finally { f.hooks.unmount(); }
});

test("Soul save consumes the final acknowledged character and rejects the latest invalid draft without another render", async () => {
  const f = fixture();
  try {
    await f.run("soul-body", "An edited draft"); f.render();
    const handlers = f.render().handlers;
    handlers.get("soul-body").run("An edited draft末尾🙂");
    handlers.get("soul-style").run("Latest style");
    await handlers.get("soul-save").run(null);
    assert.equal(f.calls[0][1].body, "An edited draft末尾🙂");
    assert.equal(f.calls[0][1].metadata.style, "Latest style");
    f.render();
    await f.run("soul-body", "Valid edit"); f.render();
    const current = f.render().handlers;
    current.get("soul-body").run("字".repeat(1601));
    await current.get("soul-save").run(null);
    f.render();
    assert.equal(f.calls.filter(([action]) => action === "save").length, 1);
    assert.ok(f.all().some(node => node.id === "soul-validation"));
  } finally { f.hooks.unmount(); }
});

test("pending Soul save locks native editing, prevents duplicate writes and retains failed drafts for retry", async () => {
  let release;
  let fail = true;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ mobile: false, save: async () => { await pending; if (fail) throw new Error("storage unavailable"); } });
  try {
    await f.run("soul-body", "Keep after failure"); f.render();
    const save = f.render().handlers.get("soul-save");
    const first = save.run(null);
    await save.run(null);
    f.render();
    assert.equal(f.calls.length, 1);
    assert.equal(f.all().find(node => node.id === "soul-body").disabled, true);
    assert.equal(f.all().find(node => node.id === "soul-preset").disabled, true);
    assert.equal(f.render().document.dismissAction, undefined);
    release(); await first; f.render();
    assert.equal(f.all().find(node => node.id === "soul-error").label, "storage unavailable");
    assert.equal(f.all().find(node => node.id === "soul-body").value, "Keep after failure");
    assert.equal(f.all().find(node => node.id === "soul-save").disabled, false);
    fail = false; await f.run("soul-save"); f.render();
    assert.ok(f.all().some(node => node.id === "soul-saved"));
  } finally { f.hooks.unmount(); }
});
