import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Production SQL runs in real SQLite. Rust reconciliation/branch validation
// has native tests but is not executed by these source assertions.
const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const progress = read("services/automation/store/goal_progress.rs").split("#[cfg(test)]")[0];
const sql = (text, prefix) => {
  const match = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)]
    .find(entry => entry[1].trimStart().startsWith(prefix));
  assert.ok(match, prefix); return match[1];
};
const owner = randomUUID(), peer = randomUUID(), request = randomUUID(), execution = randomUUID();
function open(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec(sql(read("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta"));
  db.exec(read("services/automation/goals.sql"));
  db.prepare("INSERT OR IGNORE INTO automation_meta(key,value) VALUES('background_worker_id.v1',?)").run(owner);
  return db;
}
function stage(db) {
  db.prepare("INSERT INTO automation_goal_launches VALUES(?,'goal',?,?,?,100)").run(request, owner, peer, "{}");
  db.prepare("INSERT INTO automation_goal_work VALUES('goal',?,'Actual launched goal',100)").run(request);
  const packet = JSON.stringify({ requestId: request, hostId: peer, run: { id: execution, taskId: execution } });
  db.prepare("INSERT INTO automation_submission_outbox(request_id,initiating_host_id,source_host_id,input_json,origin_json,created_at,result_json) VALUES(?,?,?,'{}','{}',100,?)")
    .run(request, owner, peer, packet);
  return packet;
}
const candidate = db => db.prepare(sql(progress, "SELECT l.goal_id,s.origin_json,s.input_json,i.payload_json")).get(request);
function receive(db, source = peer, run = execution, time = 200) {
  const payload = JSON.stringify({ hostId: source, requestId: request, run: { id: run, taskId: run } });
  db.prepare("INSERT INTO automation_result_inbox(entry_id,source_host_id,request_id,content_hash,payload_json,received_at) VALUES(?,?,?,?,?,?)")
    .run(randomUUID(), source, request, randomUUID(), payload, time);
  return payload;
}
test("Goal progress SQL joins only the linked original accepted request, owner, host and exact execution", () => {
  const db = open(); try {
    const accepted = stage(db); assert.equal(candidate(db), undefined);
    receive(db, randomUUID()); receive(db, peer, randomUUID()); assert.equal(candidate(db), undefined);
    const actual = receive(db); assert.equal(candidate(db).payload_json, actual);
    receive(db, peer, randomUUID(), 999); assert.equal(candidate(db).payload_json, actual);
    db.prepare("UPDATE automation_submission_outbox SET result_json=NULL").run(); assert.equal(candidate(db), undefined);
    db.prepare("UPDATE automation_submission_outbox SET result_json=?,cancel_requested=1").run(accepted); assert.equal(candidate(db), undefined);
    db.prepare("UPDATE automation_submission_outbox SET cancel_requested=0").run(); assert.ok(candidate(db));
    db.prepare("UPDATE automation_meta SET value=? WHERE key='background_worker_id.v1'").run(randomUUID()); assert.equal(candidate(db), undefined);
    db.prepare("UPDATE automation_meta SET value=? WHERE key='background_worker_id.v1'").run(owner);
    db.prepare("DELETE FROM automation_goal_work").run(); assert.equal(candidate(db), undefined);
  } finally { db.close(); }
});
test("step receipt and reset consumption is atomic, idempotent and survives reopen", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-goal-progress-")), file = path.join(directory, "config.sqlite");
  let db = open(file); try {
    stage(db);
    const consume = step => db.prepare(sql(progress, "INSERT OR IGNORE INTO automation_goal_step_receipts(request_id,step_id,goal_id,recorded_at) VALUES")).run(request, step, "goal", 200).changes;
    db.exec("BEGIN IMMEDIATE"); assert.equal(consume("report"), 1); db.exec("ROLLBACK");
    assert.equal(consume("report"), 1); assert.equal(consume("report"), 0);
    db.prepare(sql(progress, "INSERT OR IGNORE INTO automation_goal_step_receipts(request_id,step_id,goal_id,recorded_at) SELECT")).run("goal", "site", 300);
    assert.equal(consume("site"), 0);
    db.close(); db = open(file); assert.equal(consume("report"), 0); assert.equal(consume("site"), 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_goal_step_receipts").get().n, 2);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
test("original step mutation occurs in both original result transactions and preserves the full Goal/UI contract", () => {
  const inbox = read("services/automation/store/inbox.rs"), submission = read("services/automation/store/submission.rs");
  const receive = inbox.slice(inbox.indexOf("pub(crate) fn receive_background_result_guarded"));
  assert.ok(receive.indexOf("super::goal_progress::reconcile(&tx,&watch.request_id)?") < receive.indexOf("tx.commit()"));
  const complete = submission.slice(submission.indexOf("pub(crate) fn complete_background_submission"));
  assert.ok(complete.indexOf("UPDATE automation_submission_outbox SET result_json") < complete.indexOf("super::goal_progress::reconcile"));
  assert.ok(complete.indexOf("super::goal_progress::reconcile") < complete.indexOf("tx.commit()"));
  assert.match(progress, /created_at!=frozen.created_at \|\| !same_requirements/);
  assert.match(progress, /current.steps.iter\(\).zip\(&accepted.steps\)/);
  assert.match(progress, /matching.len\(\)!=1/); assert.match(progress, /outcome\["state"\]!="verified"/);
  assert.match(progress, /BackgroundCriterion::Unavailable\{\.\.\}=>true/);
  assert.match(progress, /BackgroundBranchEvidence/); assert.match(progress, /evidence.artifact_ids/);
  assert.match(progress, /db::bump_revision\(conn,goals::REVISION\)/);
  assert.doesNotMatch(progress, /SET status|automation_background_submit|permission_request|new_v4/);
  const launch = read("services/automation/store/goal_launch.rs");
  assert.match(launch, /routing:Some\(progress.routing\(&initiating\)\?\)/);
  assert.match(launch, /"progress":progress/);
  assert.match(read("services/automation/store/goals.rs"), /super::goal_progress::fence_reset/);
});
