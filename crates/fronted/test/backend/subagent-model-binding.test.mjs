import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const dbSource = fs.readFileSync(new URL("../../src-tauri/src/commands/history/history_db.rs", import.meta.url), "utf8");
const storeSource = fs.readFileSync(new URL("../../src-tauri/src/commands/history/subagent_store.rs", import.meta.url), "utf8");
const table = dbSource.match(/CREATE TABLE subagentRun \([\s\S]*?\);/)[0];
const insert = storeSource.match(/INSERT INTO subagentRun \([\s\S]*?updated_at = excluded.updated_at/)[0];
const columns = storeSource.match(/const RUN_HEADER_COLUMNS: &str = "([\s\S]*?)";/)[1];
const migration = dbSource.match(/ALTER TABLE subagentRun ADD COLUMN provider_config_id TEXT;/)[0];
const header = (configId) => ["run", "conversation", "parent-call", "coder", 0, 1, "Actual task", "readonly", "completed",
  "codex", "shared-model", null, "/workspace", null, null, 2, 0, 1, 2, 1, 0, 0, "Actual report", null, 10, 20, 20, configId, null, null];

test("actual native run SQL preserves exact provider identity through insert, update and read", (t) => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close()); db.exec(table);
  db.prepare(insert).run(...header("provider-one"));
  let row = db.prepare(`SELECT ${columns} FROM subagentRun`).get();
  assert.equal(row.provider_config_id, "provider-one");
  assert.equal(row.model, "shared-model");
  db.prepare(insert).run(...header("provider-two"));
  row = db.prepare(`SELECT ${columns} FROM subagentRun`).get();
  assert.equal(row.provider_config_id, "provider-two");
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM subagentRun").get().total, 1);
});

test("additive migration retains an existing legacy run rather than resetting its context header", (t) => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close()); db.exec(table);
  db.prepare(insert).run(...header(null));
  db.exec("ALTER TABLE subagentRun DROP COLUMN provider_config_id");
  db.exec(migration);
  const row = db.prepare(`SELECT ${columns} FROM subagentRun`).get();
  assert.equal(row.provider_config_id, null);
  assert.equal(row.summary, "Actual report");
  assert.equal(row.total_message_count, 2);
  const currentBranch = dbSource.slice(dbSource.indexOf('if version.as_deref() == Some(SUBAGENT_SCHEMA_VERSION)'), dbSource.indexOf('DROP TABLE IF EXISTS subagentRunEvent'));
  assert.ok(currentBranch.includes("ensure_table_columns"));
  assert.ok(!currentBranch.includes("DROP TABLE"));
});

test("native SQL retains immutable batch proof across later header writes and upgrades legacy rows additively", (t) => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close()); db.exec(table);
  const first = header("original"); first[28] = JSON.stringify({ version: 1, receipt: "actual settled batch" });
  db.prepare(insert).run(...first);
  db.prepare(insert).run(...header("original"));
  assert.equal(db.prepare(`SELECT ${columns} FROM subagentRun`).get().batch_receipt_json, first[28]);
  const replacement = header("original"); replacement[28] = JSON.stringify({ receipt: "replacement" });
  db.prepare(insert).run(...replacement);
  assert.equal(db.prepare(`SELECT ${columns} FROM subagentRun`).get().batch_receipt_json, first[28]);
  db.exec("ALTER TABLE subagentRun DROP COLUMN batch_receipt_json");
  db.exec(dbSource.match(/ALTER TABLE subagentRun ADD COLUMN batch_receipt_json TEXT;/)[0]);
  const upgraded = db.prepare(`SELECT ${columns} FROM subagentRun`).get();
  assert.equal(upgraded.batch_receipt_json, null); assert.equal(upgraded.summary, "Actual report");
});

test("native query pins parent call before applying list limits so unrelated recent batches cannot hide recovery evidence", (t) => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close()); db.exec(table);
  db.prepare(insert).run(...header("original"));
  for (let i=0;i<300;i++) {
    const other = header("other"); other[0] = `other-${i}`; other[2] = `different-call-${i}`; other[26] = 1000+i;
    db.prepare(insert).run(...other);
  }
  const query = storeSource.match(/"SELECT \{RUN_HEADER_COLUMNS\} FROM subagentRun\s+WHERE parent_conversation_id = \?1 AND [\s\S]*?LIMIT \?2"/)[0].slice(1,-1).replace("{RUN_HEADER_COLUMNS}", columns);
  assert.equal(db.prepare(query).all("conversation",256,"parent-call").length,1);
  assert.equal(db.prepare(query).all("another-conversation",256,"parent-call").length,0);
});

test("actual additive read-only capability proof preserves unknown legacy rows and cannot upgrade a write-capable run", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close()); db.exec(table);
  db.prepare(insert).run(...header("original"));
  db.exec("ALTER TABLE subagentRun DROP COLUMN read_only_tools");
  db.exec(dbSource.match(/ALTER TABLE subagentRun ADD COLUMN read_only_tools INTEGER CHECK\(read_only_tools IN \(0,1\)\);/)[0]);
  assert.equal(db.prepare(`SELECT ${columns} FROM subagentRun`).get().read_only_tools, null);
  const readOnly = header("original"); readOnly[29] = 1;
  db.prepare(insert).run(...readOnly); assert.equal(db.prepare(`SELECT ${columns} FROM subagentRun`).get().read_only_tools, 1);
  const mutable = header("original"); mutable[29] = 0;
  db.prepare(insert).run(...mutable); db.prepare(insert).run(...readOnly);
  assert.equal(db.prepare(`SELECT ${columns} FROM subagentRun`).get().read_only_tools, 0);
  assert.throws(() => db.exec("UPDATE subagentRun SET read_only_tools=2"), /CHECK/);
  assert.match(storeSource, /run.read_only_tools == Some\(true\) && run.mode != "readonly"/);
});
