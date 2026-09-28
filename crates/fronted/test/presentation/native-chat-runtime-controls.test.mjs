import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { createNativeChatRuntimeControls } = loader.loadModule("src/presentation/nativeChatRuntimeControls.ts");
const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));

function harness(overrides = {}) {
  const patches = [];
  const runtime = createNativeChatRuntimeControls({
    controls: { thinkingEnabled: false, nativeWebSearchEnabled: false, planModeEnabled: false, reasoning: "low" },
    reasoningOptions: ["low", "high"], thinkingAlwaysOn: false, agentMode: true, disabled: false,
    onChange: (patch) => patches.push(plain(patch)), ...overrides,
  }, (key) => key);
  validatePresentationDocument({ version: 1, surface: "chat", revision: 1, mode: "root", title: "Chat", appearance: "system", nodes: runtime.nodes }, runtime.handlers);
  const registry = createPresentationActionRegistry();
  registry.register("chat", runtime.handlers);
  let request = 0;
  return {
    patches, nodes: runtime.nodes,
    dispatch: (action, value) => registry.dispatch({ surface: "chat", requestId: String(++request), action, value }),
  };
}

test("native menu actions use typed real runtime patches and effort enables thinking", async () => {
  const h = harness();
  for (const action of ["runtime-plan", "runtime-web-search", "runtime-thinking"]) {
    assert.equal((await h.dispatch(action, true)).ok, true);
  }
  assert.equal((await h.dispatch("runtime-reasoning", "high")).ok, true);
  assert.deepEqual(h.patches, [{ planModeEnabled: true }, { nativeWebSearchEnabled: true }, { thinkingEnabled: true }, { reasoning: "high", thinkingEnabled: true }]);
  assert.equal((await h.dispatch("runtime-web-search", "true")).ok, false);
  assert.equal((await h.dispatch("runtime-reasoning", "max")).ok, false);
  assert.equal(h.patches.length, 4);
});

test("mandatory thinking and chat mode reject disabled native actions", async () => {
  const h = harness({ thinkingAlwaysOn: true, agentMode: false });
  assert.equal(h.nodes.find((node) => node.id === "runtime-thinking").value, true);
  assert.equal((await h.dispatch("runtime-thinking", false)).ok, false);
  assert.equal((await h.dispatch("runtime-plan", true)).ok, false);
  assert.deepEqual(h.patches, []);
});

test("input lock and unsupported reasoning stay enforced at the action boundary", async () => {
  const locked = harness({ disabled: true });
  assert.equal((await locked.dispatch("runtime-reasoning", "high")).ok, false);
  assert.equal((await locked.dispatch("runtime-web-search", true)).ok, false);
  const unsupported = harness({ reasoningOptions: [] });
  assert.equal((await unsupported.dispatch("runtime-thinking", true)).ok, false);
  assert.equal((await unsupported.dispatch("runtime-reasoning", "high")).ok, false);
  assert.deepEqual(locked.patches.concat(unsupported.patches), []);
});
