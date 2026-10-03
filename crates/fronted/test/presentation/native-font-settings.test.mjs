import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness(context, inventory) {
  const states = [];
  const effects = new Map();
  const pending = [];
  const calls = [];
  let cursor = 0;
  let enabled = false;
  let controls;
  let request = 0;
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (next) => {
          states[index] = typeof next === "function" ? next(states[index]) : next;
        }];
      },
      useEffect(effect, dependencies) {
        const index = cursor++;
        const previous = effects.get(index);
        if (previous?.dependencies.every((value, index) => Object.is(value, dependencies[index]))) return;
        const current = { dependencies };
        effects.set(index, current);
        pending.push(() => { previous?.cleanup?.(); current.cleanup = effect(); });
      },
    },
    "@xgent/runtime": {
      invoke: async (command) => { calls.push(command); return inventory(); },
    },
  } });
  const { useNativeFontSettings } = loader.loadModule("src/presentation/nativeFontSettings.ts");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const registry = createPresentationActionRegistry();
  let settings = getDefaultSettings();
  const render = () => {
    cursor = 0;
    controls = useNativeFontSettings({ settings, setSettings: (update) => settings = update(settings) },
      enabled, (key) => key);
    registry.register("fonts", controls.handlers);
    for (const effect of pending.splice(0)) effect();
    return controls;
  };
  const allNodes = (nodes) => nodes.flatMap((node) => [node, ...allNodes(node.children ?? [])]);
  const node = (id) => allNodes(controls.nodes).find((item) => item.id === id);
  const dispatch = async (action, value = null) => {
    const result = await registry.dispatch({ surface: "fonts", action, value, requestId: String(++request) });
    render();
    return result;
  };
  context.after(() => { for (const effect of effects.values()) effect.cleanup?.(); });
  return { render, node, dispatch, calls,
    get settings() { return settings; }, set enabled(value) { enabled = value; },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("native font selectors persist independent values and require valid custom drafts", async (context) => {
  const h = harness(context, () => ["Apple Local Font", "Menlo", "ヒラギノ角ゴ ProN"]);
  assert.deepEqual(h.render().nodes, []);
  assert.equal(h.calls.length, 0);
  h.enabled = true;
  h.render();
  await settle();
  h.render();
  assert.deepEqual(h.calls, ["apple_ui_font_families"]);
  assert.ok(h.node("font-family:interfaceFontFamily").options.some((item) => item.label === "Apple Local Font"));
  for (const [key, value] of [["interfaceFontFamily", '"Apple Local Font"'], ["chatFontFamily", "Georgia"], ["codeFontFamily", "Menlo"]]) {
    assert.equal((await h.dispatch(`font-family:${key}`, value)).ok, true);
    assert.equal(h.settings.customSettings[key], value);
  }
  await h.dispatch("font-family:chatFontFamily", "__custom__");
  assert.equal(h.settings.customSettings.chatFontFamily, "Georgia");
  await h.dispatch("font-family:chatFontFamily:custom", ' "Missing Font",   Georgia ');
  assert.equal(h.settings.customSettings.chatFontFamily, "Georgia");
  assert.equal((await h.dispatch("font-family:chatFontFamily:save")).ok, true);
  assert.equal(h.settings.customSettings.chatFontFamily, '"Missing Font", Georgia');
  await h.dispatch("font-family:chatFontFamily:custom", "url(secret)");
  assert.equal((await h.dispatch("font-family:chatFontFamily:save")).ok, false);
  assert.equal(h.settings.customSettings.chatFontFamily, '"Missing Font", Georgia');
  await h.dispatch("font-family:chatFontFamily", "__default__");
  assert.equal(h.settings.customSettings.chatFontFamily, "");
  assert.equal(h.node("font-family:chatFontFamily:custom"), undefined);
  assert.equal(h.settings.customSettings.codeFontFamily, "Menlo");
  assert.equal(h.settings.customSettings.interfaceFontFamily, '"Apple Local Font"');
  await h.dispatch("font-family:interfaceFontFamily", '"ヒラギノ角ゴ ProN"');
  assert.equal(h.settings.customSettings.interfaceFontFamily, '"ヒラギノ角ゴ ProN"');
});

test("shared font validation accepts Unicode families and rejects active CSS and oversized names", () => {
  const { normalizeFontFamily } = createTsModuleLoader().loadModule("src/lib/system/fontFamily.ts");
  assert.equal(normalizeFontFamily(' "苹方-简",  "ヒラギノ角ゴ ProN", sans-serif '),
    '"苹方-简", "ヒラギノ角ゴ ProN", sans-serif');
  assert.equal(normalizeFontFamily("Ame\u0301lie"), "Ame\u0301lie");
  for (const unsafe of ["Arial; color:red", "url(secret)", "expression(alert)", "@import font", "<script>", "font{}", "font\\path", "A".repeat(201)]) {
    assert.equal(normalizeFontFamily(unsafe), "");
  }
});

test("font inventory failures retain common options and retired requests cannot overwrite a reopened page", async (context) => {
  let resolveOld;
  let attempt = 0;
  const h = harness(context, () => {
    attempt++;
    if (attempt === 1) throw new Error("Inventory unavailable");
    if (attempt === 2) return new Promise((resolve) => { resolveOld = resolve; });
    return ["New Font"];
  });
  h.enabled = true;
  h.render();
  await settle();
  h.render();
  assert.equal(h.node("font-families-error").label, "Inventory unavailable");
  assert.ok(h.node("font-family:codeFontFamily").options.some((item) => item.value === "Menlo"));
  const oldRequest = h.dispatch("font-families-refresh");
  await settle();
  h.enabled = false;
  h.render();
  h.enabled = true;
  h.render();
  await settle();
  h.render();
  resolveOld(["Old Font"]);
  await oldRequest;
  const options = h.node("font-family:interfaceFontFamily").options;
  assert.ok(options.some((item) => item.label === "New Font"));
  assert.ok(!options.some((item) => item.label === "Old Font"));
  assert.equal(h.node("font-families-error"), undefined);
});
