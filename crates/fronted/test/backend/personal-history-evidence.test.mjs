import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const source = readFileSync(new URL("../../src-tauri/src/commands/history/chat_history/personal_evidence.rs", import.meta.url), "utf8");
const sql = source.match(/const PERSONAL_HISTORY_MESSAGE_SQL: &str = r#"([\s\S]*?)"#;/)[1];
function fixture(messages = [{ role: "user", id: "original", content: "Actual quoted human record", timestamp: 100 }]) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE chatHistory(id TEXT PRIMARY KEY); CREATE TABLE chatHistorySegment(conversation_id TEXT,segment_index INTEGER,segment_id TEXT,messages_json TEXT)");
  db.prepare("INSERT INTO chatHistory VALUES(?)").run("conversation");
  db.prepare("INSERT INTO chatHistorySegment VALUES(?,?,?,?)").run("conversation", 0, "segment", JSON.stringify(messages));
  const read = (conversation = "conversation", segment = "segment", path = "$[0]", max = 128 * 1024) => {
    const row = db.prepare(sql).get(conversation, 0, segment, path, max);
    return row ? Object.values(row)[0] : undefined;
  };
  return { db, read };
}

test("actual production SQL selects one original record and requires its live conversation and segment", () => {
  const f = fixture();
  assert.equal(JSON.parse(f.read()).content, "Actual quoted human record");
  assert.equal(f.read("wrong"), undefined);
  assert.equal(f.read("conversation", "wrong"), undefined);
  assert.equal(f.read("conversation", "segment", "$[1]"), null);
  f.db.prepare("DELETE FROM chatHistory WHERE id=?").run("conversation");
  assert.equal(f.read(), undefined);
  f.db.close();
});

test("production SQL refuses malformed/scalar/oversized original message JSON before the Rust parse", () => {
  const f = fixture();
  assert.equal(f.read("conversation", "segment", "$[0]", 8), null);
  for (const raw of ["bad-json", '["scalar"]', '[null]']) {
    f.db.prepare("UPDATE chatHistorySegment SET messages_json=?").run(raw);
    assert.equal(f.read(), null);
  }
  f.db.close();
});

test("targeted read remains bounded independently of unrelated oversized messages in its archived segment", () => {
  const f = fixture([{ role: "assistant", content: "x".repeat(200000) }, { role: "user", id: "original", content: "Real record", timestamp: 100 }]);
  assert.equal(JSON.parse(f.read("conversation", "segment", "$[1]")).content, "Real record");
  assert.equal(f.read(), null);
  f.db.close();
});

test("native evidence contract is registered in both hosts and uses real identity/hash/time/visible content guards", () => {
  const registration = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.equal(registration.match(/commands::chat_history::chat_history_read_personal_evidence/g)?.length, 2);
  assert.match(source, /spawn_blocking/);
  assert.match(source, /history_message_content_hash/);
  assert.match(source, /message_id != args\.message_id/);
  assert.match(source, /expected_content_hash/);
  assert.match(source, /xgentDisplayContent/);
  assert.match(source, /role.*Value::as_str.*Some\("user"\)/);
  assert.doesNotMatch(source, /timestamp\(.*now_ms|timestamp.*segment\.updated_at/);
});
