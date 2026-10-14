import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader({ mocks: {
  "./browser/browserSessionController": { normalizeBrowserAddress: value => value },
} });
const { tailscaleStatusText } = loader.loadModule("src/lib/localAccess.ts");
const t = key => key === "settings.tailscaleChecked" ? "Checked: {time}" : key;
test("all native setup actions use the sole embedded engine without an installer or process fallback", () => {
  const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
  const commands = read("commands/integration/tailscale.rs");
  assert.equal((commands.match(/window.label\(\)!="main"/g) ?? []).length, 3);
  assert.match(commands, /embedded_tailnet::authenticate\(input\).await/);
  assert.match(commands, /embedded_tailnet::logout\(\).await/);
  assert.doesNotMatch(commands, /install|open_url|process::Command/);
  const status = read("services/tailscale_status.rs"), auth = read("services/tailscale_setup.rs");
  assert.match(status, /embedded_tailnet::observe\(\).await/);
  assert.doesNotMatch(status + auth, /process::Command|executable\(|observe_installed|tempfile|pkexec/);
  assert.doesNotMatch(read("services/mod.rs"), /mod tailscale_install|mod tailscale_credentials/);
});
test("both settings surfaces describe actual client observations without inferring worker readiness", () => {
  assert.equal(tailscaleStatusText(undefined, t), "settings.tailscaleUnknown");
  assert.equal(tailscaleStatusText({ state: "unsupported", addresses: ["private"], observedAt: 0 }, t), "settings.tailscaleUnknown");
  assert.equal(tailscaleStatusText({ state: "offline", addresses: ["100.70.1.2"], observedAt: 0 }, t), "settings.tailscaleOffline");
  assert.equal(tailscaleStatusText({ state: "userspace", addresses: ["100.70.1.2"], observedAt: 0 }, t), "settings.tailscaleUnknown");
  const observed = tailscaleStatusText({ state: "running", addresses: ["100.70.1.2", "fd7a:115c:a1e0::1"], observedAt: 1720000000000 }, t);
  assert.match(observed, /settings.tailscaleRunning · 100.70.1.2 · fd7a:115c:a1e0::1 · Checked:/);
  assert.doesNotMatch(observed, /ready|paired|direct|relay/i);
  for (const malformed of [{}, { state: 4 }, { state: null }]) {
    assert.equal(tailscaleStatusText(malformed, t), "settings.tailscaleUnknown");
  }
});

test("Apple, compact and wide settings use the same local setup controller and observed status formatter", () => {
  for (const file of ["presentation/tailscaleSetupNodes.ts", "pages/settings/TailscaleSetupSection.tsx"]) {
    const source = readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");
    assert.match(source, /tailscaleStatusText\(/);
    assert.doesNotMatch(source, /settings.tailscaleHint|settings.tailscaleTagsHint|settings.tailscaleSystemApproval/);
    assert.match(source, /setup.refresh/);
  }
  for (const file of ["pages/settings/CompactAccessSettingsForm.tsx", "pages/settings/AccessSection.tsx"])
    assert.match(readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8"), /<TailscaleSetupSection enabled=\{!browser\}/);
  assert.match(readFileSync(new URL("../../src/presentation/nativeAccessSettings.ts", import.meta.url), "utf8"), /useTailscaleSetup\(enabled, mobile\)/);
});
