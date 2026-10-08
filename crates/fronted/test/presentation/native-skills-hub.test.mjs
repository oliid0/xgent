import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const base = createTsModuleLoader();
const { normalizeSettings } = base.loadModule("src/lib/settings/index.ts");
const { translations } = base.loadModule("src/i18n/config.ts");
const builtin = base.loadModule("src/lib/skills/builtin.ts");
const { decodeNativeSkillBundle } = base.loadModule("src/presentation/nativeSkillBundle.ts");
const { undoSkillSelection } = base.loadModule("src/lib/skills/selection.ts");
const { buildClawHubSkillKey } = base.loadModule("src/lib/skills/clawHub.ts");
const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const skill = (name = "research") => ({ name, description: "Search and cite source material", baseDir: `skills/${name}`, skillFile: `skills/${name}/SKILL.md` });
const card = () => ({ slug: "research", displayName: "Research assistant", summary: "Search and cite sources", topics: ["research"],
  ownerHandle: "author", latestVersion: "1.2.3", downloads: 300, stars: 20, installsCurrent: 40, updatedAt: 1700000000000 });
const t = key => { assert.ok(translations["zh-CN"][key], `Missing translation: ${key}`); assert.ok(translations["en-US"][key], key); return key; };

function controller(options = {}) {
  const hooks = createReactHookHarness();
  const previewHooks = createReactHookHarness();
  let activeHooks = hooks;
  const react = Object.fromEntries(Object.keys(hooks.react).map(key => [key, (...args) => activeHooks.react[key](...args)]));
  let settings = normalizeSettings({ skills: { enabled: true, selected: [] } });
  const timers = new Map(); let timerID = 0;
  const oldWindow = globalThis.window, oldDocument = globalThis.document, oldReader = globalThis.FileReader;
  globalThis.window = {
    localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, removeEventListener: () => {},
    setTimeout: callback => { const id = ++timerID; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: callback => { const id = ++timerID; timers.set(id, callback); return id; }, clearInterval: id => timers.delete(id),
  };
  globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: "visible" };
  globalThis.FileReader = class {
    readAsDataURL(file) { void file.arrayBuffer().then(bytes => { this.result = `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}`; this.onload(); }); }
  };
  const calls = [];
  const mocks = {
    react: { ...react, useLayoutEffect: react.useEffect },
    "../../i18n": { useLocale: () => ({ t }) },
    "../../runtime/applePresentation": { isApplePresentationRuntime: () => options.native ?? true },
    "../../presentation/NativeSkillsHub": { NativeSkillsHub: "NativeSkillsHub" },
    "../../components/icons": {}, "../../components/Markdown": {},
    "../../components/hub/HubChrome": {}, "../../components/astryx/ConfirmActionPopover": {},
    "../../lib/skills": { ...builtin,
      discoverSkills: options.discover ?? (async () => ({ rootDir: "/skills", skills: [skill()] })),
      notifySkillsDiscoveryUpdated: () => {}, scanExternalSkills: options.scan ?? (async () => []),
      readSkillText: options.read ?? (async () => ({ content: "# Instructions", truncated: false })),
      listSkillInstallJobs: options.jobs ?? (async () => []),
      getSkillInstallJobStatus: options.status ?? (async () => { throw Error("Unexpected job poll"); }),
      startSkillInstallJob: options.install ?? (async payload => { calls.push(payload); return { jobId: "install", phase: "queued", installed: [], ...payload }; }),
      manageSkill: options.manage ?? (async payload => { calls.push(payload); return { installed: [{ name: "research" }] }; }),
    },
    "../../lib/skills/clawHub": { buildClawHubSkillKey, buildClawHubDownloadUrl: () => "https://example.test/research.zip",
      resolveClawHubSkillOwner: options.resolve ?? (async item => item),
      listClawHubSkills: options.list ?? (async () => ({ items: [card()], nextCursor: null })), searchClawHubSkills: async () => [],
    },
  };
  for (const name of ["Badge", "Banner", "Breadcrumbs", "Button", "CheckboxInput", "Dialog", "EmptyState", "Grid", "hooks", "Icon", "IconButton", "Item", "Layout", "Link", "List", "MetadataList", "ProgressBar", "Selector", "Skeleton", "Spinner", "Stack", "StatusDot", "Switch", "TabList", "Text", "TextInput", "ToggleButton", "Token"]) mocks[`@astryxdesign/core/${name}`] = {};
  mocks["@astryxdesign/core/hooks"] = { useMediaQuery: () => false };
  const loader = createTsModuleLoader({ mocks });
  const { SkillsHubPage } = loader.loadModule("src/pages/skills-hub/SkillsHubPage.tsx");
  const props = { settings, setSettings: update => { settings = update(settings); props.settings = settings; },
    initialSkills: options.initial ?? [skill("research"), skill("creative"), skill("skills-creator")],
    initialRootDir: "/skills", isAgentMode: true, sidebarOpen: false, onOpenSidebar: () => {} };
  const tree = () => { activeHooks = hooks; return hooks.render(() => SkillsHubPage(props)); };
  const render = () => tree().props;
  render();
  return { render, tree, calls, settings: () => settings, props, timers,
    preview(element) { activeHooks = previewHooks; return previewHooks.render(() => element.type(element.props)); },
    replayPreview: () => previewHooks.replayEffects(),
    unmount() { previewHooks.unmount(); hooks.unmount(); globalThis.window = oldWindow; globalThis.document = oldDocument; globalThis.FileReader = oldReader; } };
}

function surface(options = {}) {
  const hooks = createReactHookHarness(); const calls = [];
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react, "../i18n": { useLocale: () => ({ t }) },
    "../lib/runtimePlatform": { isNativeMobileRuntime: () => options.mobile ?? false },
    "../components/astryx/useConfirmDialog": { useConfirmDialog: () => ({ dialog: null, confirm: async () => options.confirm ?? true }) },
    "./NativeSurface": { NativeSurface: "NativeSurface" }, "./nativeTheme": { createNativePresentationTheme: () => undefined },
    "../lib/system/clipboardText": { writeClipboardText: async text => { calls.push(["copy", text]); } },
    "../lib/skills/clawHub": { buildClawHubSkillKey,
      resolveClawHubSkillOwner: options.resolve ?? (async item => item),
      getClawHubSkillDetail: options.detail ?? (async () => ({ ...card(), supportedOs: ["macos"], supportedSystems: [], latestVersionChangelog: "## Changes" })),
    },
  } });
  const { NativeSkillsHub } = loader.loadModule("src/presentation/NativeSkillsHub.tsx");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const settings = normalizeSettings({ skills: { enabled: true, selected: ["research"] }, theme: "dark" });
  const props = { settings, rootDir: "/skills", view: "installed", loading: false, error: null,
    refresh: async () => {}, onEnabled: () => {}, onOpenSidebar: () => {},
    onView: view => { props.view = view; },
    installed: { items: [skill(), skill("skills-creator")].map(skill => ({ skill, categories: ["research"] })),
      total: 1, selectedCount: 1, selected: new Set(builtin.mergeAlwaysEnabledSkillNames(["research"])),
      query: "", onQuery: () => {}, category: "all", categoryCounts: new Map([["all", 2], ["research", 2]]), onCategory: () => {},
      sort: "name-asc", onSort: () => {}, deleting: null, onToggle: (name, enabled) => calls.push(["toggle", name, enabled]),
      onOpen: item => { props.preview.skill = item; }, onDelete: async item => calls.push(["delete", item.name]),
    },
    bulk: { enabled: false, selection: new Set(), onMode: () => {}, onEnter: () => {}, onToggle: () => {}, onAll: () => {}, onClear: () => {},
      enableCount: 0, disableCount: 0, onEnable: () => {}, deleteNames: [], deletePreview: "", onDelete: async () => {}, undo: null, onUndo: () => {} },
    preview: { skill: null, state: { content: "---\nname: research\ndescription: Search and cite source material\n---\n\n# Instructions\n\n- Do the work", loading: false, truncated: true, error: null, skillFile: skill().skillFile }, onClose: () => { props.preview.skill = null; } },
    store: { items: [card()], query: "", onQuery: () => {}, sort: "downloads", onSort: () => {},
      loading: false, loadingMore: false, error: null, cursor: "next", installedKeys: new Set(), installedSlugs: new Set(), pendingKeys: new Set(), jobsByKey: {}, jobs: {},
      onInstall: async item => calls.push(["install", item.slug]), onLoadMore: async () => calls.push(["load-more"]) },
    import: { scans: [], query: "", onQuery: () => {}, selected: new Set(), installedNames: new Set(),
      loading: false, error: null, progress: null, errors: [], importedCount: null, localImporting: false, toast: null, dismissToast: () => {},
      toggle: () => {}, batchToggle: () => {}, rescan: async () => {}, import: async () => {},
      importLocal: async files => calls.push(["bundle", files]) },
  };
  const render = () => {
    const fragment = hooks.render(() => NativeSkillsHub(props));
    const result = fragment.props.children.find(child => child?.type === "NativeSurface").props;
    validatePresentationDocument({ ...result.document, version: 1, surface: "skills", revision: 1 }, result.handlers);
    return result;
  };
  const action = async (id, value = null, published = render()) => {
    const handler = published.handlers.get(id); assert.ok(handler?.enabled, id); assert.ok(handler.accepts(value), id);
    const result = await handler.run(handler.normalize ? handler.normalize(value) : value);
    render();
    return result;
  };
  render(); return { props, calls, render, action, nodes: () => flatten(render().document.nodes), replay: () => hooks.replayEffects(), unmount: () => hooks.unmount() };
}

test("displayed Skill previews remain interactive after effect replay on both renderers", async () => {
  for (const mobile of [false, true]) {
    const h = surface({ mobile });
    try {
      h.props.preview.skill = skill(); h.render(); h.replay();
      await h.action("skill-preview-enabled", false);
      assert.deepEqual(h.calls.at(-1), ["toggle", "research", false]);
      await h.action("skill-preview-delete");
      assert.deepEqual(h.calls.at(-1), ["delete", "research"]);
    } finally { h.unmount(); }
  }
  const options = { native: true };
  const h = controller(options);
  const elements = value => Array.isArray(value) ? value.flatMap(elements)
    : value?.props ? [value, ...Object.values(value.props).flatMap(elements)] : [];
  try {
    h.render().installed.onOpen(skill());
    options.native = false;
    const preview = elements(h.tree()).find(node => node.type?.name === "InstalledSkillPreviewDrawer");
    assert.ok(preview, "The actual public Skills page supplies the installed preview");
    h.preview(preview); h.replayPreview();
    let dialog = h.preview(preview);
    const copyButton = (element, label) => elements(element).find(node =>
      node.type?.name === "SkillPreviewCopyButton" && node.props.label === label);
    assert.equal(copyButton(dialog, "settings.skillsInstalledPreviewCopyFile").props.value, "",
      "Loading content cannot be copied as a stale file preview");
    await settle();
    const loadedPreview = elements(h.tree()).find(node => node.type?.name === "InstalledSkillPreviewDrawer");
    dialog = h.preview(loadedPreview);
    assert.equal(copyButton(dialog, "settings.skillsInstalledPreviewCopyFile").props.value, "# Instructions");
    assert.equal(copyButton(dialog, "settings.skillsInstalledPreviewCopyDescription").props.value, "Search and cite source material");
    const toggle = elements(dialog).find(node => node.props.onChange && node.props.label === "skills.select: research");
    assert.ok(toggle, "The real installed preview has a working selection switch");
    toggle.props.onChange(true);
    assert.ok(h.settings().skills.selected.includes("research"));
    const header = elements(dialog).find(node => node.type?.name === "CompactDialogHeader");
    header.props.onClose();
    assert.ok(!elements(h.tree()).some(node => node.type?.name === "InstalledSkillPreviewDrawer"));
    h.unmount();
    toggle.props.onChange(false);
    assert.ok(h.settings().skills.selected.includes("research"), "Final disposal still retires Astryx preview callbacks");
  } finally { h.unmount(); }
});

test("native desktop Skills uses shared full controller and merges rapid toggles against current settings", () => {
  const h = controller();
  try {
    const published = h.render();
    published.installed.onToggle("research", true); published.installed.onToggle("creative", true);
    assert.ok(h.settings().skills.selected.includes("research")); assert.ok(h.settings().skills.selected.includes("creative"));
    published.installed.onToggle("skills-creator", false); assert.ok(h.settings().skills.selected.includes("skills-creator"));
    h.render().installed.onSort("name-desc");
    assert.deepEqual(h.render().installed.items.map(item => item.skill.name), ["skills-creator", "research", "creative"]);
  } finally { h.unmount(); }
});

test("bulk undo restores only changed skills and retains selections made after the batch", () => {
  const h = controller();
  try {
    h.render().bulk.onEnter("research"); h.render().bulk.onEnable(true);
    h.render().installed.onToggle("creative", true); h.render().bulk.onUndo();
    assert.ok(!h.settings().skills.selected.includes("research")); assert.ok(h.settings().skills.selected.includes("creative"));
    assert.deepEqual(undoSkillSelection(["unrelated"], { selected: ["research"], names: ["research"], enabled: true, count: 1 }), ["unrelated"]);
  } finally { h.unmount(); }
});

test("failed and obsolete refreshes retain good installed skills and only newest discovery publishes", async () => {
  const older = deferred(), latest = deferred(); let count = 0;
  const h = controller({ discover: async () => { count++; if (count === 1) return older.promise; if (count === 2) return latest.promise; throw Error("scan failed"); } });
  try {
    const a = h.render().refresh(), b = h.render().refresh();
    latest.resolve({ rootDir: "/new", skills: [skill("new")] }); await b;
    older.resolve({ rootDir: "/old", skills: [skill("old")] }); await a;
    assert.equal(h.render().rootDir, "/new"); await h.render().refresh();
    assert.equal(h.render().installed.items[0].skill.name, "new"); assert.equal(h.render().error, "scan failed");
  } finally { h.unmount(); }
});

test("local skill bundle action preserves nested binary files and dispatches import_bundle once", async () => {
  const pending = deferred(); const calls = [];
  const h = controller({ manage: async payload => { calls.push(payload); return pending.promise; } });
  try {
    const files = decodeNativeSkillBundle(JSON.stringify([{ path: "my-skill/SKILL.md", contentBase64: Buffer.from("# Work").toString("base64") },
      { path: "my-skill/assets/icon.bin", contentBase64: Buffer.from([0, 255, 128]).toString("base64") }]));
    const published = h.render(); const first = published.import.importLocal(files); const repeated = published.import.importLocal(files);
    await settle(); assert.equal(calls.length, 1); assert.equal(calls[0].action, "import_bundle"); assert.equal(calls[0].conflict, "backup");
    assert.deepEqual(calls[0].files.map(file => file.path), ["my-skill/SKILL.md", "my-skill/assets/icon.bin"]);
    assert.deepEqual([...Buffer.from(calls[0].files[1].contentBase64, "base64")], [0, 255, 128]);
    pending.resolve({ installed: [{ name: "my-skill" }] }); await Promise.all([first, repeated]); assert.equal(h.render().import.importedCount, 1);
  } finally { h.unmount(); }
});

test("external imports stop queuing after disposal and reject repeated clicks before a render", async () => {
  const pending = deferred(), calls = [];
  const external = [skill("external-one"), skill("external-two")];
  const h = controller({ scan: async () => [{ tool: "codex", exists: true, rootDir: "/codex", skills: external, errors: [] }],
    manage: async payload => { calls.push(payload); return pending.promise; } });
  h.render().onView("import"); h.render(); await settle();
  h.render().import.batchToggle(external.map(item => item.baseDir), true);
  const published = h.render(), first = published.import.import(), repeated = published.import.import();
  assert.equal(calls.length, 1); h.unmount(); pending.resolve({}); await Promise.all([first, repeated]); assert.equal(calls.length, 1);
});

test("native skill bundle decoder rejects traversal, duplicate names, malformed data and bounded payloads", () => {
  for (const path of ["../SKILL.md", "/SKILL.md", "C:\\SKILL.md", "a/../SKILL.md", "a//SKILL.md", "a\0.md"]) {
    assert.throws(() => decodeNativeSkillBundle(JSON.stringify([{ path, contentBase64: "" }])), /path/);
  }
  assert.throws(() => decodeNativeSkillBundle(JSON.stringify([{ path: "SKILL.md", contentBase64: "invalid!" }])), /Invalid/);
  assert.throws(() => decodeNativeSkillBundle(JSON.stringify(Array.from({ length: 513 }, (_, i) => ({ path: `${i}.md`, contentBase64: "" })))), /selection/);
  assert.throws(() => decodeNativeSkillBundle(JSON.stringify([{ path: "SKILL.md", contentBase64: "" }, { path: "SKILL.md", contentBase64: "" }])), /path/);
  assert.throws(() => decodeNativeSkillBundle(JSON.stringify([{ path: "large.bin", contentBase64: Buffer.alloc(32 * 1024 * 1024 + 1).toString("base64") }])), /32 MiB/);
});

test("native Skills exposes three functional tabs, builtin locks, confirmed delete and complete preview", async () => {
  const h = surface();
  try {
    assert.equal(h.render().document.formFactor, "desktop"); assert.equal(h.render().document.appearance, "dark");
    assert.equal(h.nodes().find(node => node.id === "skill-hub-view").options.length, 3);
    const builtinNode = h.nodes().find(node => node.id === "skill:skills/skills-creator:skills-creator:enabled"); assert.equal(builtinNode.disabled, true);
    assert.ok(!h.nodes().some(node => node.id === "skill:skills/skills-creator:skills-creator:delete"));
    await h.action("skill:skills/research:research:delete"); assert.deepEqual(h.calls[0], ["delete", "research"]);
    await h.action("skill:skills/research:research:preview");
    assert.equal(h.nodes().find(node => node.id === "skill-preview-content").kind, "Markdown");
    assert.match(h.nodes().find(node => node.id === "skill-preview-content").text, /Instructions/);
    assert.ok(h.nodes().some(node => node.id === "skill-preview-truncated"));
    assert.equal(h.nodes().find(node => node.id === "skill-preview:directory").text, "skills/research");
    await h.action("skill-preview-copy-content"); assert.match(h.calls.at(-1)[1], /Do the work/);
    await h.action("close"); assert.equal(h.props.preview.skill, null);
  } finally { h.unmount(); }
  const denied = surface({ confirm: false }); await denied.action("skill:skills/research:research:delete"); assert.equal(denied.calls.length, 0); denied.unmount();
});

test("native store shows real job progress/errors and loads actual owner details and changelog", async () => {
  const h = surface();
  try {
    await h.action("skill-hub-view", "store"); const key = buildClawHubSkillKey(card());
    h.props.store.jobsByKey[key] = "job"; h.props.store.jobs.job = { jobId: "job", phase: "downloading", downloadedBytes: 40, totalBytes: 100 };
    assert.equal(h.nodes().find(node => node.id === `skill-store:${key}:progress`).current, 40);
    assert.equal(h.render().handlers.get(`skill-store:${key}:install`).enabled, false);
    h.props.store.jobs.job = { ...h.props.store.jobs.job, phase: "error", error: "Network failed" };
    assert.equal(h.nodes().find(node => node.id === `skill-store:${key}:error`).label, "Network failed");
    await h.action(`skill-store:${key}:install`); assert.deepEqual(h.calls.at(-1), ["install", "research"]);
    await h.action(`skill-store:${key}:preview`); h.render(); await settle();
    assert.equal(h.nodes().find(node => node.id === "skill-store-changelog").kind, "Markdown");
    assert.equal(h.nodes().find(node => node.id === "skill-store-detail:os").text, "macos");
    await h.action("skill-store-preview-close");
    h.props.store.items = [{ ...card(), summary: "Generate art", topics: ["creative"] }];
    await h.action("skill-store-category", "research"); assert.deepEqual(h.calls.at(-1), ["load-more"]);
  } finally { h.unmount(); }
});

test("native import presents scanned paths, partial failures and folder/file options wired to real bundles", async () => {
  const h = surface();
  try {
    h.props.view = "import"; h.props.import.scans = [{ tool: "codex", exists: true, rootDir: "/codex/skills", skills: [skill()], errors: ["Malformed skill"] }];
    h.props.import.errors = [{ name: "broken", baseDir: "/broken", message: "Permission denied" }];
    h.props.import.importedCount = 3;
    const picker = h.nodes().find(node => node.id === "skill-bundle-picker"); assert.equal(picker.variant, "skill-bundle");
    assert.deepEqual(picker.options.map(item => item.value), ["folder", "files"]);
    assert.ok(h.nodes().some(node => node.id === "skill-import-unparsable")); assert.match(h.nodes().find(node => node.id === "skill-import-done").label, /3/);
    await h.action("skill-bundle-picker", JSON.stringify([{ path: "research/SKILL.md", contentBase64: Buffer.from("hello").toString("base64") }]));
    assert.equal(h.calls.at(-1)[1][0].webkitRelativePath, "research/SKILL.md");
    h.props.import.localImporting = true; assert.equal(h.render().handlers.get("skill-bundle-picker").enabled, false);
  } finally { h.unmount(); }
});

test("retired native store previews do not fetch or publish obsolete details", async () => {
  const pending = deferred(); let reads = 0;
  const h = surface({ resolve: () => pending.promise, detail: async () => { reads++; return {}; } });
  h.props.view = "store"; const key = buildClawHubSkillKey(card()); await h.action(`skill-store:${key}:preview`);
  h.render(); await h.action("close"); h.render(); pending.resolve(card()); await settle();
  assert.equal(reads, 0); assert.ok(!h.nodes().some(node => node.id === "skill-store-detail-title")); h.unmount();
});

test("active install jobs recover into the native hub and update shared settings when backend reports done", async () => {
  const job = { jobId: "recovered", phase: "downloading", ownerHandle: "author", slug: "research", startedAt: 10, downloadedBytes: 0, totalBytes: 100 };
  const h = controller({ jobs: async () => [job], status: async () => ({ ...job, phase: "done", installed: [{ name: "research" }] }) });
  try {
    await settle(); const recovered = h.render();
    assert.equal(recovered.store.jobsByKey[buildClawHubSkillKey(card())], "recovered");
    for (const callback of [...h.timers.values()]) callback();
    await settle(); assert.ok(h.settings().skills.selected.includes("research"));
    assert.equal(h.render().store.jobs.recovered.phase, "done");
  } finally { h.unmount(); }
});

test("owner resolution after disposal cannot start a new background installation", async () => {
  const pending = deferred(); const h = controller({ resolve: () => pending.promise });
  const request = h.render().store.onInstall(card()); h.unmount(); pending.resolve(card()); await request;
  assert.equal(h.calls.length, 0);
});

test("native JSON skill previews use a readonly code block and keep truncation/errors visible", () => {
  const h = surface({ mobile: true });
  try {
    h.props.preview.skill = { ...skill(), skillFile: "skills/research/skill.json" };
    h.props.preview.state = { ...h.props.preview.state, content: '{"name":"research"}', error: "Source unavailable" };
    const content = h.nodes().find(node => node.id === "skill-preview-content");
    assert.equal(content.kind, "CodeBlock"); assert.equal(content.language, "json"); assert.equal(content.action, undefined);
    assert.equal(h.nodes().find(node => node.id === "skill-preview-error").label, "Source unavailable");
    assert.equal(h.render().document.formFactor, "mobile");
  } finally { h.unmount(); }
});

test("deletion dispatches once before re-render and preserves unrelated settings", async () => {
  const pending = deferred(); let deletes = 0;
  const h = controller({ manage: async payload => { if (payload.action === "delete") deletes++; return pending.promise; } });
  try {
    h.render().installed.onToggle("research", true); h.render().installed.onToggle("creative", true);
    const published = h.render(); const first = published.installed.onDelete(skill()), second = published.installed.onDelete(skill());
    assert.equal(deletes, 1); pending.resolve({}); await Promise.all([first, second]);
    assert.ok(!h.settings().skills.selected.includes("research")); assert.ok(h.settings().skills.selected.includes("creative"));
  } finally { h.unmount(); }
});


test("installed preview exposes real selection and confirmed delete while retired details stay inert", async () => {
  const approval = deferred();
  const h = surface({ confirm: approval.promise });
  try {
    h.props.preview.skill = skill();
    const published = h.render();
    await h.action("skill-preview-enabled", false);
    assert.deepEqual(h.calls.at(-1), ["toggle", "research", false]);
    const deletion = h.action("skill-preview-delete", null, published);
    h.props.preview.skill = skill("another"); h.render();
    approval.resolve(true); await deletion;
    assert.ok(!h.calls.some(call => call[0] === "delete"));
    await published.handlers.get("skill-preview-enabled").run(true);
    assert.equal(h.calls.filter(call => call[0] === "toggle").length, 1);
    h.props.preview.skill = skill("skills-creator");
    assert.equal(h.nodes().find(node => node.id === "skill-preview-enabled").disabled, true);
    assert.ok(!h.nodes().some(node => node.id === "skill-preview-delete"));
  } finally { h.unmount(); }
  const accepted = surface();
  try {
    accepted.props.preview.skill = skill();
    await accepted.action("skill-preview-delete");
    assert.deepEqual(accepted.calls.at(-1), ["delete", "research"]);
    const handler = accepted.render().handlers.get("skill-preview-enabled");
    accepted.unmount(); await handler.run(false);
    assert.equal(accepted.calls.length, 1);
  } finally { accepted.unmount(); }
});
