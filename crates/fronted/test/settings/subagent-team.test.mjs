import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function fixture() {
  const hooks = createReactHookHarness();
  const vendor = Object.fromEntries(["Button", "Selector", "Switch", "Text", "TextArea", "TextInput"].map(name => [`@astryxdesign/core/${name}`, { [name]: name }]));
  vendor["@astryxdesign/core/List"]={List:"List",ListItem:"ListItem"};
  const loader = createTsModuleLoader({ mocks: { react: hooks.react, "react-dom": { flushSync: fn => fn() }, ...vendor, "@astryxdesign/core/Layout": { VStack: "VStack" }, "../../i18n": { useLocale: () => ({ t: k => k }) } } });
  const settings = loader.loadModule("src/lib/settings/index.ts");
  const { useSubagentTeamEditor } = loader.loadModule("src/pages/settings/useSubagentTeamEditor.ts");
  const { SubagentTeamContent } = loader.loadModule("src/pages/settings/SubagentTeamSettings.tsx");
  const { subagentTeamNodes } = loader.loadModule("src/presentation/subagentTeamNodes.ts");
  const { configuredSubagentTemplates } = loader.loadModule("src/lib/subagents/configuredTemplates.ts");
  let value = settings.getDefaultSettings(), active = true;
  const base = value.customProviders.find(p => p.type === "codex");
  const model = { ...settings.createProviderModelConfig("codex", "shared-model"), delegationSkills: ["coding", "research"] };
  value = { ...value, customProviders: ["one", "two"].map(id => ({ ...base, id, name: "Identical name", apiKey: `key-${id}`, activeModels: [model.id], models: [model] })) };
  const setSettings = fn => { value = fn(value); };
  const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : [node, ...flatten(node.props?.children)];
  return { settings, hooks, configuredSubagentTemplates, render: () => hooks.render(() => useSubagentTeamEditor({ settings: value, setSettings }, active)), web: e => flatten(SubagentTeamContent({ editor: e })), native: e => subagentTeamNodes(e, k => k), get value() { return value; }, set value(v) { value = v; }, set active(v) { active = v; } };
}

function fill(f, pin = "two::shared-model") {
  f.render().open();
  f.render().patch({ name: " Coder ", description: "Implement verified code", prompt: " Inspect repository and deliver code ", modelValue: pin });
  f.render().patch({ skills: "Coding, research" });
  return f.render();
}

test("both enabled team roles survive settings normalization while legacy global prompts remain single-enabled", () => {
  const f = fixture();
  const role = { id: "coder", name: "Coder", description: "Code", prompt: "Inspect", enabled: true, modelValue: "two::shared-model", requiredSkills: ["coding", "coding", "../invalid"] };
  const normalized = f.settings.normalizeSettings({ ...f.value, system: { ...f.value.system, subagentTemplates: [role, { ...role, id: "research" }, role] }, agents: [{ ...role }, { ...role, id: "global-two" }] });
  assert.equal(normalized.system.subagentTemplates.length, 2);
  assert.ok(normalized.system.subagentTemplates.every(t => t.enabled));
  assert.deepEqual(Array.from(normalized.system.subagentTemplates[0].requiredSkills), ["coding"]);
  assert.equal(normalized.agents.filter(t => t.enabled).length, 1);
  assert.equal(normalized.system.subagentTemplates[0].modelValue, "two::shared-model");
  f.hooks.unmount();
});

test("default-off omits team bindings and instructions without changing legacy templates", () => {
  const f = fixture(); const e = fill(f); e.save();
  const legacy = [{ id: "global", name: "Global", description: "", prompt: "Legacy instructions", enabled: true }];
  const off = f.configuredSubagentTemplates(legacy, f.value.system.subagentTemplates, false);
  assert.deepEqual(Array.from(off, t => t.id), ["global"]);
  const on = f.configuredSubagentTemplates(legacy, f.value.system.subagentTemplates, true);
  assert.equal(on.length, 2); assert.equal(on[1].modelValue, "two::shared-model");
  assert.deepEqual(Array.from(on[1].requiredSkills), ["coding", "research"]);
  f.hooks.unmount();
});

test("real web controls edit an unsaved draft, save exact account pin and retain unrelated current settings", () => {
  const f = fixture(); let e = f.render();
  f.web(e).find(n => n.type === "Button" && n.props.children === "subagentTeam.add").props.onClick();
  e = f.render(); const controls = f.web(e);
  assert.equal(controls.find(n => n.type === "Button" && n.props.children === "settings.save").props.isDisabled, true);
  controls.find(n => n.type === "TextInput" && n.props.label === "subagentTeam.name").props.onChange(" Coder ");
  controls.find(n => n.type === "TextArea").props.onChange("Inspect and implement");
  controls.find(n => n.type === "Selector").props.onChange("two::shared-model");
  controls.find(n => n.type === "TextInput" && n.props.label === "subagentTeam.skills").props.onChange("coding");
  assert.equal(f.value.system.subagentTemplates.length, 0);
  f.value = { ...f.value, system: { ...f.value.system, workdir: "/new-workspace" } };
  e = f.render(); f.web(e).find(n => n.type === "Button" && n.props.children === "settings.save").props.onClick();
  assert.equal(f.value.system.workdir, "/new-workspace");
  assert.equal(f.value.system.subagentTemplates[0].name, "Coder");
  assert.equal(f.value.system.subagentTemplates[0].modelValue, "two::shared-model");
  assert.equal(f.value.agents.length, 0); assert.equal(f.render().draft, null);
  f.hooks.unmount();
});

test("cancel and stale controls cannot change another draft or save after navigation/unmount", () => {
  const f = fixture(); const old = fill(f); old.cancel();
  const next = fill(f, "one::shared-model"); old.patch({ name: "Wrong draft" }); old.save();
  assert.equal(f.render().draft.template.name, " Coder "); assert.equal(f.value.system.subagentTemplates.length, 0);
  f.active = false; f.render(); next.save(); assert.equal(f.value.system.subagentTemplates.length, 0);
  f.active = true; const final = fill(f); f.hooks.unmount(); final.save(); assert.equal(f.value.system.subagentTemplates.length, 0);
});

test("deleted or unauthenticated model pins stay visible and cannot silently fall back", () => {
  const f = fixture(); fill(f).save(); const original = f.value.system.subagentTemplates[0];
  f.render().open(original);
  f.value = { ...f.value, customProviders: f.value.customProviders.filter(p => p.id !== "two") };
  let e = f.render(); assert.equal(e.error, "subagentTeam.unavailable");
  assert.ok(e.options.some(o => o.value === "two::shared-model")); e.save();
  assert.equal(f.value.system.subagentTemplates[0], original);
  e.patch({ modelValue: "one::shared-model" }); e = f.render(); assert.equal(e.error, null); e.save();
  assert.equal(f.value.system.subagentTemplates[0].modelValue, "one::shared-model");
  f.hooks.unmount();
});

test("multiple roles can be enabled; capability mismatch and unsupported media prevent enabling", () => {
  const f = fixture(); fill(f).save(); fill(f, "one::shared-model").save();
  assert.equal(f.value.system.subagentTemplates.filter(t => t.enabled).length, 2);
  f.render().open(); f.render().patch({ name: "Video", prompt: "Produce a movie" });
  f.render().patch({ skills: "video_generation" }); assert.equal(f.render().error, "subagentTeam.media");
  f.render().patch({ skills: "documents" }); assert.equal(f.render().error, "subagentTeam.unavailable");
  f.render().patch({ enabled: false }); assert.equal(f.render().error, null); f.render().save();
  assert.equal(f.value.system.subagentTemplates.length, 3); assert.equal(f.value.system.subagentTemplates[2].enabled, false);
  f.hooks.unmount();
});

test("same-role concurrent edits block save/delete, while other roles are retained", () => {
  const f = fixture(); fill(f).save(); const original = f.value.system.subagentTemplates[0];
  f.render().open(original);
  f.value = { ...f.value, system: { ...f.value.system, subagentTemplates: [{ ...original, name: "Changed elsewhere" }] } };
  let e = f.render(); assert.equal(e.error, "subagentTeam.conflict"); e.save(); e.remove();
  assert.equal(f.value.system.subagentTemplates[0].name, "Changed elsewhere"); e.cancel();
  f.render().open(f.value.system.subagentTemplates[0]); f.render().remove();
  assert.equal(f.value.system.subagentTemplates.length, 0); f.hooks.unmount();
});

test("native form has actual scoped actions, valid model choices and disabled invalid save", () => {
  const f = fixture(); const add = f.native(f.render());
  add.handlers.get([...add.handlers.keys()].find(k => k.endsWith(":team-add"))).run(null);
  let e = f.render(), ui = f.native(e);
  const handler = suffix => ui.handlers.get([...ui.handlers.keys()].find(k => k.endsWith(`:${suffix}`)));
  assert.equal(handler("team-save").enabled, false);
  handler("team-name").run("Researcher"); handler("team-prompt").run("Read documents and cite sources"); handler("team-skills").run("research");
  assert.equal(handler("team-model").accepts("invented::model"), false);
  handler("team-model").run("one::shared-model");
  ui = f.native(f.render()); assert.equal(handler("team-save").enabled, true); handler("team-save").run(null);
  assert.equal(f.value.system.subagentTemplates[0].modelValue, "one::shared-model");
  assert.deepEqual(Array.from(f.value.system.subagentTemplates[0].requiredSkills), ["research"]); f.hooks.unmount();
});

test("native persistence includes the team row and accepted background bindings cover nonempty teams only when scheduling is on", () => {
  const system = readFileSync(new URL("../../src-tauri/src/commands/config/settings/system.rs", import.meta.url), "utf8");
  const constants = readFileSync(new URL("../../src-tauri/src/commands/config/settings/mod.rs", import.meta.url), "utf8");
  assert.match(constants, /SYSTEM_SUBAGENT_TEMPLATES_KEY: &str = "subagentTemplates"/);
  assert.match(system, /for key in \[[\s\S]*?SYSTEM_SUBAGENT_TEMPLATES_KEY/);
  const background = readFileSync(new URL("../../src-tauri/src/commands/config/settings/background_execution.rs", import.meta.url), "utf8");
  assert.match(background, /if settings\["intelligentSchedulingEnabled"\]\.as_bool\(\) == Some\(true\)[\s\S]*?filter\(\|templates\| !templates\.is_empty\(\)\)[\s\S]*?material\["subagentTemplates"\]/);
});

test("actual native system SQL persists and reloads multiple role pins without the legacy single-enabled constraint", t => {
  const f = fixture(); fill(f).save(); fill(f, "one::shared-model").save();
  const constants = readFileSync(new URL("../../src-tauri/src/commands/config/settings/mod.rs", import.meta.url), "utf8");
  const system = readFileSync(new URL("../../src-tauri/src/commands/config/settings/system.rs", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../../src-tauri/src/commands/config/settings/db.rs", import.meta.url), "utf8").match(/CREATE TABLE IF NOT EXISTS system_settings \([\s\S]*?\);/)[0];
  const sql = name => constants.match(new RegExp(`const ${name}: &str = "([\\s\\S]*?)";`))[1];
  const keys = system.slice(system.indexOf("fn save_system_with_default_workdir")).match(/for key in \[([\s\S]*?)\]/)[1].match(/SYSTEM_[A-Z_]+_KEY/g).map(name => sql(name));
  const db = new DatabaseSync(":memory:"); t.after(() => { db.close(); f.hooks.unmount(); }); db.exec(schema);
  const insert = db.prepare(sql("SYSTEM_SETTINGS_INSERT_SQL"));
  db.exec(sql("SYSTEM_SETTINGS_DELETE_SQL"));
  for (const key of keys) insert.run(key, JSON.stringify(f.value.system[key] ?? null), 1);
  const stored = Object.fromEntries(db.prepare(sql("SYSTEM_SETTINGS_SELECT_SQL")).all().map(row => [row.setting_key, JSON.parse(row.payload_json)]));
  const restored = f.settings.normalizeSettings({ ...f.value, system: stored });
  assert.equal(restored.system.subagentTemplates.length, 2);
  assert.ok(restored.system.subagentTemplates.every(role => role.enabled));
  assert.deepEqual(Array.from(restored.system.subagentTemplates, role => role.modelValue), ["two::shared-model", "one::shared-model"]);
});
