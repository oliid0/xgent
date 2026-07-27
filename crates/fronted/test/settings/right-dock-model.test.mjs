import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const settings = loader.loadModule("src/lib/settings/index.ts");
const model = loader.loadModule("src/components/project-tools/rightDockModel.ts");
const IDS = settings.RIGHT_DOCK_SINGLETON_TAB_IDS;

test("right dock state keeps session ids and normalizes singleton tools", () => {
  const state = settings.normalizeRightDockProjectState({
    activeTabId: "session-1",
    tabOrder: ["session-1", IDS.gitReview, IDS.gitReview],
    tools: { gitReview: { openedAt: 5 } },
    openVersion: 2,
    stateVersion: 3,
    writerId: "writer",
    lastUsedAt: 42,
  });
  assert.deepEqual(state.tabOrder, ["session-1", IDS.gitReview]);
  assert.equal(state.activeTabId, "session-1");
  assert.deepEqual(state.tools, { gitReview: { openedAt: 5 } });
});

test("right dock settings retain only the 100 most recent project buckets", () => {
  const projects = {};
  for (let index = 0; index <= 100; index += 1) {
    projects[`/workspace/${index}`] = {
      tabOrder: [IDS.gitReview],
      tools: { gitReview: { openedAt: 1 } },
      stateVersion: 1,
      openVersion: 1,
      writerId: "w",
      lastUsedAt: index,
    };
  }
  const normalized = settings.normalizeRightDockSettings({ projects });
  assert.equal(Object.keys(normalized.projects).length, 100);
  assert.equal(normalized.projects["/workspace/0"], undefined);
  assert.ok(normalized.projects["/workspace/100"]);
});

test("active tab resolution waits for sessions and then falls back", () => {
  const visible = ["session-1", IDS.fileTree];
  assert.equal(model.resolveEffectiveActiveTabId("session-1", visible, false), "session-1");
  assert.equal(model.resolveEffectiveActiveTabId("session-later", visible, false), null);
  assert.equal(model.resolveEffectiveActiveTabId("session-dead", visible, true), "session-1");
  assert.equal(model.resolveEffectiveActiveTabId(IDS.gitReview, visible, false), "session-1");
});

test("closing a tool removes it and selects the requested neighbour", () => {
  const state = {
    activeTabId: IDS.gitReview,
    tabOrder: ["session-1", IDS.gitReview, IDS.fileTree],
    tools: { gitReview: { openedAt: 1 }, fileTree: { openedAt: 2 } },
    openVersion: 2,
    stateVersion: 3,
    writerId: "w",
    lastUsedAt: 9,
  };
  const closed = model.closeRightDockToolTabState(state, "gitReview", "session-1");
  assert.equal(closed.activeTabId, "session-1");
  assert.deepEqual(closed.tabOrder, ["session-1", IDS.fileTree]);
  assert.deepEqual(Object.keys(closed.tools), ["fileTree"]);
});

test("tab drag helpers reorder, shift, and clamp deterministically", () => {
  const slots = [
    { id: "a", left: 0, width: 80 },
    { id: "b", left: 84, width: 160 },
    { id: "c", left: 248, width: 60 },
  ];
  assert.equal(model.computeTabDragInsertIndex(slots, "a", 85), 1);
  assert.deepEqual(model.applyTabDragInsertIndex(["a", "b", "c"], "a", 2), ["b", "c", "a"]);
  assert.deepEqual(model.computeTabShiftOffsets(slots, "c", 0, 4), { a: 64, b: 64 });
  assert.equal(model.clampTabDragOffset(slots, "a", 500), 228);
});

test("right dock updates stamp versions and skip no-op updates", () => {
  const base = settings.normalizeSettings({});
  const opened = settings.openRightDockSingletonTab(base, "/workspace/app", "gitReview");
  assert.equal(settings.openRightDockSingletonTab(opened, "/workspace/app", "gitReview"), opened);
  const before = settings.getRightDockProjectState(opened.customSettings, "/workspace/app");
  const changed = settings.updateRightDockProjectState(opened, "/workspace/app", (current) => ({
    ...current,
    tabOrder: [...current.tabOrder, "session-new"],
  }));
  const after = settings.getRightDockProjectState(changed.customSettings, "/workspace/app");
  assert.equal(after.stateVersion, before.stateVersion + 1);
  assert.equal(after.writerId, settings.getRightDockWriterId());
});
