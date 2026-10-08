import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function state(workdir = "/project") { return { repoRoot: workdir, workdir, head: "main", upstream: "origin/main", remoteName: "origin", remoteUrl: "https://github.com/example/project.git", ahead: 1, behind: 0, stashCount: 0,
  dirtyCounts: { staged: 1, unstaged: 1, untracked: 1, conflicted: 0 }, status: "ready", entries: [
    { path: "staged.ts", indexStatus: "M", worktreeStatus: ".", staged: true, untracked: false, conflicted: false, kind: "modified" },
    { path: "changed.ts", indexStatus: ".", worktreeStatus: "M", staged: false, untracked: false, conflicted: false, kind: "modified" },
    { path: "new.ts", indexStatus: "?", worktreeStatus: "?", staged: false, untracked: true, conflicted: false, kind: "untracked" },
  ] }; }
function commit(index) { return { sha: `commit-${index}`, shortSha: `c${index}`, parents: [`commit-${index + 1}`], refs: index === 0 ? ["HEAD -> main"] : [], subject: `Commit ${index}`, authorName: "Author", authorEmail: "author@test", authorDate: "2026-01-01", fileCount: 1, localOnly: index === 0, files: [{ path: "changed.ts", status: "M", kind: "modified" }] }; }
function harness(overrides = {}, native = true) {
  const hooks = createReactHookHarness(), calls = [], mentions = [], files = [], revealed = [];
  let closed = 0, reviews = 0;
  const result = workdir => ({ ok: true, state: state(workdir), stdout: "", stderr: "", message: "" });
  const diff = (mode, path) => ({ baseRef: "origin/main", headRef: "main", mode, files: [path], patch: `diff ${mode} ${path}`, stat: "1 file changed", truncated: false, binaryFiles: [] });
  const api = {
    status: async workdir => state(workdir),
    discoverRepositories: async workdir => ({ workdir, repositories: [
      { root: workdir, name: "project", relativePath: "", isWorkspaceRoot: true },
      { root: `${workdir}/nested`, name: "nested", relativePath: "nested", isWorkspaceRoot: false },
    ] }),
    diff: async (_workdir, mode, path) => diff(mode, path),
    branches: async workdir => ({ state: state(workdir), branches: [
      { name: "main", fullName: "main", kind: "local", current: true, upstream: "origin/main" },
      { name: "topic", fullName: "topic", kind: "local", current: false, upstream: "" },
      { name: "origin/topic", fullName: "origin/topic", kind: "remote", current: false, upstream: "" },
    ], worktrees: [{ path: "/trees/topic", branch: "topic", isCurrent: false, mainWorktreePath: workdir }] }),
    log: async (workdir, options) => ({ state: state(workdir), commits: options.skip ? [commit(50)] : Array.from({ length: 50 }, (_, i) => commit(i)), historyBaseRef: "main", historyRemoteRef: "origin/main", historyAhead: 1, historyBehind: 0, mergeBase: "commit-1" }),
    commitDetails: async (workdir, sha) => ({ state: state(workdir), commit: { ...commit(0), sha, body: "Commit body", remoteName: "origin", remoteUrl: state().remoteUrl, filesChanged: 1, insertions: 1, deletions: 0, stat: "1 file changed" } }),
    commitDiff: async (_workdir, sha, path) => diff(sha, path),
    compareCommitWithRemote: async (_workdir, sha) => diff("remote", sha),
    ...Object.fromEntries(["commit", "stage", "stageAll", "unstage", "unstageAll", "discard", "discardAll", "addToGitignore", "openSystemFileLocation", "fetch", "pull", "push", "init", "setRemote", "switchBranch", "createBranch", "createWorktree", "removeWorktree", "stashPush"].map(name => [name, async workdir => result(workdir)])),
    ...overrides,
  };
  const client = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args) => { calls.push([name, ...args]); return fn(...args); }]));
  const context = { cwd: "/project", projectPathKey: "/project", clients: { git: client, workspaceActivity: {} }, capabilities: { gitWriteEnabled: true },
    git: { onInsertCodeReviewSkill() { reviews++; }, onInsertCommitMention(value) { mentions.push(value); }, onInsertGitFileMention(value) { files.push(value); } },
    fileTree: { onRevealInFileTree(path) { revealed.push(path); } },
  };
  const loader = createTsModuleLoader({ mocks: {
    react: { ...hooks.react, memo: component => component },
    "@xgent/runtime": { openUrl: async url => { calls.push(["openUrl", url]); } },
    "../components/project-tools/WorkspaceToolsContext": { WorkspaceToolsContext: { Provider: "Provider" } },
    "../WorkspaceToolsContext": { useWorkspaceToolsContext: () => context },
    "../../../i18n": { useLocale: () => ({ t: key => key }) },
    "../i18n": { useLocale: () => ({ t: key => key }) },
    "../../../lib/workspace-activity/useWorkspaceInvalidation": { useWorkspaceInvalidation() {} },
    "../lib/system/clipboardText": { writeClipboardText: async text => calls.push(["clipboard", text]) },
    "./NativeSurface": { NativeSurface: "NativeSurface" },
    "./nativeTheme": { createNativePresentationTheme: () => undefined },
    "./Toolbar": { GitReviewToolbar: "GitReviewToolbar", GitRemoteSetupModal: "GitRemoteSetupModal", GitOperationNoticeToast: "GitOperationNoticeToast" },
    "./StatusView": { GitReviewStatusView: "GitReviewStatusView" },
    "./HistoryView": { GitReviewHistoryView: "GitReviewHistoryView" },
  } });
  const { NativeDesktopGitBody } = loader.loadModule("src/presentation/NativeDesktopGitPanel.tsx");
  const { GitReviewPanel } = loader.loadModule("src/components/project-tools/git-review/index.tsx");
  const render = () => hooks.render(() => native ? NativeDesktopGitBody({ settings: { theme: "system" }, context, onClose: () => { closed++; } }) : GitReviewPanel({ active: true })).props;
  const action = (id, value = null, surface = render()) => { const handler = surface.handlers.get(id); assert.ok(handler, id); assert.equal(handler.enabled, true, `${id} enabled`); return handler.run(value); };
  const nodes = () => render().document.nodes.flatMap(function walk(node) { return [node, ...(node.children ?? []).flatMap(walk)]; });
  const ready = async () => { for (let i = 0; i < 4; i++) { await settle(); render(); } };
  render();
  return { calls, context, action, nodes, render, ready, unmount: () => hooks.unmount(), mentions, files, revealed, get closed() { return closed; }, get reviews() { return reviews; } };
}

test("native desktop Git exposes the desktop controller's detailed changes, diff modes and mutations", async () => {
  const h = harness(); await h.ready();
  assert.equal(h.render().document.mode, "panel");
  assert.ok(h.nodes().some(node => node.id === "desktop-git-list"));
  assert.ok(h.nodes().some(node => node.id === "desktop-git-detail"));
  await h.action("git-stage-all"); await h.ready();
  await h.action("git-unstage-all"); await h.ready();
  await h.action("git-working:changed.ts:stage"); await h.ready();
  await h.action("git-staged:staged.ts:unstage"); await h.ready();
  await h.action("git-working:new.ts:ignore"); await h.ready();
  h.action("git-working:changed.ts:select"); await h.ready();
  h.action("git-diff-mode", "branch");
  assert.equal(h.nodes().find(node => node.id === "git-diff-patch").text, "diff branch changed.ts");
  h.action("git-working:changed.ts:reveal");
  await h.action("git-working:changed.ts:finder");
  h.action("git-ai-review");
  assert.deepEqual(h.revealed, ["changed.ts"]); assert.equal(h.reviews, 1);
  assert.ok(h.calls.some(call => call[0] === "stageAll"));
  assert.ok(h.calls.some(call => call[0] === "unstageAll"));
  assert.ok(h.calls.some(call => call[0] === "stage" && call[2] === "changed.ts"));
  assert.ok(h.calls.some(call => call[0] === "unstage" && call[2] === "staged.ts"));
  assert.ok(h.calls.some(call => call[0] === "addToGitignore" && call[2] === "new.ts"));
  h.unmount();
});

test("native Git hides and restores its retained diff without extra loads and retires old visibility actions", async () => {
  const h = harness(); await h.ready();
  h.action("git-working:changed.ts:select"); await h.ready();
  const patch = h.nodes().find(node => node.id === "git-diff-patch").text;
  const before = h.calls.filter(call => call[0] === "diff").length;
  h.action("git-diff-visible", false); const hidden = h.render();
  assert.equal(h.nodes().find(node => node.id === "git-diff-visible").value, false);
  assert.equal(h.nodes().find(node => node.id === "git-diff-patch").text, patch);
  h.action("git-diff-visible", true);
  assert.equal(h.calls.filter(call => call[0] === "diff").length, before);
  h.action("git-diff-visible", false);
  h.action("git-working:new.ts:select"); await h.ready();
  assert.equal(h.nodes().find(node => node.id === "git-diff-visible").value, true);
  h.action("git-repository", "/project/nested"); h.render(); await h.ready();
  h.action("git-diff-visible", false, hidden);
  assert.equal(h.nodes().find(node => node.id === "git-diff-visible").value, true);
  h.unmount();
});

test("Astryx Git composes both panes, hides to the list and restores a working or history selection", async () => {
  const h = harness({}, false); await h.ready();
  const children = () => h.render().children.flat(Infinity).filter(Boolean);
  const toolbar = () => children().find(node => node.type === "GitReviewToolbar").props;
  const changes = () => children().find(node => node.type === "GitReviewStatusView").props;
  const history = () => children().find(node => node.type === "GitReviewHistoryView").props;
  assert.equal(h.render().style.containerName, "xgent-git-review");
  assert.equal(changes().useSplitReviewLayout, true);
  const before = h.calls.filter(call => call[0] === "diff").length;
  toolbar().data.setDiffVisible(false);
  assert.equal(changes().useSplitReviewLayout, false);
  assert.equal(changes().stackedPane, "list");
  toolbar().data.setDiffVisible(true);
  assert.equal(h.calls.filter(call => call[0] === "diff").length, before);
  toolbar().data.setDiffVisible(false);
  toolbar().data.selectPath("changed.ts"); await h.ready();
  assert.equal(changes().useSplitReviewLayout, true);
  assert.equal(toolbar().data.selectedPath, "changed.ts");
  toolbar().data.setReviewMode("history"); await h.ready();
  toolbar().data.setDiffVisible(false);
  assert.equal(history().useSplitReviewLayout, false);
  const entry = toolbar().data.historyCommits[0];
  toolbar().data.selectCommitFileData(entry, entry.files[0]); await h.ready();
  assert.equal(history().useSplitReviewLayout, true);
  assert.equal(toolbar().data.selectedCommitSha, entry.sha);
  assert.ok(h.calls.some(call => call[0] === "commitDiff" && call[2] === entry.sha));
  h.unmount();
});

test("native Git commits the final acknowledged input once and preserves it after a failed operation", async () => {
  const pending = deferred(); let attempts = 0;
  const h = harness({ commit: async workdir => { if (++attempts === 1) return pending.promise; return { ok: true, state: state(workdir), message: "", stdout: "", stderr: "" }; } }); await h.ready();
  h.action("git-commit-message", "old message"); const surface = h.render();
  h.action("git-commit-message", "最后提交 🔑", surface);
  const saving = h.action("git-commit", null, surface);
  await h.action("git-commit", null, surface);
  assert.deepEqual(h.calls.filter(call => call[0] === "commit"), [["commit", "/project", "最后提交 🔑"]]);
  pending.resolve({ ok: false, message: "commit rejected", stderr: "", stdout: "", state: state() });
  await saving;
  assert.equal(h.nodes().find(node => node.id === "git-commit-message").value, "最后提交 🔑");
  assert.ok(h.nodes().some(node => node.id === "git-error" && node.label === "commit rejected"));
  await h.action("git-commit"); await h.ready();
  assert.equal(h.nodes().find(node => node.id === "git-commit-message").value, "");
  h.unmount();
});

test("native Git history paginates and shares commit/file diff, remote comparison and chat context", async () => {
  const h = harness(); await h.ready();
  h.action("git-view", "history"); await h.ready();
  assert.ok(h.nodes().some(node => node.id === "git-commit:commit-49"));
  h.action("git-commit:commit-0:select"); await h.ready();
  h.action("git-commit:commit-0:file:changed.ts:diff"); await h.ready();
  assert.equal(h.nodes().find(node => node.id === "git-diff-patch").text, "diff commit-0 changed.ts");
  h.action("git-commit:commit-0:file:changed.ts:context");
  await h.action("git-commit:commit-0:context");
  assert.equal(h.files[0].path, "changed.ts"); assert.equal(h.mentions[0].sha, "commit-0");
  h.action("git-commit:commit-0:compare"); await h.ready();
  assert.equal(h.nodes().find(node => node.id === "git-diff-patch").text, "diff remote commit-0");
  await h.action("git-commit:commit-0:github"); await h.action("git-commit:commit-0:copy"); await h.action("git-commit:commit-0:message");
  assert.ok(h.calls.some(call => call[0] === "clipboard" && call[1] === "Commit 0\n\nCommit body"));
  assert.ok(h.calls.some(call => call[0] === "openUrl" && call[1].endsWith("/commit/commit-0")));
  await h.action("git-load-more"); await h.ready();
  assert.ok(h.nodes().some(node => node.id === "git-commit:commit-50"));
  assert.ok(h.calls.some(call => call[0] === "log" && call[2].skip === 50));
  h.action("git-commit:commit-0:branch");
  h.action("git-branch-name", "commit/old"); const surface = h.render(); h.action("git-branch-name", "commit/最后分支", surface);
  await h.action("git-branch-create", null, surface);
  assert.ok(h.calls.some(call => call[0] === "createBranch" && call[2] === "commit/最后分支" && call[3] === "commit-0"));
  h.unmount();
});

test("native Git worktrees and discard retain confirmation on failure and retire old repository callbacks", async () => {
  let fail = true;
  const h = harness({ discard: async workdir => ({ ok: !fail, state: state(workdir), message: fail ? "discard rejected" : "", stderr: "", stdout: "" }) }); await h.ready();
  h.action("git-working:changed.ts:discard");
  await h.action("git-confirm-submit");
  assert.ok(h.nodes().some(node => node.id === "git-confirm"));
  fail = false; await h.action("git-confirm-submit");
  assert.equal(h.nodes().some(node => node.id === "git-confirm"), false);
  await h.action("git-branches"); await h.ready();
  assert.equal(h.render().handlers.get("git-branch:local:main").enabled, false);
  await h.action("git-branch:remote:origin/topic"); await h.ready();
  assert.ok(h.calls.some(call => call[0] === "switchBranch" && call[2] === "origin/topic" && call[3] === "remote"));
  h.action("git-worktree-branch", "branch"); h.action("git-worktree-directory", "dir");
  const surface = h.render(); h.action("git-worktree-directory", "最后目录", surface);
  await h.action("git-worktree-create", null, surface);
  assert.ok(h.calls.some(call => call[0] === "createWorktree" && call[2].directoryName === "最后目录"));
  h.action("git-worktree:/trees/topic:remove"); h.action("git-worktree-force", true); h.action("git-worktree-delete-branch", true);
  await h.action("git-confirm-submit");
  assert.ok(h.calls.some(call => call[0] === "removeWorktree" && call[3].force && call[3].deleteBranch));
  const old = h.render(); h.action("git-repository", "/project/nested"); h.render(); await h.ready();
  const count = h.calls.length;
  await old.handlers.get("git-stage-all").run(null);
  old.handlers.get("git-close").run(null);
  assert.equal(h.calls.length, count); assert.equal(h.closed, 0);
  h.action("git-close"); assert.equal(h.closed, 1);
  h.unmount();
});

test("native Git missing-remote setup saves the final URL and stash conflict follows desktop behavior", async () => {
  let remote = false, switched = false;
  const h = harness({
    push: async workdir => { if (!remote) throw new Error("找不到 origin remote"); return { ok: true, state: state(workdir), message: "", stdout: "", stderr: "" }; },
    setRemote: async workdir => { remote = true; return { ok: true, state: state(workdir), message: "", stdout: "", stderr: "" }; },
    switchBranch: async workdir => { if (!switched) throw new Error("Your local changes would be overwritten by checkout"); return { ok: true, state: state(workdir), message: "", stdout: "", stderr: "" }; },
    stashPush: async workdir => { switched = true; return { ok: true, state: state(workdir), message: "", stdout: "", stderr: "" }; },
  }); await h.ready();
  await h.action("git-push");
  h.action("git-remote-url", "https://old.test/project.git"); const surface = h.render();
  h.action("git-remote-url", "https://github.com/example/final.git", surface);
  await h.action("git-remote-save", null, surface);
  assert.ok(h.calls.some(call => call[0] === "setRemote" && call[2] === "https://github.com/example/final.git"));
  assert.equal(h.nodes().some(node => node.id === "git-remote-setup"), false);
  await h.action("git-branches"); await h.action("git-branch:local:topic");
  assert.ok(h.nodes().some(node => node.id === "git-branch-conflict"));
  await h.action("git-branch-conflict-stash");
  assert.equal(h.nodes().some(node => node.id === "git-branch-conflict"), false);
  assert.equal(h.calls.filter(call => call[0] === "stashPush").length, 1);
  h.unmount();
});
