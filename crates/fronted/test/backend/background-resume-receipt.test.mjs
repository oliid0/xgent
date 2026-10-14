import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Actual embedded SQL is executed. Rust command/UUID/JSON validation is
// inspected in source; no native execution or model/device acceptance claim.
const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const dbSource = read("services/automation/db.rs");
const waiting = read("services/automation/store/waiting.rs");
const background = read("services/automation/store/background.rs");
const sql = (source, prefix) => {
  const found = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)]
    .find(match => match[1].trimStart().replace(/\s+/g, " ").startsWith(prefix.replace(/\s+/g, " ")));
  assert.ok(found, `Production SQL missing: ${prefix}`); return found[1];
};
const schema = sql(dbSource, "CREATE TABLE IF NOT EXISTS automation_meta");
const input = { requestId: "22222222-2222-4222-8222-222222222222", waitId: "33333333-3333-4333-8333-333333333333",
  resumeId: "66666666-6666-4666-8666-666666666666", response: "Tomorrow 10:00, as specified in the original request." };
const lookup = (db, value = input) => db.prepare(sql(waiting, "SELECT s.execution_id,s.input_json,s.created_at")).get(value.resumeId, value.requestId);
function parent(db) {
  db.prepare(sql(background, "INSERT INTO automation_background_tasks")).run(input.requestId, "child", "{}", 90);
  db.prepare(sql(background, "INSERT INTO automation_cron_runs")).run("child", 90, 300, "{}");
  db.prepare("UPDATE automation_cron_runs SET state = 'waiting'").run();
  db.prepare("INSERT INTO automation_background_checkpoints (execution_id,revision,context_json,updated_at) VALUES ('child',1,'{}',90)").run();
}
function accept(db) {
  db.prepare(sql(waiting, "INSERT INTO automation_background_resumptions")).run(input.resumeId, "child", input.waitId, JSON.stringify(input), 100);
  db.prepare(sql(waiting, "UPDATE automation_background_checkpoints SET revision")).run("child", 2, '{"messages":[{"role":"user","content":"Tomorrow 10:00"}]}', 100);
  db.prepare(sql(waiting, "UPDATE automation_cron_runs SET state = 'pending', lease_expires_at = NULL WHERE execution_id = ?1 AND state = 'waiting'")).run("child");
}

test("receiver evidence exists only after the actual response and retained-context resumption commit", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-resume-proof-")), file = path.join(dir, "receiver.sqlite");
  let writer, reader;
  try {
    writer = new DatabaseSync(file); writer.exec(schema); parent(writer); reader = new DatabaseSync(file);
    assert.equal(lookup(reader), undefined);
    writer.exec("BEGIN IMMEDIATE"); accept(writer);
    assert.equal(lookup(reader), undefined);
    writer.exec("ROLLBACK"); assert.equal(lookup(reader), undefined);
    assert.equal(writer.prepare("SELECT revision FROM automation_background_checkpoints").get().revision, 1);
    writer.exec("BEGIN IMMEDIATE"); accept(writer); writer.exec("COMMIT");
    const actual = lookup(reader); assert.equal(actual.execution_id, "child");
    assert.equal(actual.created_at, 100); assert.deepEqual(JSON.parse(actual.input_json), input);
    assert.equal(reader.prepare("SELECT state FROM automation_cron_runs").get().state, "pending");
    assert.equal(reader.prepare("SELECT revision FROM automation_background_checkpoints").get().revision, 2);
  } finally { reader?.close(); writer?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("a reused native response ID cannot create another context wake and acceptance survives receiver reopen/terminal progress", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-resume-reopen-")), file = path.join(dir, "receiver.sqlite"); let db;
  try {
    db = new DatabaseSync(file); db.exec(schema); parent(db); accept(db);
    const original = lookup(db); assert.throws(() => accept(db), /UNIQUE/);
    db.close(); db = new DatabaseSync(file); db.exec(schema);
    for (const state of ["leased", "waiting", "done", "expired"]) {
      db.prepare("UPDATE automation_cron_runs SET state = ?").run(state);
      assert.deepEqual(lookup(db), original);
    }
    assert.equal(lookup(db, { ...input, requestId: "other-task" }), undefined);
    assert.equal(lookup(db, { ...input, resumeId: "different-response" }), undefined);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_resumptions").get().n, 1);
    assert.equal(db.prepare("SELECT revision FROM automation_background_checkpoints").get().revision, 2);
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("native receipt route only reads the matched immutable input and exposes no successful task outcome", () => {
  const reader = waiting.split("pub fn background_resume_receipt")[1].split("#[cfg(test)]")[0];
  assert.doesNotMatch(reader, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|resume_wait_on_connection|verify_background_binding/);
  assert.match(reader, /saved != expected/); assert.match(reader, /Resume receipt is bound to a different original response/);
  assert.match(reader, /Uuid::parse_str/); assert.match(reader, /input\.response\.len\(\)>32\*1024/);
  assert.doesNotMatch(reader, /"success"|"outcomes"|"permissions"/);
  const bridge = read("services/local_access.rs").split('"automation_background_resume_receipt" =>')[1].split('"automation_background_operations"')[0];
  assert.match(bridge, /input\.request_id != required_id\(\)\?/);
  assert.match(bridge, /store\.background_resume_receipt/); assert.doesNotMatch(bridge, /resume_background_on_host/);
  assert.match(read("services/worker_peers.rs"), /"automation_background_resume_receipt"/);
  assert.match(read("lib.rs"), /commands::cron::automation_background_resume_receipt/);
});
