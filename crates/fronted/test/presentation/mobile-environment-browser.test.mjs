import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function harness(invoke) {
  const hooks = createReactHookHarness(), calls = [];
  let closes = 0;
  const props = { rootPath: "/app/alpine", backend: "android-proot", open: true,
    nativeSettingsSurfaceId: "settings-session", appearance: "dark", onClose() { closes++; props.open = false; } };
  const mocks = Object.fromEntries(["Banner", "Breadcrumbs", "Button", "CodeBlock", "EmptyState", "Layout", "List", "Spinner", "Text"].map(name => [
    `@astryxdesign/core/${name}`, Object.fromEntries((name === "Layout" ? ["HStack", "VStack", "StackItem"]
      : name === "Breadcrumbs" ? ["Breadcrumbs", "BreadcrumbItem"] : name === "List" ? ["List", "ListItem"] : [name]).map(symbol => [symbol, symbol]))
  ]));
  const loader = createTsModuleLoader({ mocks: {
    ...mocks, react: hooks.react, "react-dom": { createPortal: child => child },
    "../../components/icons": {}, "../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "../chat/mobile/MobilePanelScaffold": {},
    "@xgent/runtime": { async invoke(command, args) { calls.push({ command, args }); return invoke(command, args); } },
  } });
  const { MobileEnvironmentBrowser } = loader.loadModule("src/pages/settings/MobileEnvironmentBrowser.tsx");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const render = () => {
    const result = hooks.render(() => MobileEnvironmentBrowser(props))?.props;
    if (result) validatePresentationDocument({ ...result.document, surface: "shell-files", version: 1, revision: 1 }, result.handlers);
    return result;
  };
  const dispatch = async (action, value = null) => {
    const handler = render().handlers.get(action);
    assert.ok(handler?.enabled, `${action} must be enabled`);
    assert.ok(handler.accepts(value));
    const pending = handler.run(value);
    render(); // Commit state changes so navigation starts its effect before settling IPC.
    await pending; await settle(); return render();
  };
  return { props, calls, render, dispatch, unmount: () => hooks.unmount(), get closes() { return closes; } };
}

test("installed Shell browser navigates folders, pages results and previews real bounded text on the retained native surface", async () => {
  const h = harness((command, args) => {
    if (command === "fs_list") return { entries: args.path ? [{ path: "etc/alpine-release", kind: "file" }]
      : args.offset ? [{ path: "usr", kind: "dir" }]
      : [{ path: "README", kind: "file" }, { path: "etc", kind: "dir" }], hasMore: !args.path && !args.offset };
    if (command === "fs_path_status") return { kind: "file", sizeBytes: 8 };
    if (command === "fs_read_text") return { kind: "text", content: "3.24.0\n", truncated: true };
    throw new Error(command);
  });
  assert.ok(JSON.stringify(h.render().document).includes("shell-files-loading"));
  await settle();
  let surface = h.render();
  assert.equal(surface.sessionSurface, "settings-session");
  assert.equal(surface.document.appearance, "dark");
  assert.deepEqual(surface.document.nodes.find(n => n.kind === "List").children.map(n => n.label), ["etc", "README"]);
  await h.dispatch("shell-files-more");
  assert.equal(h.calls.at(-1).args.offset, 2);
  await h.dispatch("shell-files-entry:etc");
  assert.deepEqual(h.calls.at(-1).args, { workdir: "/app/alpine", path: "etc", depth: 1, offset: 0, max_results: 100, show_hidden: true });
  surface = await h.dispatch("shell-files-entry:etc/alpine-release");
  assert.ok(JSON.stringify(surface.document).includes("3.24.0\\n"));
  assert.ok(JSON.stringify(surface.document).includes("settings.mobileFilesTruncated"));
  assert.deepEqual(h.calls.at(-1).args, { workdir: "/app/alpine", path: "etc/alpine-release", start_line: 1, limit: 120 });
  await h.dispatch("shell-files-list");
  await h.dispatch("shell-files-directory", "");
  assert.equal(h.calls.at(-1).args.path, null);
  await h.dispatch("shell-files-close");
  assert.equal(h.closes, 1);
  assert.equal(h.render(), undefined);
});

test("Shell browser rejects oversized and non-text previews and can retry a failed directory request", async () => {
  let broken = true, sizeBytes = 1024 * 1024 + 1;
  const h = harness(command => {
    if (command === "fs_list") {
      if (broken) throw new Error("directory unavailable");
      return { entries: [{ path: "file", kind: "file" }], hasMore: false };
    }
    if (command === "fs_path_status") return { kind: "file", sizeBytes };
    if (command === "fs_read_text") return { kind: "image", content: null };
  });
  h.render(); await settle();
  assert.ok(JSON.stringify(h.render().document).includes("directory unavailable"));
  broken = false;
  await h.dispatch("shell-files-refresh");
  await h.dispatch("shell-files-entry:file");
  assert.equal(h.calls.some(c => c.command === "fs_read_text"), false);
  assert.ok(JSON.stringify(h.render().document).includes("settings.mobileFilesPreviewUnavailable"));
  await h.dispatch("shell-files-list"); sizeBytes = 8;
  await h.dispatch("shell-files-entry:file");
  assert.ok(JSON.stringify(h.render().document).includes("settings.mobileFilesPreviewUnavailable"));
  assert.equal(JSON.stringify(h.render().document).includes("shell-files-preview"), false);
});

test("closing or unmounting Shell files during metadata lookup never starts a read", async () => {
  for (const leave of ["close", "unmount"]) {
    const pending = deferred();
    const h = harness(command => command === "fs_list" ? { entries: [{ path: "file", kind: "file" }], hasMore: false } : pending.promise);
    h.render(); await settle();
    const surface = h.render();
    const reading = surface.handlers.get("shell-files-entry:file").run(null);
    if (leave === "close") { surface.handlers.get("shell-files-close").run(null); h.render(); }
    else h.unmount();
    pending.resolve({ kind: "file", sizeBytes: 8 }); await reading;
    assert.equal(h.calls.some(c => c.command === "fs_read_text"), false);
    await surface.handlers.get("shell-files-entry:file").run(null);
    // Unmount retires pending work; native action registry removes unmounted handlers.
    if (leave === "close") assert.equal(h.calls.filter(c => c.command === "fs_path_status").length, 1);
  }
});

test("old Shell directory results and native actions cannot replace a new environment root", async () => {
  const pending = deferred();
  const h = harness((_command, args) => args.workdir === "/app/alpine" ? pending.promise : { entries: [{ path: "current", kind: "file" }], hasMore: false });
  const old = h.render();
  h.props.rootPath = "/app/new"; h.render(); await settle();
  pending.resolve({ entries: [{ path: "stale", kind: "file" }], hasMore: true }); await settle();
  assert.equal(JSON.stringify(h.render().document).includes("stale"), false);
  assert.ok(JSON.stringify(h.render().document).includes("current"));
  old.handlers.get("shell-files-directory").run("");
  assert.equal(h.calls.some(c => c.args.path === "stale"), false);
});
