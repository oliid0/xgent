import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("presentation reader retires file switches, propagates errors and ignores unmounted reads", async () => {
  const h = createReactHookHarness(), requests = [];
  const loader = createTsModuleLoader({ mocks: {
    react: h.react,
    "./workspacePresentationText": { readPresentationText: bytes => {
      const deferred = Promise.withResolvers(); requests.push({ bytes, ...deferred }); return deferred.promise;
    } },
  } });
  const { usePresentationText } = loader.loadModule("src/components/workspace-editor/usePresentationText.ts");
  let bytes = Uint8Array.of(1);
  const render = () => h.render(() => usePresentationText(bytes));
  assert.equal(render().loading, true);
  bytes = Uint8Array.of(2); assert.deepEqual(render().entries, []);
  requests[0].resolve([{ id: "old", text: "Retired title" }]); await Promise.resolve();
  assert.deepEqual(render().entries, []); assert.equal(render().loading, true);
  requests[1].reject(new Error("Malformed slide")); await Promise.resolve();
  assert.equal(render().error, "Malformed slide"); assert.equal(render().loading, false);
  bytes = Uint8Array.of(3); assert.equal(render().error, null);
  const entries = [{ id: "current", text: "Actual title" }];
  requests[2].resolve(entries); await Promise.resolve(); assert.deepEqual(render().entries, entries);
  bytes = Uint8Array.of(4); render(); h.unmount();
  requests[3].resolve([{ id: "late" }]); await Promise.resolve();
  assert.deepEqual(render().entries, []);
  bytes = null; assert.equal(render().loading, false); assert.deepEqual(render().entries, []);
  h.unmount();
});
