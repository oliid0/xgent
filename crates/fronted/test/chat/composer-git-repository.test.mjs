import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const t = key => key;
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const state = (workdir, status = "ready", head = "main") => ({ workdir, repoRoot: workdir, status, head });
const response = (workdir, status = "ready", head = "main") => ({ state: state(workdir, status, head), branches: status === "ready"
  ? [{ name: head, fullName: `refs/heads/${head}`, kind: "local", current: true }, { name: "feature", fullName: "refs/heads/feature", kind: "local", current: false }] : [] });

function harness(client, overrides = {}) {
  const hooks = createReactHookHarness();
  const loader = createTsModuleLoader({ mocks: { react: hooks.react,
    "../../../i18n": { useLocale: () => ({ t }) },
    "../../../lib/workspace-activity/useWorkspaceInvalidation": { useWorkspaceInvalidation() {} },
  } });
  const { useComposerGitRepository } = loader.loadModule("src/pages/chat/composer/useComposerGitRepository.ts");
  let props = { workdir: "/project/ai", gitClient: client, isOpen: true, ...overrides };
  const render = changes => { if (changes) props = { ...props, ...changes }; return hooks.render(() => useComposerGitRepository(props)); };
  render();
  return { render, unmount: () => hooks.unmount() };
}

test("repository initialization executes once, then exposes the actual branch and repository", async () => {
  let ready = false; const calls = [], initialization = deferred();
  const client = { branches: async workdir => response(workdir, ready ? "ready" : "not_repo"),
    init: async (...args) => { calls.push(args); await initialization.promise; ready = true; return { ok: true }; } };
  const h = harness(client);
  try {
    await settle(); const before = h.render(); assert.equal(before.noRepository, true);
    const first = before.initializeRepository(); const second = before.initializeRepository();
    assert.deepEqual(calls, [["/project/ai", { branch: "main" }]]);
    initialization.resolve(); await Promise.all([first, second]);
    const after = h.render(); assert.equal(after.noRepository, false);
    assert.equal(after.repositoryMenuLabel, "main: ai"); assert.equal(after.isMutating, false);
    assert.equal(after.selectedBranch, "refs/heads/main");
  } finally { h.unmount(); }
});

test("repository label uses branch:owner/repository for actual HTTPS and SSH remotes", async () => {
  for (const remoteUrl of ["https://github.com/example/ai.git", "git@github.com:example/ai.git", "ssh://git@github.com/example/ai.git",
    "https://private-token@github.com/example/ai.git"]) {
    const h = harness({ branches: async workdir => { const result = response(workdir); result.state.remoteUrl = remoteUrl; return result; } });
    try { await settle(); assert.equal(h.render().repositoryMenuLabel, "main: example/ai"); }
    finally { h.unmount(); }
  }
});

test("old repository callbacks cannot initialize after closing, disabling, or switching workspace", async () => {
  const calls = []; const h = harness({ branches: async workdir => response(workdir, "not_repo"), init: async workdir => { calls.push(workdir); return { ok: true }; } });
  try {
    await settle(); const old = h.render();
    h.render({ isOpen: false }); await old.initializeRepository();
    h.render({ isOpen: true, canWrite: false }); await old.initializeRepository();
    h.render({ canWrite: true, isDisabled: true }); await old.initializeRepository();
    h.render({ isDisabled: false, workdir: "/other" }); await old.initializeRepository();
    assert.deepEqual(calls, []);
  } finally { h.unmount(); }
});

test("late repository discovery cannot query or overwrite the next workspace", async () => {
  const waiting = deferred(), calls = [];
  const client = { discoverRepositories: workdir => workdir === "/project/ai" ? waiting.promise : Promise.resolve({ repositories: [] }),
    branches: async workdir => { calls.push(workdir); return response(workdir); } };
  const h = harness(client);
  try {
    h.render({ workdir: "/project/new" }); await settle(); h.render();
    waiting.resolve({ repositories: [{ root: "/project/ai", name: "old", relativePath: "", isWorkspaceRoot: true }] }); await settle();
    assert.deepEqual(calls, ["/project/new"]);
    assert.equal(h.render().repositoryMenuLabel, "main: new");
  } finally { h.unmount(); }
});

test("a retired refresh cannot cancel the next workspace's pending query", async () => {
  const pending = deferred();
  const h = harness({ branches: workdir => workdir === "/project/new" ? pending.promise : Promise.resolve(response(workdir)) });
  try {
    await settle(); const old = h.render();
    h.render({ workdir: "/project/new" }); await settle();
    await old.refresh();
    pending.resolve(response("/project/new")); await settle();
    assert.equal(h.render().repositoryMenuLabel, "main: new");
    assert.equal(h.render().isLoading, false);
  } finally { h.unmount(); }
});

test("branch mutation uses the selected nested repository and reports real failure with retry", async () => {
  let fail = true; const calls = [];
  const client = {
    discoverRepositories: async () => ({ repositories: [
      { root: "/project/ai", name: "ai", relativePath: "", isWorkspaceRoot: true },
      { root: "/project/ai/nested", name: "nested", relativePath: "nested", isWorkspaceRoot: false },
    ] }), branches: async workdir => response(workdir),
    switchBranch: async (...args) => { calls.push(args); return fail ? { ok: false, stderr: "Uncommitted changes" } : { ok: true }; },
  };
  const h = harness(client);
  try {
    await settle(); h.render().selectRepository("/project/ai/nested"); await settle();
    await h.render().switchBranch("refs/heads/feature");
    assert.equal(h.render().error, "Uncommitted changes");
    assert.deepEqual(calls, [["/project/ai/nested", "feature", "local"]]);
    fail = false; await h.render().refresh(); await h.render().switchBranch("refs/heads/feature");
    assert.equal(h.render().error, ""); assert.equal(calls.length, 2);
  } finally { h.unmount(); }
});

test("a backend error is not offered as an initializable missing repository", async () => {
  let fail = true; const calls = [];
  const h = harness({ branches: async workdir => fail ? { ...response(workdir, "error"), state: { ...state(workdir, "error"), error: "Permission denied" } } : response(workdir, "not_repo"),
    init: async () => { calls.push("init"); return { ok: true }; } });
  try {
    await settle(); assert.equal(h.render().error, "Permission denied");
    await h.render().initializeRepository(); assert.deepEqual(calls, []);
    fail = false; await h.render().refresh();
    assert.equal(h.render().error, ""); assert.equal(h.render().noRepository, true);
  } finally { h.unmount(); }
});

test("closing or unmounting during a mutation prevents its follow-up query and stale errors", async () => {
  const pending = deferred(); let reads = 0;
  const h = harness({ branches: async workdir => { reads++; return response(workdir); }, switchBranch: () => pending.promise });
  await settle(); const mutation = h.render().switchBranch("refs/heads/feature");
  h.render({ isOpen: false }); h.unmount(); pending.resolve({ ok: false, stderr: "retired failure" }); await mutation;
  assert.equal(reads, 1);
});
