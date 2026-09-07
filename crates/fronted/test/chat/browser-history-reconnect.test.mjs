import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("browser subscriptions signal missed-event refresh and reconnect without losing handlers", async () => {
  const keys = ["EventSource", "fetch", "sessionStorage", "dispatchEvent"];
  const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  let source;
  const events = [];
  const received = [];
  const loader = createTsModuleLoader();
  const { browserRuntime, LOCAL_ACCESS_CONNECTION_EVENT } = loader.loadModule("src/runtime/browser.ts");
  try {
    globalThis.EventSource = class {
      static CLOSED = 2;
      readyState = 1;
      constructor() { source = this; }
    };
    globalThis.sessionStorage = { getItem: () => "paired-session" };
    globalThis.dispatchEvent = event => { events.push(event); return true; };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ subscriptionId: "history-1" }) });
    const stop = await browserRuntime.listen("chat-history:changed", event => received.push(event.payload));
    assert.deepEqual(events.filter(event => event.type === LOCAL_ACCESS_CONNECTION_EVENT).map(event => event.detail), [false, true]);
    source.onerror();
    source.onopen();
    source.onmessage({ data: JSON.stringify({ subscriptionId: "history-1", payload: { kind: "delete", conversationId: "saved" } }) });
    assert.deepEqual(events.slice(-2).map(event => event.detail), [false, true]);
    assert.deepEqual(received, [{ kind: "delete", conversationId: "saved" }]);
    stop();
    source.onmessage({ data: JSON.stringify({ subscriptionId: "history-1", payload: "stale" }) });
    assert.equal(received.length, 1);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
