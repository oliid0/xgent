import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
const read = (name) => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const source = read("services/automation/store/inbox.rs");
const sql = (text, prefix) => { const found = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find((m) => m[1].trimStart().startsWith(prefix)); assert.ok(found, prefix); return found[1]; };
const schema = sql(read("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta");
const execute = (db, prefix, args = [], method = "run") => db.prepare(sql(source, prefix))[method](...args);
const watch = (db, request = "request", host = "original-host") => execute(db, "INSERT INTO automation_result_watches", [request, host]);
const payload = JSON.stringify({ name: "实际报告", run: { state: "waiting", success: false, output: "真实方案已保存" }, artifacts: [] });
const receive = (db, id = "notice", hash = "hash", request = "request") => execute(db, "INSERT INTO automation_result_inbox", [id, "original-host", request, hash, payload, 100]);
test("real inbox SQL survives reopen; delivery state and user acknowledgment are separate and immutable", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-inbox-")), file = path.join(dir, "results.sqlite"); let db;
  try {
    db = new DatabaseSync(file); db.exec(schema); watch(db); db.exec("BEGIN IMMEDIATE"); receive(db);
    execute(db, "UPDATE automation_result_watches SET execution_id", ["request", "execution", 8, "waiting", "hash", 100, 150, 1]); db.exec("COMMIT");
    db.close(); db = new DatabaseSync(file);
    const inbox = execute(db, "SELECT entry_id, sequence", [0, 1, 21], "all"); assert.equal(inbox.length, 1); assert.equal(inbox[0].read_at, null);
    assert.equal(execute(db, "SELECT payload_json", ["notice"], "get").payload_json, payload);
    execute(db, "UPDATE automation_result_inbox SET read_at", ["notice", 101]); execute(db, "UPDATE automation_result_inbox SET read_at", ["notice", 999]);
    assert.equal(execute(db, "SELECT entry_id, sequence", [0, 1, 21], "all").length, 0);
    assert.equal(execute(db, "SELECT entry_id, sequence", [0, 0, 21], "all")[0].read_at, 101);
    assert.equal(execute(db, "SELECT payload_json", ["notice"], "get").payload_json, payload);
    assert.throws(() => receive(db, "duplicate"), /UNIQUE/);
  } finally { db?.close(); unlinkSync(file); rmdirSync(dir); }
});
test("failed result receipt transaction cannot advance the durable watch; newer notices supersede without fake ACK", () => {
  const db = new DatabaseSync(":memory:"); try {
    db.exec(schema); watch(db); receive(db); db.exec("BEGIN IMMEDIATE");
    execute(db, "UPDATE automation_result_watches SET execution_id", ["request", "execution", 9, "done", "new-hash", 200, 300, 0]);
    assert.throws(() => receive(db, "notice", "new-hash"), /UNIQUE/); db.exec("ROLLBACK");
    assert.equal(execute(db, "SELECT source_host_id, execution_id", ["request"], "get").last_revision, 0);
    receive(db, "new-notice", "new-hash");
    const latest = execute(db, "SELECT entry_id, sequence", [0, 1, 21], "all"); assert.deepEqual(latest.map((i) => i.entry_id), ["new-notice"]);
    assert.deepEqual(execute(db, "SELECT entry_id, sequence", [0, 0, 21], "all").map((i) => i.read_at), [null, null]);
  } finally { db.close(); }
});
test("real retry selection is fair/bounded and persisted before polling; acknowledged data does not resume execution", () => {
  const db = new DatabaseSync(":memory:"); try {
    db.exec(schema); for (let i = 0; i < 7; i++) watch(db, `request-${i}`);
    const first = execute(db, "SELECT source_host_id, request_id, probes", [10], "all"); assert.equal(first.length, 4);
    for (const row of first) execute(db, "UPDATE automation_result_watches SET retry_at", [row.request_id, 1000, 1]);
    assert.equal(execute(db, "SELECT source_host_id, request_id, probes", [10], "all").length, 3);
    assert.equal(execute(db, "SELECT source_host_id, request_id, probes", [1000], "all").length, 4);
    const access = read("services/local_access.rs"); assert.match(access, /command\.starts_with\("automation_result_"\)/);
    const commands = read("commands/automation/cron.rs"); const sync = commands.split("pub async fn automation_result_sync(")[1].split("async fn deliver_received_response(")[0];
    assert.match(sync, /registry\.result_requests/); assert.match(sync, /claim_result_watches/); assert.match(sync, /buffer_unordered\(4\)/); assert.match(sync, /"automation_background_get"/);
    assert.doesNotMatch(sync, /automation_background_submit|automation_background_resume/);
  } finally { db.close(); }
});
