import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const settings = loader.loadModule("src/lib/settings/index.ts");
const model = loader.loadModule("src/components/project-tools/workspaceToolsModel.ts");
const IDS = settings.WORKSPACE_TOOLS_SINGLETON_TAB_IDS;

test("workspace tools keep session ids and normalize singleton tools", () => {
  const state = settings.normalizeWorkspaceToolsProjectState({
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

test("workspace tool settings retain only the 100 most recent projects", () => {
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
  const normalized = settings.normalizeWorkspaceToolsSettings({ projects });
  assert.equal(Object.keys(normalized.projects).length, 100);
  assert.equal(normalized.projects["/workspace/0"], undefined);
  assert.ok(normalized.projects["/workspace/100"]);
});

test("workspace tool neighbour selection is deterministic", () => {
  const order = ["session-1", IDS.gitReview, IDS.fileTree];
  assert.equal(model.workspaceToolsNeighborTabId(order, IDS.gitReview), IDS.fileTree);
  assert.equal(model.workspaceToolsNeighborTabId(order, IDS.fileTree), IDS.gitReview);
  assert.equal(model.workspaceToolsNeighborTabId(order, "missing"), undefined);
});

test("workspace tool updates stamp versions and skip no-op updates", () => {
  const base = settings.normalizeSettings({});
  const opened = settings.openWorkspaceToolsSingletonTab(base, "/workspace/app", "gitReview");
  assert.equal(
    settings.openWorkspaceToolsSingletonTab(opened, "/workspace/app", "gitReview"),
    opened,
  );
  const before = settings.getWorkspaceToolsProjectState(
    opened.customSettings,
    "/workspace/app",
  );
  const changed = settings.updateWorkspaceToolsProjectState(
    opened,
    "/workspace/app",
    (current) => ({
      ...current,
      tabOrder: [...current.tabOrder, "session-new"],
    }),
  );
  const after = settings.getWorkspaceToolsProjectState(
    changed.customSettings,
    "/workspace/app",
  );
  assert.equal(after.stateVersion, before.stateVersion + 1);
  assert.equal(after.writerId, settings.getWorkspaceToolsWriterId());
});
