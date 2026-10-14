import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const peer = "11111111-1111-4111-8111-111111111111";
const configuration = () => ({ enabled: true, baseUrl: "http://192.168.1.2:28367", remoteWorkdir: "/pc", localWorkdir: "/phone" });
function fixture({ native = true, config = configuration(), resolve = async () => peer, reply = async () => ({ storeId: "original-store", controlVersion: 1 }) } = {}) {
  const calls = [], local = [];
  let captures = 0;
  const loader = createTsModuleLoader({ mocks: {
    "@xgent/runtime": {
      isTauriRuntime: () => native,
      getLanPcCommandHostConfig: () => ({ ...config }),
      invoke: async (command, args) => { local.push({ command, args }); return {}; },
      invokeNative: async (command, args) => {
        calls.push(structuredClone({ command, args }));
        return command === "worker_peer_resolve_endpoint" ? resolve(args) : reply(command, args);
      },
    },
    "../tools/toolCommandPort": { captureToolCommandPort: async () => {
      captures++;
      return { invoke: async (command, args) => { local.push({ command, args }); return {}; } };
    } },
  } });
  return { ...loader.loadModule("src/lib/automation/goalBackend.ts"), calls, local, config, get captures() { return captures; } };
}

test("all Goal controls and artifact reads keep the selected protected PC when the selected address changes", async () => {
  let release;
  const f = fixture({ resolve: () => new Promise(done => { release = done; }) });
  const capturing = f.captureGoalBackend();
  f.config.baseUrl = "http://192.168.1.99:28367";
  release(peer);
  const backend = await capturing;
  const input = { revision: 4, requestId: "same-write", operation: { op: "set_status", id: "fitness", status: "paused" } };
  await backend.snapshot(); await backend.apply(input); await backend.executors();
  await backend.launch({ requestId: "original-launch", goal: { goalId: "fitness", storeId: "original-store", revision: 4 }, peerId: null });
  await backend.activity("fitness"); await backend.artifacts("fitness");
  await backend.artifactContent("fitness", { requestId: "original-work", id: "slides" });
  assert.deepEqual(f.calls[0], { command: "worker_peer_resolve_endpoint", args: { base_url: "http://192.168.1.2:28367" } });
  assert.deepEqual(f.calls.slice(1).map(call => call.args.command), ["automation_goal_snapshot", "automation_goal_apply", "automation_goal_executors", "automation_goal_launch", "automation_goal_activity", "automation_goal_artifacts", "automation_goal_artifact_content"]);
  assert.ok(f.calls.slice(1).every(call => call.command === "worker_peer_invoke" && call.args.peer_id === peer && !Object.hasOwn(call.args, "base_url")));
  assert.deepEqual(f.calls[2].args.args, { input: { ...input, storeId: "original-store" } });
  assert.deepEqual(f.calls.at(-1).args.args, { goal_id: "fitness", request_id: "original-work", artifact_id: "slides" });
  assert.equal(f.captures, 0); assert.equal(f.local.length, 0);
});

test("lost Goal writes make one invocation and an explicit retry uses the same peer and receipt", async () => {
  let attempts = 0;
  const f = fixture({ reply: async (_command, args) => {
    if (args.command === "automation_goal_snapshot") return { storeId: "original-store", controlVersion: 1 };
    if (++attempts === 1) throw new Error("ACK lost"); return { revision: 5 };
  } });
  const backend = await f.captureGoalBackend();
  await backend.snapshot();
  const input = { revision: 4, requestId: "same-write", operation: { op: "delete", id: "goal" } };
  await assert.rejects(backend.apply(input), /ACK lost/);
  assert.equal(attempts, 1); assert.equal(f.local.length, 0);
  f.config.baseUrl = "http://other-pc:28367";
  await backend.apply(input);
  assert.deepEqual(f.calls[2], f.calls[3]); assert.equal(f.calls.filter(call => call.command === "worker_peer_resolve_endpoint").length, 1);
});

test("legacy and replaced Goal stores cannot receive edits intended for the original store", async () => {
  const input = { revision: 0, requestId: "same-write", operation: { op: "delete", id: "goal" } };
  const old = fixture({ reply: async () => ({ storeId: "old-store" }) }), legacy = await old.captureGoalBackend();
  await legacy.snapshot();
  assert.throws(() => legacy.apply(input), /refreshRequired/);
  assert.equal(old.calls.length, 2);
  let replaced = false;
  const f = fixture({ reply: async () => ({ storeId: replaced ? "replacement-store" : "original-store", controlVersion: 1 }) });
  const backend = await f.captureGoalBackend(); await backend.snapshot();
  replaced = true; await assert.rejects(backend.snapshot(), /ownerChanged/);
  await backend.apply(input);
  assert.equal(f.calls.at(-1).args.args.input.storeId, "original-store");
  assert.equal(input.storeId, undefined);
});

test("missing or ambiguous protected pairings and malformed native identities cannot fall through to another host", async () => {
  for (const resolve of [async () => { throw new Error("Pair this computer"); }, async () => { throw new Error("ambiguous identity"); }, async () => "192.168.1.2", async () => null]) {
    const f = fixture({ resolve });
    await assert.rejects(f.captureGoalBackend());
    assert.equal(f.calls.length, 1); assert.equal(f.captures, 0); assert.deepEqual(f.local, []);
  }
});

test("local native and paired browser Goal stores retain the existing command port", async () => {
  for (const options of [{ native: false }, { config: { enabled: false, baseUrl: "" } }, { config: { enabled: true, baseUrl: "http://pc:28367" } }]) {
    const f = fixture(options), backend = await f.captureGoalBackend();
    await backend.snapshot(); await backend.activity("goal");
    assert.equal(f.calls.length, 0); assert.equal(f.captures, 1);
    assert.deepEqual(f.local.map(call => call.command), ["automation_goal_snapshot", "automation_goal_activity"]);
  }
});

test("native Goal routes share authenticated LAN-first probes, retire removed pairings and never replay a failed operation", () => {
  const registry = readFileSync(new URL("../../src-tauri/src/services/worker_peers.rs", import.meta.url), "utf8");
  const invoke = registry.slice(registry.indexOf("pub async fn invoke("), registry.indexOf("pub async fn invoke_file("));
  for (const command of ["snapshot", "apply", "executors", "launch", "activity", "artifacts", "artifact_content"]) assert.ok(invoke.includes(`"automation_goal_${command}"`));
  assert.match(invoke, /Self::probe_entry\(&stored, &clients\)/);
  assert.match(invoke, /let \(current, _\) = self.entry\(peer_id\).await\?/);
  assert.match(invoke, /known.base_url == endpoint.base_url && known.session_id == endpoint.session_id/);
  assert.equal(invoke.match(/client.invoke\(/g).length, 1);
  assert.match(invoke, /filter\(\|_\| command.starts_with\("automation_background_"\)\)/);
  const lib = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.equal(lib.split("commands::lan_pc::worker_peer_resolve_endpoint,").length - 1, 2);
});

test("native IPC argument casing matches the real task, file and event callers while pairing retains camelCase", () => {
  const commands = readFileSync(new URL("../../src-tauri/src/commands/integration/lan_pc.rs", import.meta.url), "utf8");
  for (const name of ["worker_peer_probe", "worker_peer_resolve_request", "worker_peer_resolve_endpoint", "worker_peer_invoke", "worker_peer_file_invoke", "worker_peer_forget", "lan_pc_invoke", "lan_pc_subscribe", "lan_pc_unsubscribe"]) {
    assert.ok(commands.includes(`#[tauri::command(rename_all = "snake_case")]\npub async fn ${name}(`) || commands.includes(`#[tauri::command(rename_all = "snake_case")]\r\npub async fn ${name}(`), name);
  }
  assert.match(commands, /#\[tauri::command\]\s+pub async fn lan_pc_pair\(/);
});
