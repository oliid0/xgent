import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("empty trajectory snapshots stay referentially stable for React subscriptions", () => {
  const loader = createTsModuleLoader();
  const { createTrajectoryLiveStore } = loader.loadModule("src/lib/trajectory/liveStore.ts");
  const store = createTrajectoryLiveStore();
  const empty = store.getSnapshot("new");
  assert.equal(store.getSnapshot("new"), empty);
  store.append("new", [{ id: "event-1" }]);
  const populated = store.getSnapshot("new");
  assert.notEqual(populated, empty);
  assert.equal(store.getSnapshot("new"), populated);
  store.clear("new");
  assert.equal(store.getSnapshot("new"), empty);
});
