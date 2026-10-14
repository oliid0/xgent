import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const query = (source, prefix) => {
  const found = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)]
    .find(match => match[1].trimStart().startsWith(prefix));
  assert.ok(found, prefix);
  return found[1];
};
const dbSource = read("services/automation/db.rs");
const notificationSource = read("services/automation/store/inbox_notifications.rs");
const inboxSource = read("services/automation/store/inbox.rs");
const schema = query(dbSource, "CREATE TABLE IF NOT EXISTS automation_meta");
const pending = db => db.prepare(query(notificationSource, "SELECT i.entry_id FROM"))
  .all(20).map(row => row.entry_id);
const accept = (db, id) => db.prepare(query(notificationSource, "INSERT INTO automation_result_notifications"))
  .run(id, 200);
const notice = (db, request = randomUUID(), id = randomUUID()) => {
  const payload = JSON.stringify({ requestId: request, run: { state: "done", success: true }, artifacts: [] });
  db.prepare(query(inboxSource, "INSERT INTO automation_result_inbox"))
    .run(id, "original-host", request, randomUUID(), payload, 100);
  return { id, request, payload };
};

test("native OS-delivery candidates survive reopen, exclude accepted receipts and never mark results read", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-native-receiver-"));
  const file = path.join(directory, "inbox.sqlite");
  let db;
  try {
    db = new DatabaseSync(file); db.exec(schema);
    const delivered = notice(db), retained = notice(db);
    accept(db, delivered.id); accept(db, delivered.id);
    db.close(); db = new DatabaseSync(file);
    assert.deepEqual(pending(db), [retained.id]);
    const actual = db.prepare("SELECT payload_json, read_at FROM automation_result_inbox WHERE entry_id = ?").get(delivered.id);
    assert.equal(actual.payload_json, delivered.payload); assert.equal(actual.read_at, null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_notifications").get().n, 1);
  } finally { db?.close(); unlinkSync(file); rmdirSync(directory); }
});

test("native delivery drains a bounded fair backlog without accepted notices or four UI cards starving later work", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema); const notices = Array.from({ length: 45 }, () => notice(db));
    for (let start = 0; start < notices.length; start += 20) {
      const batch = pending(db);
      assert.deepEqual(batch, notices.slice(start, start + 20).map(item => item.id));
      for (const id of batch) accept(db, id);
    }
    assert.deepEqual(pending(db), []);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_inbox WHERE read_at IS NULL").get().n, 45);
  } finally { db.close(); }
});

test("read and superseded receipts disappear from native candidates and selection cannot authorize a raced OS call", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema); const previous = notice(db), readNotice = notice(db);
    const selected = pending(db); assert.equal(selected.length, 2);
    const newer = notice(db, previous.request);
    db.prepare("UPDATE automation_result_inbox SET read_at = 300 WHERE entry_id = ?").run(readNotice.id);
    assert.deepEqual(pending(db), [newer.id]);
    const status = db.prepare(query(notificationSource, "SELECT i.read_at IS NULL AND NOT EXISTS"));
    for (const id of selected) assert.equal(Object.values(status.get(id))[0], 0);
    const commands = read("commands/automation/cron.rs");
    const notify = commands.split("pub(crate) async fn deliver_background_result_notification(")[1]
      .split("pub async fn automation_result_ack(")[0];
    assert.ok(notify.indexOf('status != "ready"') < notify.indexOf("post_result_notification"));
    assert.ok(notify.indexOf("record_background_notification_accepted") > notify.indexOf("post_result_notification"));
    assert.match(notify, /background_inbox_notification_status\(&entry_id\).*== "obsolete"/);
    assert.match(notify, /remove_result_notification/);
    assert.doesNotMatch(notify, /request_permission|acknowledge_background_inbox/);
  } finally { db.close(); }
});

test("both native startup paths start one original-owner receiver and retain manual delivery, backoff and exit fences", () => {
  const runtime = read("services/result_receiver.rs"), lib = read("lib.rs");
  assert.match(runtime, /try_state::<Arc<AutomationStore>>/);
  assert.match(runtime, /try_state::<Arc<WorkerPeerRegistry>>/);
  assert.match(runtime, /if !app\.manage\(ResultReceiverStarted\) \{ return; \}/);
  assert.match(runtime, /MissedTickBehavior::Delay/);
  assert.match(runtime, /quitting.*flag\.load\(Ordering::SeqCst\)/);
  assert.match(runtime, /pending_background_notifications\(20\)/);
  assert.match(lib, /result_receiver::start_if_available\(app\.handle\(\), Some\(Arc::clone\(&worker_quitting\)\)\)/);
  assert.match(lib, /result_receiver::start_if_available\(&app, None\)/);
  const commands = read("commands/automation/cron.rs");
  assert.match(commands, /pub async fn automation_result_sync[\s\S]*?sync_background_results\(app, Arc::clone\(store\.inner\(\)\), Arc::clone\(registry\.inner\(\)\)\)\.await/);
  const delivery = commands.split("pub(crate) async fn sync_background_results(")[1]
    .split("async fn deliver_received_response(")[0];
  for (const fragment of ["registry.result_requests", "register_result_requests", "claim_result_watches", "claim_received_responses", "claim_background_submissions", '"automation_background_get"', "receive_background_result"])
    assert.ok(delivery.includes(fragment), fragment);
  assert.doesNotMatch(runtime, /WebviewWindow|tauri::command|request_authorization|background_submit|background_resume|receive_background_result/);
});
