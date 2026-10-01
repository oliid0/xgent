import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const uiMocks = Object.fromEntries(["AlertDialog", "Banner", "Button", "CheckboxInput", "Collapsible", "Divider", "Grid", "IconButton", "Selector", "Stack", "StatusDot", "Switch", "TextArea", "TextInput", "TimeInput", "Dialog", "Text", "Layout"].map(name => [
  `@astryxdesign/core/${name}`, Object.fromEntries((name === "Text" ? ["Text", "Heading"] : name === "Dialog" ? ["DialogHeader"] : name === "Layout" ? ["HStack", "VStack"] : [name]).map(symbol => [symbol, symbol])),
]));

test("native organizer model, schedule, time, mode and Run Now use the existing reducers and queue", async () => {
  const hooks = createReactHookHarness(), calls = [], queued = [];
  const models = createTsModuleLoader().loadModule("src/lib/providers/runtime/modelValue.ts");
  const loader = createTsModuleLoader({ mocks: {
    ...uiMocks, react: hooks.react,
    "../../../lib/memory/api": {
      formatMemoryError: e => e.message,
      memoryQuotaSummary: async () => ({ scopes: [] }),
      memoryOrganizeRunCreate: async args => { calls.push(args); return { run: { runId: "queued-real" }, accepted: true, alreadyRunning: false }; },
    },
    "./platform": { ...models, canRunOrganizerLocally: true, pokeMemoryOrganizer: () => true },
    "./OrganizerHistoryModal": { OrganizerHistoryModal: "OrganizerHistoryModal" },
    "../../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
  } });
  const { MemorySettingsDrawer } = loader.loadModule("src/pages/settings/memory/MemorySettingsDrawer.tsx");
  const { getDefaultSettings, normalizeCustomProvider } = loader.loadModule("src/lib/settings/index.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  let settings = getDefaultSettings();
  settings.customProviders = [normalizeCustomProvider({ id: "p", type: "codex", models: ["m"], activeModels: ["m"] })];
  const props = { modelOptions: [{ value: "p::m", label: "Provider · Model", providerName: "Provider" }],
    setSettings: update => { settings = update(settings); }, workdir: "/project", saving: false, error: null, notice: null,
    t: key => key, onClose() {}, onRequestWipe() {}, onOrganizerRunQueued: id => queued.push(id), nativeSettingsSurfaceId: "settings-session" };
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout: () => 1, clearTimeout() {} };
  try {
    const render = () => {
      const surface = hooks.render(() => MemorySettingsDrawer({ ...props, settings })).props;
      if (surface.document) validatePresentationDocument({ ...surface.document, version: 1, surface: "memory", revision: 1 }, surface.handlers);
      return surface;
    };
    const change = async (name, value) => {
      const handler = render().handlers.get(name); assert.ok(handler.enabled, name); assert.ok(handler.accepts(value), name);
      await handler.run(value); return render();
    };
    render(); await tick();
    assert.equal(render().handlers.get("memory-organizer-run").enabled, false);
    await change("memory-organizer-model", "p::m");
    await change("memory-summary-model", "p::m");
    await change("memory-organizer-frequency", "weekly");
    await change("memory-organizer-weekday", "4");
    await change("memory-organizer-mode", "aggressive");
    await change("memory-organizer-scope", "projects");
    const time = render().document.nodes.flatMap(n => n.children ?? []).find(n => n.id === "memory-organizer-time");
    assert.equal(time.kind, "TimeInput");
    assert.equal(render().handlers.get("memory-organizer-time").accepts("23:59\n"), false);
    await change("memory-organizer-time", "23:59");
    assert.equal(settings.memory.organizerEnabled, true);
    assert.equal(settings.memory.organizerSchedule.weekday, 4);
    const history = await change("memory-organizer-run", null);
    assert.deepEqual(calls, [{ trigger: "manual", model: { customProviderId: "p", model: "m" }, scope: "projects", mode: "aggressive" }]);
    assert.deepEqual(queued, ["queued-real"]);
    assert.equal(history.nativeSettingsSurfaceId, "settings-session");
    assert.equal(history.settings, settings);
    hooks.unmount();
    assert.equal(settings.memory.organizerSchedule.timeLocal, "23:59", "Unmount flushes the latest time draft");
  } finally { globalThis.window = previousWindow; }
});

function historyHarness(report) {
  const hooks = createReactHookHarness(), calls = [];
  const run = { runId: "run-one", status: "succeeded", trigger: "manual", createdAt: 1000,
    finalSummary: "Verified summary", model: { customProviderId: "p", model: "m" },
    inputCount: 4, clusterCount: 1, safeApplied: 0, reviewSkipped: 0, createdCount: 0,
    updatedCount: 0, deletedCount: 0, parseFailures: 0, report };
  let runs = [run], changed = 0;
  const loader = createTsModuleLoader({ mocks: {
    ...uiMocks, react: hooks.react, "./platform": {},
    "../../../lib/memory/api": {
      formatMemoryError: e => e.message,
      memoryOrganizeRunList: async args => { calls.push(["list", args]); return { runs }; },
      memoryOrganizeRunRead: async () => run,
      memoryOrganizeRunClearHistory: async () => { calls.push(["clear"]); runs = []; return { retainedActiveCount: 0 }; },
      memoryApplyBatch: async args => { calls.push(["apply", args]); return { created: ["safe"], updated: [], deleted: [], warnings: [] }; },
      memoryOrganizeRunUpdate: async args => { calls.push(["update", args]); Object.assign(run, args); },
    },
    "../../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => false },
  } });
  const { OrganizerHistoryModal } = loader.loadModule("src/pages/settings/memory/OrganizerHistoryModal.tsx");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const render = () => {
    const surface = hooks.render(() => OrganizerHistoryModal({ settings: { theme: "light" }, t: key => key, onClose() {},
      onMemoryChanged: () => changed++, nativeSettingsSurfaceId: "history-session" })).props;
    validatePresentationDocument({ ...surface.document, version: 1, surface: "history", revision: 1 }, surface.handlers);
    return surface;
  };
  const dispatch = async (id, value = null) => { const h = render().handlers.get(id); assert.ok(h.enabled, id); assert.ok(h.accepts(value), id); await h.run(value); await tick(); return render(); };
  return { render, dispatch, calls, unmount: () => hooks.unmount(), get changed() { return changed; } };
}

test("native history renders legacy evidence read-only and clears only after confirmation", async () => {
  const h = historyHarness({ clusterSummaries: ["Legacy cluster"], reviewNotes: ["Legacy note"] });
  h.render(); await tick();
  assert.ok(JSON.stringify(h.render().document).includes("Legacy note"));
  assert.equal(h.render().handlers.has("memory-history-apply"), false);
  await h.dispatch("memory-history-clear"); assert.equal(h.calls.some(([name]) => name === "clear"), false);
  await h.dispatch("memory-history-cancel");
  await h.dispatch("memory-history-clear"); await h.dispatch("memory-history-confirm-action");
  assert.equal(h.calls.filter(([name]) => name === "clear").length, 1);
  assert.equal(h.render().document.formFactor, "desktop"); h.unmount();
});

test("native history applies selected v4 decisions through the same batch/report update path", async () => {
  const safe = { op: "upsert", slug: "safe", scope: "global", memoryType: "user", body: "Remember this", riskLevel: "low", confidence: 0.9 };
  const h = historyHarness({ version: 4, clusterSummaries: ["Cluster"], reviewItems: [], raw: [], safeDecisions: [safe],
    manualApplyState: { status: "pending", appliedDecisionKeys: [], failedDecisionKeys: [] } });
  h.render(); await tick();
  assert.equal(h.render().handlers.get("memory-history-apply").enabled, true);
  await h.dispatch("memory-decision-select:0", false);
  assert.equal(h.render().handlers.get("memory-history-apply").enabled, false);
  await h.dispatch("memory-decision-select:0", true); await h.dispatch("memory-history-apply");
  assert.deepEqual(h.calls.find(([name]) => name === "apply")[1].decisions, [safe]);
  const update = h.calls.find(([name]) => name === "update")[1];
  assert.equal(update.safeApplied, 1); assert.equal(update.report.manualApplyState.status, "applied");
  assert.equal(h.changed, 1);
  assert.equal(h.render().handlers.get("memory-history-apply").enabled, false); h.unmount();
});

test("shared history keeps the latest requested selection and retires earlier filter reads", async () => {
  const hooks = createReactHookHarness();
  const firstRead = Promise.withResolvers(), failedList = Promise.withResolvers();
  const runs = [{ runId: "first", status: "succeeded" }, { runId: "second", status: "succeeded" }];
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../../../lib/memory/api": {
      formatMemoryError: e => e.message,
      memoryOrganizeRunList: async args => args.status === "failed" ? failedList.promise : { runs },
      memoryOrganizeRunRead: async args => args.runId === "first" ? firstRead.promise :
        { runId: args.runId, status: args.runId === "failed" ? "failed" : "succeeded" },
    },
  } });
  const { useOrganizeRunHistory } = loader.loadModule("src/pages/settings/memory/useMemoryPanelData.ts");
  let filter = "all";
  const render = () => hooks.render(() => useOrganizeRunHistory({ statusFilter: filter }));
  render(); await tick();
  await render().reload("second");
  assert.equal(render().selectedRun.runId, "second");
  firstRead.resolve(runs[0]); await tick();
  assert.equal(render().selectedRun.runId, "second", "Earlier initial selection must not overwrite the user");
  const oldReload = render().reload("first");
  filter = "failed"; render();
  await oldReload; assert.equal(render().loading, true);
  failedList.resolve({ runs: [{ runId: "failed", status: "failed" }] }); await tick();
  assert.equal(render().selectedRun.runId, "failed"); assert.equal(render().loading, false);
  const retired = render(); hooks.unmount();
  await retired.reload("second"); assert.equal(render().selectedRun.runId, "failed");
});
