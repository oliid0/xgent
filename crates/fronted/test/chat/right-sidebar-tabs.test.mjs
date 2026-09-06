import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { reconcileTabOrder, resolveActiveTab, tabForKey } = createTsModuleLoader().loadModule("src/pages/chat/right-sidebar/tabState.ts");

test("mixed tabs keep creation order when browser metadata changes", () => {
  const before = ["browser:main", "terminal:1", "preview:1"];
  assert.deepEqual(reconcileTabOrder(before, ["browser:new", "browser:main", "terminal:1", "preview:1"]), [...before, "browser:new"]);
  assert.deepEqual(reconcileTabOrder(before, ["browser:main", "preview:1"]), ["browser:main", "preview:1"]);
});

test("closing selects the neighboring tab without changing an unrelated active tab", () => {
  const before = ["browser:main", "terminal:1", "preview:1"];
  assert.equal(resolveActiveTab("terminal:1", before, ["browser:main", "preview:1"]), "preview:1");
  assert.equal(resolveActiveTab("preview:1", before, ["browser:main", "terminal:1"]), "terminal:1");
  assert.equal(resolveActiveTab("browser:main", before, ["browser:main", "preview:1"]), "browser:main");
  assert.equal(resolveActiveTab("browser:main", before, []), null);
});

test("tab keyboard navigation wraps and respects RTL", () => {
  assert.equal(tabForKey(["a", "b", "c"], "c", "ArrowRight"), "a");
  assert.equal(tabForKey(["a", "b", "c"], "a", "ArrowRight", true), "c");
  assert.equal(tabForKey(["a", "b", "c"], "b", "Home"), "a");
  assert.equal(tabForKey(["a", "b", "c"], "a", "End"), "c");
});
