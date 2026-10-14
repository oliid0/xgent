import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const lease = { attempt: 1, generation: 2, token: "11111111-1111-4111-8111-111111111111" };

test("captured native lease cannot follow mutation of the claimed request", () => {
  const { captureBackgroundLease } = createTsModuleLoader().loadModule("src/lib/automation/backgroundLease.ts");
  const requestLease = { ...lease };
  const captured = captureBackgroundLease(requestLease);
  requestLease.attempt++;
  requestLease.generation++;
  requestLease.token = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(captured, lease);
  assert.notEqual(captured, requestLease);
  assert.equal(Object.isFrozen(captured), true);
  assert.throws(() => { captured.token = requestLease.token; }, TypeError);
});

test("missing or malformed authority cannot start a journal or native checkpoint", () => {
  let nativeCalls = 0;
  const loader = createTsModuleLoader({ mocks: { "./backend": { backend: new Proxy({}, {
    get: () => () => { nativeCalls++; throw new Error("must not call native storage"); },
  }) } } });
  const { createBackgroundExecutionJournal } = loader.loadModule("src/lib/automation/backgroundExecutionJournal.ts");
  for (const invalid of [undefined, { ...lease, attempt: 0 }, { ...lease, generation: -1 },
    { ...lease, attempt: 1.5 }, { ...lease, generation: Number.MAX_SAFE_INTEGER + 1 },
    { ...lease, token: "" }, { ...lease, token: "not-a-native-token" }]) {
    assert.throws(() => createBackgroundExecutionJournal("execution", { systemPrompt: "policy", messages: [] },
      new AbortController().signal, { lease: invalid }), /valid native attempt\/generation lease/);
  }
  assert.equal(nativeCalls, 0);
});
