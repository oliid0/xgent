import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { resolveNumberInputCommit } = await import(new URL("../../node_modules/@astryxdesign/core/dist/NumberInput/numberInputCommit.js", import.meta.url));
const cases = JSON.parse(readFileSync(new URL("../../src-tauri/native/apple-ui/Tests/Fixtures/number-input.json", import.meta.url), "utf8"));
const loader = createTsModuleLoader();
const { presentationControls } = loader.loadModule("src/presentation/controls.ts");
const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
const document = nodes => ({ version: 1, surface: "numeric", revision: 1, mode: "sheet", title: "Settings", appearance: "system", nodes });

test("Apple numeric fixture expectations follow the actual pinned Astryx whole-draft commit policy", () => {
  for (const sample of cases) {
    const result = resolveNumberInputCommit(sample.input, { min: sample.min, max: sample.max, isIntegerOnly: sample.integer, hasClear: sample.clearable ?? false, locale: "en" });
    assert.equal(result.type, sample.decision, sample.input);
    if (result.type === "commit") {
      assert.equal(result.value, sample.value, sample.input);
      assert.equal(result.didClamp, sample.clamped, sample.input);
    }
  }
});

test("optional native integer fields accept null, normalize actual bounds and reject fractional or malformed dispatch", async () => {
  const c = presentationControls(), received = [];
  const port = c.optionalNumber("port", "Proxy port", null, 1, 65535, 1, value => received.push(value), true, true);
  const remaining = c.optionalNumber("remaining", "Remaining executions", 10000000, 0, undefined, 1, value => received.push(value), true, true);
  validatePresentationDocument(document([port, remaining]), c.handlers);
  assert.equal(port.clearable, true); assert.equal(port.integerOnly, true);
  assert.equal(remaining.maximum, undefined);
  const registry = createPresentationActionRegistry(); registry.register("numeric", c.handlers);
  let id = 0;
  const dispatch = (action, value) => registry.dispatch({ surface: "numeric", action, value, requestId: String(++id) });
  assert.equal((await dispatch("port", 90000)).acceptedValue, 65535);
  assert.equal((await dispatch("port", -1)).acceptedValue, 1);
  assert.equal((await dispatch("port", null)).acceptedValue, null);
  assert.equal((await dispatch("remaining", 10000000)).acceptedValue, 10000000);
  for (const value of [1.5, "123", NaN, Infinity, {}]) assert.equal((await dispatch("port", value)).ok, false);
  assert.deepEqual(received, [65535, 1, null, 10000000]);
});

test("numeric protocol allows empty optional values while retaining mandatory finite and integer validation", () => {
  const c = presentationControls();
  const node = c.number("timeout", "Timeout", 300, 5, 600, 1, () => {}, true, undefined, true);
  validatePresentationDocument(document([node]), c.handlers);
  for (const patch of [{ value: null }, { value: 12.5 }, { maximum: undefined }, { clearable: "yes" }, { value: Infinity }, { kind: "TextInput" }]) {
    assert.throws(() => validatePresentationDocument(document([{ ...node, ...patch }]), c.handlers), /numeric/);
  }
  assert.throws(() => validatePresentationDocument(document([{ ...node, value: "" }]), c.handlers), /numeric/);
  const registry = createPresentationActionRegistry(); registry.register("numeric", c.handlers);
  return registry.dispatch({ surface: "numeric", action: "timeout", value: 12.5, requestId: "fraction" }).then(result => assert.equal(result.ok, false));
});
