import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// Execute actual embedded SQL and TypeScript recovery, not Rust orchestration.
const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const recovery = read("services/automation/store/child_recovery.rs"), children = read("services/automation/store/children.rs");
const journal = read("services/automation/store/journal.rs"), background = read("services/automation/store/background.rs"), lease = read("services/automation/store/lease.rs");
const sql = (text, prefix) => {
  const found = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(m => m[1].trimStart().replace(/\s+/g, " ").startsWith(prefix.replace(/\s+/g, " ")));
  assert.ok(found, `Actual SQL missing: ${prefix}`); return found[1];
};
const migration = sql(read("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta");
const candidates = sql(recovery, "SELECT r.execution_id,r.request_json,c.call_id");
const wakeCandidates = sql(recovery, "SELECT w.execution_id,w.wait_id,c.call_id");
const groupMembers = sql(recovery, "SELECT o.call_id,o.arguments_json,CASE WHEN");
const eligibleGroup = (db, id) => {
  const rows = db.prepare(groupMembers).all(id);
  return rows.length > 0 && rows.every(row => Object.values(row)[2] === 1);
};
const prompt = "Create a usable website and retain the deliverable";
const call = { type: "toolCall", id: "child-call", name: "BackgroundTask", arguments: { action: "submit", name: "Website", prompt: "Create and verify website files" } };
const context = { systemPrompt: "Original authorized scope", messages: [{ role: "user", content: prompt, timestamp: 1 }, { role: "assistant", content: [call], stopReason: "toolUse", timestamp: 2 }] };

function fixture(db, id = "parent", issuer = "issuer") {
  db.prepare(sql(background, "INSERT INTO automation_background_tasks")).run(`request-${id}`, id, "{}", 100);
  db.prepare(sql(background, "INSERT INTO automation_cron_runs")).run(id, 100, 200, JSON.stringify({ executionId: id, taskId: id, lease: { attempt: 1, generation: 1, token: "original-token" } }));
  db.prepare("UPDATE automation_cron_runs SET state = 'leased' WHERE execution_id = ?").run(id);
  db.prepare(sql(background, "INSERT INTO automation_background_configuration_bindings")).run(id, "accepted-binding");
  db.prepare(sql(lease, "INSERT INTO automation_background_leases")).run(id, 1, 1, "original-token");
  db.prepare(sql(journal, "INSERT INTO automation_background_checkpoints")).run(id, 1, JSON.stringify(context), 100);
  db.prepare(sql(journal, "INSERT INTO automation_background_operations")).run(id, call.id, call.name, JSON.stringify(call.arguments), 1, 100);
  db.prepare(sql(journal, "INSERT INTO automation_background_operation_leases")).run(id, call.id, 1, 1, "original-token");
  db.prepare(sql(children, "INSERT INTO automation_background_children")).run(id, call.id, `child-${id}`, "original-peer", issuer, '{"name":"Website"}', 100);
}
function database(t) {
  const db = new DatabaseSync(":memory:"); db.exec(migration);
  db.prepare("INSERT INTO automation_meta (key,value) VALUES ('background_worker_id.v1','issuer')").run();
  t.after(() => db.close()); return db;
}
function park(db, id = "parent", callIds) {
  db.prepare(sql(recovery, "INSERT INTO automation_background_waits")).run(`wait-${id}`, id, JSON.stringify({ kind: "native_child_acceptance_recovery", executionId: id, callId: call.id, callIds }), 101);
  db.prepare(sql(recovery, "UPDATE automation_background_leases SET generation")).run(id, 2, "revoked-token");
  db.prepare(sql(recovery, "UPDATE automation_cron_runs SET state = 'waiting'")).run(id, JSON.stringify({ executionId: id, taskId: id, lease: null }), "Native child acceptance unknown; retained original owner");
}
function accept(db, id = "parent", state = "pending") {
  const actual = { requestId: `child-${id}`, hostId: "original-peer", name: "Website", run: { id: "actual-child", taskId: "actual-child", state, success: false } };
  db.prepare(sql(children, "UPDATE automation_background_children SET receipt_json")).run(id, call.id, JSON.stringify(actual), "actual-child", 1, state, 0, +(state === "done"), 0, 110);
  return actual;
}
function wake(db, id = "parent") {
  db.prepare(sql(recovery, "INSERT INTO automation_background_resumptions")).run(`resume-${id}`, id, `wait-${id}`, '{"kind":"native_child_acceptance_recovered"}', 111);
  return db.prepare(sql(recovery, "UPDATE automation_cron_runs SET state = 'pending'")).run(id).changes;
}

test("native parking admission requires original submit call and lease; foreign reservation is present, not safe absence", t => {
  const db = database(t); fixture(db);
  const owns = db.prepare(sql(recovery, "SELECT EXISTS(SELECT 1 FROM automation_background_operation_leases"));
  assert.equal(Object.values(owns.get("parent", call.id, 1, 1, "original-token"))[0], 1);
  assert.equal(Object.values(owns.get("parent", call.id, 1, 1, "invented-token"))[0], 0);
  db.prepare("UPDATE automation_background_children SET issuer_host_id = 'foreign'").run();
  const present = db.prepare(sql(recovery, "SELECT EXISTS(SELECT 1 FROM automation_background_child_operations WHERE execution_id = ?1 AND call_id = ?2)"));
  const owned = db.prepare(sql(recovery, "SELECT EXISTS(SELECT 1 FROM automation_background_child_operations WHERE execution_id = ?1 AND call_id = ?2 AND issuer_host_id"));
  assert.equal(Object.values(present.get("parent", call.id))[0], 1); assert.equal(Object.values(owned.get("parent", call.id))[0], 0);
  db.prepare("UPDATE automation_background_operations SET arguments_json = '{" + '"action":"cancel"' + "}'").run();
  assert.equal(Object.values(owns.get("parent", call.id, 1, 1, "original-token"))[0], 0);
});

test("actual collector distinguishes a live writer from expired/startup recovery and never transfers original child ownership", t => {
  const db = database(t); fixture(db);
  assert.equal(db.prepare(candidates).all(150).length, 0);
  assert.equal(db.prepare(candidates).all(201).length, 1);
  assert.equal(db.prepare(candidates).all(null).length, 1);
  db.prepare("UPDATE automation_background_operation_leases SET token = 'superseded'").run();
  assert.equal(db.prepare(candidates).all(null).length, 0);
  assert.equal(db.prepare("SELECT peer_id FROM automation_background_children").get().peer_id, "original-peer");
});

test("collector and group admission reject cancelled/completed parents, other unknown writes and completed delivery outbox", t => {
  const db = database(t);
  for (const id of ["valid", "cancelled", "finished", "mail", "foreign", "outbox"]) fixture(db, id, id === "foreign" ? "foreign" : "issuer");
  db.prepare("UPDATE automation_cron_runs SET state = 'expired' WHERE execution_id = 'cancelled'").run();
  db.prepare("UPDATE automation_cron_runs SET state = 'done' WHERE execution_id = 'finished'").run();
  db.prepare(sql(journal, "INSERT INTO automation_background_operations")).run("mail", "mail-call", "SendMail", "{}", 1, 101);
  // The same native no-outbox predicate is checked directly; outbox payload
  // validity is tested by the existing completion suite.
  db.prepare("INSERT INTO automation_prompt_completion_outbox (execution_id,input_json,created_at) VALUES ('outbox','{}',101)").run();
  assert.deepEqual(db.prepare(candidates).all(null).filter(row => eligibleGroup(db, row.execution_id)).map(row => row.execution_id), ["valid"]);
});

function sibling(db, id = "parent", callId = "slides-call", { issuer = "issuer", token = "original-token", reserved = true } = {}) {
  const args = { action: "submit", name: "Slides", prompt: "Create and verify slides" };
  db.prepare(sql(journal, "INSERT INTO automation_background_operations")).run(id, callId, call.name, JSON.stringify(args), 1, 100);
  db.prepare(sql(journal, "INSERT INTO automation_background_operation_leases")).run(id, callId, 1, 1, token);
  if (reserved) db.prepare(sql(children, "INSERT INTO automation_background_children")).run(id, callId, `child-${id}-${callId}`, "second-peer", issuer, JSON.stringify(args), 100);
  const saved = JSON.parse(db.prepare("SELECT context_json FROM automation_background_checkpoints WHERE execution_id = ?").get(id).context_json);
  saved.messages[1].content.push({ type: "toolCall", id: callId, name: call.name, arguments: args });
  db.prepare("UPDATE automation_background_checkpoints SET context_json = ? WHERE execution_id = ?").run(JSON.stringify(saved), id);
}

test("parallel child admission requires every unresolved reservation to share the issuer and current writer lease", t => {
  const db = database(t);
  for (const id of ["valid", "foreign", "old-writer", "unreserved", "malformed"]) {
    fixture(db, id);
    sibling(db, id, "slides-call", { issuer: id === "foreign" ? "another-host" : "issuer", token: id === "old-writer" ? "old-token" : "original-token", reserved: id !== "unreserved" });
  }
  db.prepare("UPDATE automation_background_operations SET arguments_json = '{}' WHERE execution_id = 'malformed' AND call_id = 'slides-call'").run();
  for (const id of ["valid", "foreign", "old-writer", "unreserved", "malformed"]) assert.equal(eligibleGroup(db, id), id === "valid", id);
  assert.equal(db.prepare(candidates).all(null).filter(row => row.execution_id === "valid").length, 2);
  assert.deepEqual(db.prepare(groupMembers).all("valid").map(row => row.call_id), [call.id, "slides-call"]);
});

test("group parks once, accepts parking ACK for any original member, and wakes only after every device confirms", t => {
  const db = database(t); fixture(db); sibling(db);
  assert.equal(eligibleGroup(db, "parent"), true);
  const ids = [call.id, "slides-call"];
  park(db, "parent", ids);
  const ack = db.prepare(sql(recovery, "SELECT EXISTS(SELECT 1 FROM automation_background_waits WHERE execution_id"));
  for (const id of ids) assert.equal(Object.values(ack.get("parent", id))[0], 1);
  assert.equal(Object.values(ack.get("parent", "unrelated"))[0], 0);
  accept(db);
  assert.equal(db.prepare(wakeCandidates).all(200).length, 0);
  const actual = { requestId: "child-slides-call", hostId: "second-peer", run: { id: "slides-execution", state: "done", success: false } };
  db.prepare(sql(children, "UPDATE automation_background_children SET receipt_json")).run("parent", "slides-call", JSON.stringify(actual), "slides-execution", 1, "done", 0, 1, 0, 110);
  assert.equal(db.prepare(wakeCandidates).all(200).length, 1);
  assert.equal(wake(db), 1);
  assert.equal(db.prepare(wakeCandidates).all(200).length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_waits").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_resumptions").get().n, 1);
  assert.equal(db.prepare("SELECT success FROM automation_cron_runs").get().success, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_children").get().n, 2);
});

test("missing or foreign group member and unrelated unknown effect cannot gain continuation authority", t => {
  const db = database(t); fixture(db); sibling(db); park(db, "parent", [call.id, "slides-call"]); accept(db);
  db.prepare("UPDATE automation_background_children SET receipt_json = '{}', issuer_host_id = 'foreign' WHERE call_id = 'slides-call'").run();
  assert.equal(db.prepare(wakeCandidates).all(200).length, 0);
  db.prepare("DELETE FROM automation_background_children WHERE call_id = 'slides-call'").run();
  assert.equal(db.prepare(wakeCandidates).all(200).length, 0);
  db.prepare(sql(journal, "INSERT INTO automation_background_operations")).run("parent", "send-mail", "SendMail", "{}", 1, 105);
  const uncertain = sql(journal, "SELECT EXISTS(SELECT 1 FROM automation_background_operations o WHERE o.execution_id");
  assert.equal(Object.values(db.prepare(uncertain).get("parent"))[0], 1);
});

test("uncertain sibling error must match its actual call, tool and boolean markers", t => {
  const db = database(t);
  const valid = { role: "toolResult", toolCallId: "slides-call", toolName: "BackgroundTask", isError: true, details: { outcomeUncertain: true } };
  for (const [index, patch] of [{}, { toolCallId: "other" }, { toolName: "SendMail" }, { isError: 1 }].entries()) {
    const id = `case-${index}`; fixture(db, id); sibling(db, id);
    db.prepare(sql(journal, "UPDATE automation_background_operations SET state = 'returned', result_json = ?3, is_error = ?4")).run(id, "slides-call", JSON.stringify({ ...valid, ...patch }), 1, 105);
    assert.equal(eligibleGroup(db, id), Object.keys(patch).length === 0);
  }
});

test("frozen uncertain child errors qualify, while wrong call/tool/error types do not", t => {
  const db = database(t);
  for (const id of ["valid", "unmarked", "wrong-call", "wrong-tool", "number-error"]) {
    fixture(db, id);
    const receipt = { role: "toolResult", toolCallId: id === "wrong-call" ? "other" : call.id, toolName: id === "wrong-tool" ? "SendMail" : call.name, isError: id === "number-error" ? 1 : true, details: id === "unmarked" ? {} : { outcomeUncertain: true } };
    db.prepare(sql(journal, "UPDATE automation_background_operations SET state = 'returned', result_json = ?3, is_error = ?4")).run(id, call.id, JSON.stringify(receipt), 1, 102);
  }
  assert.deepEqual(db.prepare(candidates).all(null).map(row => row.execution_id), ["valid"]);
});

test("parking is atomic, revokes execution authority and preserves the original model checkpoint/child reservation", t => {
  const db = database(t); fixture(db); db.exec("BEGIN IMMEDIATE"); park(db); db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT state FROM automation_cron_runs").get().state, "leased");
  assert.equal(db.prepare("SELECT generation FROM automation_background_leases").get().generation, 1);
  db.exec("BEGIN IMMEDIATE"); park(db); db.exec("COMMIT");
  assert.equal(db.prepare("SELECT state,lease_expires_at FROM automation_cron_runs").get().state, "waiting");
  assert.equal(db.prepare("SELECT lease_expires_at FROM automation_cron_runs").get().lease_expires_at, null);
  assert.equal(db.prepare("SELECT generation FROM automation_background_leases").get().generation, 2);
  assert.equal(db.prepare("SELECT token FROM automation_background_operation_leases").get().token, "original-token");
  assert.equal(db.prepare("SELECT context_json FROM automation_background_checkpoints").get().context_json, JSON.stringify(context));
  assert.equal(db.prepare("SELECT receipt_json FROM automation_background_children").get().receipt_json, null);
});

test("actual wake selection needs native acceptance, original host, current occurrence and no final completion", t => {
  const db = database(t);
  for (const id of ["valid", "unknown", "foreign", "cancelled", "consumed", "backoff"]) { fixture(db, id); park(db, id); if (id !== "unknown") accept(db, id); }
  db.prepare("UPDATE automation_background_children SET issuer_host_id = 'foreign' WHERE execution_id = 'foreign'").run();
  db.prepare("UPDATE automation_cron_runs SET state = 'expired' WHERE execution_id = 'cancelled'").run();
  wake(db, "consumed"); db.prepare("UPDATE automation_cron_runs SET state = 'waiting' WHERE execution_id = 'consumed'").run();
  db.prepare(sql(recovery, "UPDATE automation_background_waits SET retry_at")).run("backoff", "wait-backoff", 10000);
  assert.deepEqual(db.prepare(wakeCandidates).all(200).map(row => row.execution_id), ["valid"]);
});

test("failed terminal child acceptance still resumes parent once, without marking any parent criteria successful", t => {
  const db = database(t); fixture(db); park(db); accept(db, "parent", "done");
  assert.equal(db.prepare(wakeCandidates).all(200).length, 1); assert.equal(wake(db), 1);
  assert.equal(db.prepare(wakeCandidates).all(200).length, 0);
  assert.equal(db.prepare("SELECT success FROM automation_cron_runs").get().success, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_children").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_outcomes").get().n, 0);
});

for (const parallel of [false, true]) test(`disk reopen and actual restored journal continue ${parallel ? "two" : "one"} acknowledged original calls without any submit callback`, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-child-acceptance-")), file = path.join(directory, "owner.sqlite");
  let db;
  try {
    db = new DatabaseSync(file); db.exec(migration); db.prepare("INSERT INTO automation_meta (key,value) VALUES ('background_worker_id.v1','issuer')").run();
    fixture(db);
    if (parallel) sibling(db);
    park(db, "parent", parallel ? [call.id, "slides-call"] : undefined);
    const actual = accept(db);
    if (parallel) db.prepare(sql(children, "UPDATE automation_background_children SET receipt_json")).run("parent", "slides-call", JSON.stringify({ ...actual, requestId: "child-slides-call", hostId: "second-peer" }), "slides-execution", 1, "pending", 0, 0, 0, 110);
    db.close(); db = new DatabaseSync(file);
    assert.equal(db.prepare(wakeCandidates).all(200).length, 1); wake(db);
    const receipt = { role: "toolResult", toolCallId: call.id, toolName: call.name, isError: false, timestamp: 100, content: [{ type: "text", text: JSON.stringify(actual) }], details: { kind: "background_task", reconciledChildStart: true, result: { peerId: "original-peer", result: actual } } };
    let effects = 0, saved = 0;
    const loader = createTsModuleLoader({ mocks: { "./backend": { backend: {
      async saveBackgroundCheckpoint(_, revision) { return revision; },
      async beginBackgroundOperation(_, id, name, args) {
        const operation = db.prepare("SELECT arguments_json FROM automation_background_operations WHERE execution_id = 'parent' AND call_id = ?").get(id);
        assert.equal(name, call.name); assert.deepEqual(JSON.parse(JSON.stringify(args)), JSON.parse(operation.arguments_json));
        const accepted = db.prepare(sql(children, "SELECT peer_id,receipt_json,issued_at,action FROM automation_background_child_operations")).get("parent", id);
        assert.ok(accepted);
        return { status: "returned", result: { ...receipt, toolCallId: id, details: { ...receipt.details, result: { peerId: accepted.peer_id, result: JSON.parse(accepted.receipt_json) } } } };
      },
      async completeBackgroundOperation() { saved++; },
    } } } });
    const { restoreBackgroundContext } = loader.loadModule("src/lib/automation/backgroundResume.ts");
    const checkpoint = db.prepare("SELECT revision,context_json FROM automation_background_checkpoints").get();
    const restored = restoreBackgroundContext({ revision: checkpoint.revision, context: JSON.parse(checkpoint.context_json) }, prompt, []);
    assert.equal(restored.pendingCalls.length, parallel ? 2 : 1);
    const { createBackgroundExecutionJournal } = loader.loadModule("src/lib/automation/backgroundExecutionJournal.ts");
    const ledger = createBackgroundExecutionJournal("parent", restored.context, new AbortController().signal, { revision: restored.revision, lease: { attempt: 2, generation: 3, token: "22222222-2222-4222-8222-222222222222" }, deferUnconfirmedChildStart: true });
    try {
      for (const pending of restored.pendingCalls) {
        const returned = await ledger.execute(pending, undefined, async () => { effects++; return receipt; });
        assert.equal(returned.toolCallId, pending.id);
        assert.equal(returned.details.result.peerId, pending.id === call.id ? "original-peer" : "second-peer");
        ledger.noteMessage(returned); await ledger.flush();
      }
      assert.equal(effects, 0); assert.equal(saved, 0); assert.equal(ledger.signal.aborted, false);
    } finally { ledger.dispose(); }
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("native registration, worker-only command, startup/expiry collection and GET-only supervisor are connected", () => {
  const commands = read("commands/automation/children.rs"), store = read("services/automation/store.rs"), supervisor = read("services/child_tasks.rs");
  assert.match(read("lib.rs"), /commands::children::automation_background_child_park/);
  assert.match(commands, /window\.label\(\)!="agent-worker"/);
  assert.match(store, /self\.park_expired_child_submissions\(\)\?/); assert.match(store, /self\.park_interrupted_child_submissions\(\)\?/);
  assert.match(supervisor, /resume_ready_background_child_starts/); assert.ok(!supervisor.includes('"automation_background_submit"'));
  assert.match(recovery, /verify_background_binding[\s\S]*?has_uncertain_operations/);
  assert.match(recovery, /has_original_child_tail[\s\S]*?part\["arguments"\] == original/);
});
