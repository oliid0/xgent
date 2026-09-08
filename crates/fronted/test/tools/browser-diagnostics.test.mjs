import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("embedded diagnostics retain console semantics, bound history and survive duplicate injection", () => {
  const calls = [];
  const events = new Map();
  const page = {
    console: { log(...values) { calls.push(values); } },
    addEventListener(name, handler) { events.set(name, handler); },
    performance: { getEntriesByType: (type) => type === "resource" ? [{ name: "http://localhost:8000/app.js", startTime: 1, duration: 20, initiatorType: "script" }] : [] },
  };
  const context = vm.createContext({ window: page, document: { addEventListener() {} } });
  const source = readFileSync(new URL("../../../browser-automation/shared/browser-runtime.js", import.meta.url), "utf8");
  vm.runInContext(source, context);
  page.console.log("before reinjection");
  vm.runInContext(source, context);
  const read = (action) => JSON.parse(page.__xgentBrowserRuntime.execute(action)).data;
  assert.equal(read("get_console").entries[0].message, "before reinjection");
  for (let i = 0; i < 200; i++) page.console.log(i);
  assert.equal(calls.length, 201);
  assert.equal(read("get_console").entries.length, 100);
  events.get("error")({ message: "Script failed", filename: "app.js" });
  assert.match(read("get_console").entries.at(-1).message, /Script failed/);
  const network = read("get_network");
  assert.equal(network.entries[0].duration, 20);
  assert.equal(network.entries[0].responseStatus, null);
  assert.equal(network.entries[0].url, "http://localhost:8000/app.js");
});
