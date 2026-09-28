import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { filterModelPickerGroups } = createTsModuleLoader().loadModule(
  "src/lib/chat/modelPickerGroups.ts",
);
const plain = (value) => JSON.parse(JSON.stringify(value));
const option = (providerId, model, label = model) => ({
  providerId, providerName: "Shared provider", providerType: "codex", model, label,
  value: `${providerId}:${model}`,
});
const groups = [
  { id: "one", name: "Zebra", opts: [option("one", "small", "Fast chat"), option("one", "large")] },
  { id: "two", name: "Alpha", opts: [option("two", "large")] },
];

test("provider filter keeps duplicate model names distinct and preserves selection values", () => {
  assert.deepEqual(plain(filterModelPickerGroups(groups, " LARGE ", "two", false)), [groups[1]]);
  assert.deepEqual(plain(filterModelPickerGroups(groups, "fast CHAT", "", false)[0].opts), [groups[0].opts[0]]);
  assert.deepEqual(plain(filterModelPickerGroups(groups, "SHARED PROVIDER", "", false).map((group) => group.id)), ["one", "two"]);
  assert.equal(filterModelPickerGroups(groups, "missing", "", false).length, 0);
});

test("removed provider filters recover and sorting never mutates configured order", () => {
  assert.deepEqual(plain(filterModelPickerGroups(groups, "", "deleted", true).map((group) => group.id)), ["two", "one"]);
  assert.deepEqual(plain(filterModelPickerGroups(groups, "", "", false).map((group) => group.id)), ["one", "two"]);
  assert.deepEqual(groups.map((group) => group.id), ["one", "two"]);
});
