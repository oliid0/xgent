import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const status = label => ({ branch: label, upstream: "origin/main", ahead: 0, behind: 0,
  changes: [{ path: `${label}.ts`, indexStatus: "M", worktreeStatus: "M", staged: true, working: true, untracked: false }] });
function harness(invokeOverride) {
  const hooks = createReactHookHarness(), calls = [];
  const props = { open: true, workdir: "/project", settings: { theme: "system" }, onClose() { props.open = false; } };
  const locale = { t: key => key };
  const mocks = Object.fromEntries(["Banner", "Button", "Center", "CodeBlock", "EmptyState", "IconButton", "List", "Spinner", "TextInput", "Token"].map(name => [`@astryxdesign/core/${name}`, { [name]: name, ListItem: "ListItem" }]));
  const loader = createTsModuleLoader({ mocks: {
    ...mocks, react: hooks.react,
    "@astryxdesign/core/Layout": { HStack: "HStack", StackItem: "StackItem", VStack: "VStack" },
    "@astryxdesign/core/SegmentedControl": { SegmentedControl: "SegmentedControl", SegmentedControlItem: "SegmentedControlItem" },
    "@astryxdesign/core/Text": { Heading: "Heading", Text: "Text" },
    "@xgent/runtime": { async invoke(command, args) { calls.push([command, args]); const override = invokeOverride?.(command, args); if (override !== undefined) return override;
      if (command === "mobile_git_status") return status(args.workdir === "/project" ? "main" : "other");
      if (command === "mobile_git_identity") return { name: "", email: "" };
      return "ready";
    } },
    "../../../components/icons": {},
    "../../../i18n": { useLocale: () => locale },
    "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
    "../../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "./MobilePanelScaffold": { MobileFullscreenPanel: "MobileFullscreenPanel" },
  } });
  const { MobileGitReviewPanel } = loader.loadModule("src/pages/chat/mobile/MobileGitReviewPanel.tsx");
  const render = () => hooks.render(() => MobileGitReviewPanel(props))?.props;
  const ready = async () => { for (let i = 0; i < 3; i++) { await settle(); render(); } };
  const action = (id, value = null, surface = render()) => { const handler = surface.handlers.get(id); assert.ok(handler, id); assert.equal(handler.enabled, true, id); return handler.run(value); };
  const nodes = () => render().document.nodes.flatMap(function walk(node) { return [node, ...(node.children ?? []).flatMap(walk)]; });
  render(); return { calls, props, render, ready, action, nodes, unmount: () => hooks.unmount() };
}

test("mobile Git submits final commit/identity text once and retains failed drafts for retry", async () => {
  const pending = deferred(); let attempt = 0;
  const h = harness(command => command === "mobile_git_mutate" ? ++attempt === 1 ? pending.promise : Promise.resolve("ok") : undefined); await h.ready();
  h.action("git-commit-message", "old"); h.action("git-author-name", "old"); h.action("git-author-email", "old@test");
  const surface = h.render();
  h.action("git-commit-message", "最后提交 🔑", surface); h.action("git-author-name", "最终作者", surface); h.action("git-author-email", "final@test", surface);
  const saving = h.action("git-commit", null, surface); await h.action("git-commit", null, surface);
  assert.equal(h.calls.filter(call => call[0] === "mobile_git_mutate").length, 1);
  const args = h.calls.find(call => call[0] === "mobile_git_mutate")[1];
  assert.equal(args.message, "最后提交 🔑"); assert.equal(args.author_name, "最终作者"); assert.equal(args.author_email, "final@test");
  pending.reject(new Error("identity rejected")); await saving;
  assert.equal(h.nodes().find(node => node.id === "git-commit-message").value, "最后提交 🔑");
  assert.ok(h.nodes().some(node => node.id === "git-error" && node.label === "identity rejected"));
  await h.action("git-commit"); await h.ready();
  assert.equal(h.nodes().find(node => node.id === "git-commit-message").value, "");
  h.unmount();
});

test("mobile Git retires old repository results, errors and actions while the new workspace loads", async () => {
  const initial = deferred();
  const h = harness((command, args) => command === "mobile_git_status" && args.workdir === "/project" ? initial.promise : undefined);
  const old = h.render();
  h.props.workdir = "/other"; h.render(); await h.ready();
  initial.reject(new Error("old repository failed")); await h.ready();
  assert.equal(JSON.stringify(h.render().document).includes("old repository failed"), false);
  assert.ok(JSON.stringify(h.render().document).includes("other.ts"));
  const count = h.calls.length;
  await old.handlers.get("git-refresh").run(null); old.handlers.get("git-close").run(null);
  assert.equal(h.calls.length, count); assert.equal(h.props.open, true);
  h.unmount();
});

test("mobile Git close/reopen isolates a pending diff and preserves discard confirmation on failure", async () => {
  const diff = deferred(); let fail = true;
  const h = harness(command => command === "mobile_git_diff" ? diff.promise
    : command === "mobile_git_mutate" ? fail ? Promise.reject(new Error("discard rejected")) : Promise.resolve("ok") : undefined);
  await h.ready();
  const reading = h.action("git-change:MM:main.ts");
  h.action("git-close"); h.render(); h.props.open = true; h.render(); await h.ready();
  diff.resolve("old diff"); await reading;
  assert.equal(JSON.stringify(h.render().document).includes("old diff"), false);
  const currentReading = h.action("git-change:MM:main.ts"); await currentReading;
  h.action("git-discard"); await h.action("git-discard-confirm");
  assert.ok(h.render().handlers.has("git-discard-confirm"));
  fail = false; await h.action("git-discard-confirm"); await h.ready();
  assert.equal(h.render().handlers.has("git-discard-confirm"), false);
  h.unmount();
});
