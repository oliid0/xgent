import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const sql = (source, prefix) => {
  const match = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find((entry) => entry[1].trimStart().startsWith(prefix));
  assert.ok(match, prefix); return match[1];
};
const schema = sql(read("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta");
const source = read("services/automation/store/inbox_notifications.rs");
const stateSql = sql(source, "SELECT i.read_at IS NULL");
const acceptedSql = sql(source, "INSERT INTO automation_result_notifications");
const first = "11111111-1111-4111-8111-111111111111", second = "22222222-2222-4222-8222-222222222222";
const insert = (db, id, hash, request = "request") => db.prepare("INSERT INTO automation_result_inbox (entry_id,source_host_id,request_id,content_hash,payload_json,received_at) VALUES (?, 'original-pc', ?, ?, '{}', 100)").run(id, request, hash);

test("actual SQLite acceptance survives reopen independently from unread status and deduplicates the same OS receipt", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-result-notices-"));
  const file = path.join(directory, "inbox.sqlite"); let db;
  try {
    db = new DatabaseSync(file); db.exec(schema); insert(db, first, "first");
    assert.deepEqual(Object.values(db.prepare(stateSql).get(first)), [1, 0]);
    db.prepare(acceptedSql).run(first, 200); db.prepare(acceptedSql).run(first, 999);
    db.close(); db = new DatabaseSync(file);
    assert.deepEqual(Object.values(db.prepare(stateSql).get(first)), [1, 1]);
    assert.equal(db.prepare("SELECT accepted_at FROM automation_result_notifications WHERE entry_id = ?").get(first).accepted_at, 200);
    assert.equal(db.prepare("SELECT read_at FROM automation_result_inbox WHERE entry_id = ?").get(first).read_at, null);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_result_responses").get().count, 0);
  } finally { db?.close(); unlinkSync(file); rmdirSync(directory); }
});

test("read, superseded, unknown, and other-device IDs cannot originate a new system notice", () => {
  const db = new DatabaseSync(":memory:"), otherDevice = new DatabaseSync(":memory:");
  try {
    db.exec(schema); otherDevice.exec(schema); insert(db, first, "first");
    assert.equal(otherDevice.prepare(stateSql).get(first), undefined);
    insert(db, second, "second");
    assert.deepEqual(Object.values(db.prepare(stateSql).get(first)), [0, 0]);
    assert.deepEqual(Object.values(db.prepare(stateSql).get(second)), [1, 0]);
    db.prepare("UPDATE automation_result_inbox SET read_at = 300 WHERE entry_id = ?").run(second);
    assert.deepEqual(Object.values(db.prepare(stateSql).get(second)), [0, 0]);
    assert.equal(db.prepare(stateSql).get("unknown"), undefined);
    assert.equal(db.prepare(acceptedSql).run("unknown", 400).changes, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_result_notifications").get().count, 0);
  } finally { db.close(); otherDevice.close(); }
});
