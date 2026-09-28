import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness(options = {}) {
  const state = [];
  const calls = [];
  const created = [];
  let cursor = 0;
  let clones = 0;
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useEffect() {}, useMemo: (create) => create(),
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (value) => { state[index] = value; }];
      },
    },
    "@xgent/runtime": { invoke: async (command, args) => {
      calls.push([command, JSON.parse(JSON.stringify(args))]);
      if (options.invoke) return options.invoke(command, args);
      return command === "system_pick_folder" ? "/chosen" : { path: "/chosen/project" };
    } },
    "../../../i18n": { useLocale: () => ({ t: (key) => key }) },
    "../../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
    "../../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../../lib/git/tauriGitClient": {
      listGitRemoteBranches: async (url) => {
        calls.push(["branches", url]);
        return options.branches ? options.branches() : { branches: ["main", "feature/ui"], defaultBranch: "main" };
      },
      startGitClone: async (args) => { calls.push(["clone", JSON.parse(JSON.stringify(args))]); },
    },
  } });
  const { MobileWorkspaceCreateDialog } = loader.loadModule("src/pages/chat/mobile/MobileWorkspaceCreateDialog.tsx");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const registry = createPresentationActionRegistry();
  const props = {
    settings: { theme: "light" }, open: true, parent: "/workspace", cloneAvailable: options.cloneAvailable ?? true,
    onCreated: (...args) => created.push(args), onCloneStarted: () => { clones += 1; }, onClose() {},
  };
  const render = () => {
    cursor = 0;
    const result = MobileWorkspaceCreateDialog(props);
    if (!result) return null;
    const document = result.props.document;
    validatePresentationDocument({ version: 1, surface: "project", revision: 1, ...document }, result.props.handlers);
    registry.register("project", result.props.handlers);
    return document;
  };
  let request = 0;
  render();
  return { props, calls, created, render, get clones() { return clones; },
    dispatch: (action, value = null) => registry.dispatch({ surface: "project", action, value, requestId: String(++request) }),
  };
}

test("native project creation validates names and uses the selected real destination", async () => {
  const h = harness({ cloneAvailable: false });
  assert.equal((await h.dispatch("create")).ok, false);
  assert.equal((await h.dispatch("project-mode", "clone")).ok, false);
  await h.dispatch("name", "  project  "); h.render();
  assert.equal((await h.dispatch("create")).ok, true);
  assert.deepEqual(h.calls, [["system_create_project_folder", { parent: "/workspace", name: "project" }]]);
  assert.deepEqual(h.created, [["/chosen/project", "managed"]]);
  h.props.open = false;
  assert.equal(h.render(), null);
});

test("native clone mode infers a name, discovers branches and submits the selected branch", async () => {
  const h = harness();
  assert.equal((await h.dispatch("project-mode", "invalid")).ok, false);
  await h.dispatch("project-mode", "clone"); h.render();
  assert.equal((await h.dispatch("create")).ok, false);
  await h.dispatch("remote-url", "https://github.com/owner/project.git"); h.render();
  await h.dispatch("load-branches"); h.render();
  await h.dispatch("branch-choice", "feature/ui"); h.render();
  await h.dispatch("choose-destination"); h.render();
  await h.dispatch("create");
  assert.deepEqual(h.calls.at(-1), ["clone", { parent: "/chosen", name: "project", remoteUrl: "https://github.com/owner/project.git", branch: "feature/ui" }]);
  assert.equal(h.clones, 1);
  assert.deepEqual(h.created, []);
});

test("native branch loading blocks stale edits and errors keep the project form actionable", async () => {
  const wait = Promise.withResolvers();
  const h = harness({ branches: () => wait.promise });
  await h.dispatch("project-mode", "clone"); h.render();
  await h.dispatch("remote-url", "https://github.com/owner/project.git"); h.render();
  const fetching = h.dispatch("load-branches");
  await Promise.resolve(); h.render();
  assert.equal((await h.dispatch("remote-url", "https://example.com/other.git")).ok, false);
  assert.equal((await h.dispatch("create")).ok, false);
  wait.resolve({ branches: ["main"], defaultBranch: "main" });
  await fetching; h.render();
  await h.dispatch("remote-url", "https://example.com/other.git");
  const changed = h.render();
  assert.equal(changed.nodes.find((node) => node.id === "clone").children.some((node) => node.id === "branch-choice"), false);
  const failed = harness({ invoke: async () => { throw new Error("Folder creation failed"); } });
  await failed.dispatch("name", "project"); failed.render();
  await failed.dispatch("create");
  const document = failed.render();
  assert.equal(document.nodes.find((node) => node.id === "error").label, "Folder creation failed");
  assert.deepEqual(failed.created, []);
  assert.equal(document.nodes.find((node) => node.id === "project").children.find((node) => node.id === "create").disabled, false);
});
