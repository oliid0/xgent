import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const manifest = {
  protocolVersion: 1, schemaVersion: 1, snapshotId: "snapshot", createdAt: "2026-09-30T10:00:00Z",
  deviceName: "Other desktop", appVersion: "0.1", encryption: "none",
  domains: { providers: 2, mcp: 3, system: 1, skills: 4 },
};
const saved = {
  url: "https://dav.example.com/dav/", username: "user", hasPassword: true,
  remoteDir: "xgent", profile: "default", autoSync: false, lastSyncAt: null, lastError: null,
};

function harness(options = {}) {
  const hooks = createReactHookHarness();
  const calls = [], confirmations = [];
  let config = { ...saved, ...options.config }, listener, stops = 0, backs = 0, reloads = 0;
  const invoke = async (command, args) => {
    calls.push([command, args]);
    if (options.commands?.[command]) return options.commands[command](args);
    switch (command) {
      case "settings_backup_load_sync_config": return { ...config };
      case "settings_backup_save_sync_config": {
        const { password, passwordTouched, ...fields } = args.config;
        config = { ...config, ...fields, hasPassword: passwordTouched ? !!password : config.hasPassword };
        return { ...config };
      }
      case "settings_backup_test_sync_connection": return;
      case "settings_backup_fetch_remote_info": return options.remote === null ? null : { manifest, size: 100, sha256: "digest" };
      case "settings_backup_upload": return 1800000000000;
      case "settings_backup_download":
      case "settings_backup_apply_import": return { applied: manifest.domains, skills: { enabled: false }, backupPath: "/old.backup" };
      case "settings_backup_export": return "/export.backup";
      case "settings_backup_peek_import": return { manifest, path: "/import.backup" };
      default: throw new Error(`Unexpected backup command ${command}`);
    }
  };
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "@xgent/runtime": { invoke, listen: async (_name, callback) => {
      listener = callback;
      if (options.listen) return options.listen(() => stops++);
      return () => stops++;
    } },
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => options.mobile !== false },
    "../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
  } });
  const { useBackupSyncData } = loader.loadModule("src/pages/settings/useBackupSyncData.ts");
  const { NativeBackupSyncSection } = loader.loadModule("src/pages/settings/NativeBackupSyncSection.tsx");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  let settings = getDefaultSettings(), data;
  const props = {
    get settings() { return settings; },
    setSettings: updater => { settings = updater(settings); },
    reloadSettings: async () => { reloads++; },
    nativeSettingsSurfaceId: "settings-backup",
  };
  const render = () => {
    const surface = hooks.render(() => {
      data = useBackupSyncData(props, async value => {
        confirmations.push(value);
        return options.confirm ? options.confirm(value) : true;
      }, key => key);
      return NativeBackupSyncSection({ ...props, data, onBack: () => backs++ });
    }).props;
    validatePresentationDocument({ ...surface.document, version: 1, surface: "settings-backup", revision: 1 }, surface.handlers);
    return surface;
  };
  const dispatch = async (id, value = null) => {
    const handler = render().handlers.get(id);
    assert.ok(handler, id); assert.equal(handler.enabled, true, `${id} is enabled`);
    assert.equal(handler.accepts(value), true, `${id} accepts payload`);
    await handler.run(value); await tick(); return render();
  };
  return { render, dispatch, calls, confirmations, unmount: () => hooks.unmount(), replay: () => hooks.replayEffects(),
    event: payload => listener({ payload }), get stops() { return stops; }, get reloads() { return reloads; },
    get backs() { return backs; }, get data() { return data; }, get settings() { return settings; } };
}
const count = (h, command) => h.calls.filter(([name]) => name === `settings_backup_${command}`).length;

test("native backup retains settings surface, secure input, presets and desktop-only local commands", async () => {
  for (const mobile of [true, false]) {
    const h = harness({ mobile }); h.render(); await tick(); const s = h.render();
    assert.equal(s.sessionSurface, "settings-backup");
    assert.equal(s.document.formFactor, mobile ? "mobile" : "desktop");
    assert.equal(s.document.dismissAction, "backup-back");
    const connection = s.document.nodes.find(node => node.id === "backup-connection");
    const fields = connection.children.find(node => node.variant === "backup-connection-fields").children;
    assert.equal(fields.find(node => node.id === "backup-password").secure, true);
    assert.equal(fields.find(node => node.id === "backup-preset").options.length, 4);
    assert.equal(s.handlers.has("backup-import"), !mobile);
    assert.equal(s.handlers.has("backup-export"), !mobile);
    await h.data.handleImport(); await h.data.handleExport();
    assert.equal(count(h, "peek_import"), mobile ? 0 : 1);
    assert.equal(count(h, "export"), mobile ? 0 : 1);
    await h.dispatch("backup-back"); assert.equal(h.backs, 1); h.unmount();
  }
});

test("failed backup load is visible and cannot overwrite unknown configuration before successful retry", async () => {
  let failed = true;
  const h = harness({ commands: { settings_backup_load_sync_config: async () => {
    if (failed) throw new Error("keychain unavailable"); return { ...saved };
  } } });
  h.render(); await tick(); const s = h.render();
  assert.ok(JSON.stringify(s.document).includes("keychain unavailable"));
  assert.equal(s.handlers.get("backup-retry").enabled, true);
  assert.equal(s.handlers.get("backup-save-connection").enabled, false);
  h.data.patchForm({ url: "must not save" }); await h.data.handleSaveSync();
  assert.equal(count(h, "save_sync_config"), 0);
  failed = false; await h.dispatch("backup-retry");
  assert.equal(h.data.form.url, saved.url); assert.equal(h.data.locked, false); h.unmount();
});

test("unsaved changes block stale handlers synchronously and saving keeps the stored password private", async () => {
  const h = harness(); h.render(); await tick(); h.render(); const before = h.data;
  before.patchForm({ url: "https://other.example.com/dav/" });
  await before.handleUpload(); await before.handleTestSync();
  assert.equal(count(h, "fetch_remote_info"), 0); assert.equal(count(h, "test_sync_connection"), 0);
  await before.handleSaveSync(); h.render();
  const request = h.calls.find(([name]) => name === "settings_backup_save_sync_config")[1].config;
  assert.equal(request.url, "https://other.example.com/dav/");
  assert.equal(request.password, ""); assert.equal(request.passwordTouched, false);
  assert.equal(h.data.dirty, false); assert.equal(h.data.form.password, "");
  assert.equal(count(h, "test_sync_connection"), 1); h.unmount();
});

test("clearing the stored password is explicit and does not report a successful authenticated test", async () => {
  const h = harness(); h.render(); await tick();
  await h.dispatch("backup-clear-password");
  assert.equal(h.data.form.passwordTouched, true);
  assert.equal(h.render().handlers.get("backup-upload").enabled, false);
  await h.dispatch("backup-save-connection");
  const request = h.calls.find(([name]) => name === "settings_backup_save_sync_config")[1].config;
  assert.equal(request.password, ""); assert.equal(request.passwordTouched, true);
  assert.equal(h.data.syncView.hasPassword, false);
  assert.equal(count(h, "test_sync_connection"), 0);
  assert.equal(h.data.syncStatus.text, "settings.backupSyncSaveDone"); h.unmount();
});

test("auto-sync confirmation locks Save and cancellation cannot persist an unapproved opt-in", async () => {
  for (const approved of [false, true]) {
    const pause = deferred(), h = harness({ confirm: () => pause.promise });
    h.render(); await tick(); h.render(); const data = h.data;
    const pending = data.handleAutoSyncChange(true);
    await data.handleSaveSync(); assert.equal(count(h, "save_sync_config"), 0);
    assert.equal(h.render().handlers.get("backup-save-connection").enabled, false);
    assert.equal(h.data.form.autoSync, false);
    pause.resolve(approved); await pending; h.render();
    assert.equal(h.data.form.autoSync, approved);
    await h.dispatch("backup-save-connection");
    assert.equal(h.calls.find(([name]) => name === "settings_backup_save_sync_config")[1].config.autoSync, approved);
    h.unmount();
  }
});

test("backup upload previews the actual source and prevents duplicate upload while waiting for approval", async () => {
  const pause = deferred(), h = harness({ confirm: () => pause.promise });
  h.render(); await tick(); h.render(); const data = h.data;
  const pending = data.handleUpload(); await tick(); await data.handleUpload(); await data.handleDownload();
  assert.equal(count(h, "fetch_remote_info"), 1);
  assert.ok(h.confirmations[0].description.includes("Other desktop"));
  assert.ok(h.confirmations[0].description.includes("settings.backupDomainProviders 2"));
  pause.resolve(true); await pending; h.render();
  assert.equal(count(h, "upload"), 1); assert.equal(h.data.syncView.lastSyncAt, 1800000000000);
  assert.equal(h.data.syncStatus.kind, "ok"); h.unmount();
});

test("leaving backup during remote inspection or confirmation never launches a destructive operation", async () => {
  for (const phase of ["inspection", "confirmation"]) {
    const pause = deferred();
    const h = harness(phase === "inspection" ? { commands: { settings_backup_fetch_remote_info: () => pause.promise } } : { confirm: () => pause.promise });
    h.render(); await tick(); h.render(); const pending = h.data.handleDownload(); await tick(); h.unmount();
    pause.resolve(phase === "inspection" ? { manifest, size: 10, sha256: "digest" } : true);
    await pending; assert.equal(count(h, "download"), 0);
  }
});

test("confirmed remote restore reloads shared settings even if the backup screen closes after dispatch", async () => {
  const pause = deferred(), h = harness({ commands: { settings_backup_download: () => pause.promise } });
  h.render(); await tick(); h.render(); const pending = h.data.handleDownload(); await tick();
  assert.equal(count(h, "download"), 1); h.unmount();
  pause.resolve({ applied: manifest.domains, skills: { enabled: false }, backupPath: null }); await pending;
  assert.equal(h.reloads, 1); assert.equal(h.settings.skills.enabled, false);
});

test("remote emptiness, overwrite cancellation and saved-but-failed connection are distinct real outcomes", async () => {
  const empty = harness({ remote: null }); empty.render(); await tick();
  await empty.dispatch("backup-download"); assert.equal(count(empty, "download"), 0);
  assert.equal(empty.data.syncStatus.text, "settings.backupSyncRemoteEmpty"); empty.unmount();
  const cancelled = harness({ confirm: async () => false }); cancelled.render(); await tick();
  await cancelled.dispatch("backup-upload"); assert.equal(count(cancelled, "upload"), 0); cancelled.unmount();
  const failure = harness({ commands: { settings_backup_test_sync_connection: async () => { throw new Error("TLS rejected"); } } });
  failure.render(); await tick(); await failure.dispatch("backup-save-connection");
  assert.equal(count(failure, "save_sync_config"), 1); assert.equal(failure.data.dirty, false);
  assert.equal(failure.data.syncStatus.kind, "error"); assert.ok(failure.data.syncStatus.text.includes("TLS rejected")); failure.unmount();
});

test("background sync errors survive draft edits and late listener registration is disposed", async () => {
  const pause = deferred(), h = harness({ listen: stop => pause.promise.then(() => stop) });
  h.render(); await tick(); h.event({ lastSyncAt: null, lastError: "Background offline" });
  let s = h.render(); assert.ok(JSON.stringify(s.document).includes("Background offline"));
  await h.dispatch("backup-profile", "changed");
  assert.equal(h.data.syncView.lastError, "Background offline");
  h.event({ lastSyncAt: 1800000000000, lastError: null }); s = h.render();
  assert.equal(h.data.form.profile, "changed"); assert.equal(h.data.syncView.lastError, null);
  assert.equal(h.data.syncStatus.text, "settings.backupSyncAutoDone");
  const view = h.data.syncView; h.unmount(); pause.resolve(); await tick(); assert.equal(h.stops, 1);
  h.event({ lastSyncAt: null, lastError: "retired" }); assert.equal(h.data.syncView, view);
});

test("effect replay retires the first config read and keeps only the current settings response", async () => {
  const first = deferred(), second = deferred(); let loads = 0;
  const h = harness({ commands: { settings_backup_load_sync_config: () => (++loads === 1 ? first.promise : second.promise) } });
  h.render(); h.replay(); second.resolve({ ...saved, profile: "current" }); await tick(); h.render();
  first.resolve({ ...saved, profile: "obsolete" }); await tick(); h.render();
  assert.equal(h.data.form.profile, "current"); assert.equal(h.data.operation, null); h.unmount();
});
