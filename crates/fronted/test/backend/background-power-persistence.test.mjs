import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const sql = (source, prefix) => {
  const found = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(match => match[1].trimStart().startsWith(prefix));
  assert.ok(found, `Missing production SQL: ${prefix}`); return found[1];
};
const power = read("services/automation/store/power_activity.rs");
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(sql(read("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta"));
  db.exec(read("services/automation/budget.sql")); db.exec(read("services/automation/videos.sql"));
  db.prepare("INSERT INTO automation_meta(key,value) VALUES('background_worker_id.v1','original-worker')").run();
  const insert = sql(read("services/automation/store/background.rs"), "INSERT INTO automation_cron_runs");
  db.prepare(insert).run("execution", 100, 100, "{}");
  const awake = () => !!Object.values(db.prepare(sql(power, "SELECT EXISTS")).get(1000))[0];
  return { db, awake };
}

test("production queue power query releases terminal, expired and input-wait tasks", () => {
  const { db, awake } = fixture();
  try {
    assert.equal(awake(), true);
    for (const state of ["succeeded", "failed", "cancelled", "waiting"]) {
      db.prepare("UPDATE automation_cron_runs SET state=?").run(state); assert.equal(awake(), false, state);
    }
    db.prepare("UPDATE automation_cron_runs SET state='leased',lease_expires_at=2000").run(); assert.equal(awake(), true);
    db.prepare("UPDATE automation_cron_runs SET lease_expires_at=999").run(); assert.equal(awake(), false);
    db.prepare("UPDATE automation_cron_runs SET state='pending'").run();
    db.prepare("INSERT INTO automation_background_budget_deadlines(execution_id,deadline_at) VALUES('execution',1000)").run();
    assert.equal(awake(), false);
  } finally { db.close(); }
});

test("only an accepted still-running original child holds its waiting parent awake", () => {
  const { db, awake } = fixture();
  try {
    db.exec("UPDATE automation_cron_runs SET state='waiting'");
    db.prepare("INSERT INTO automation_background_children(execution_id,call_id,child_request_id,peer_id,issuer_host_id,input_json,issued_at,retry_at) VALUES('execution','call','child','pc','original-worker','{}',100,100)").run();
    assert.equal(awake(), false);
    db.exec("UPDATE automation_background_children SET receipt_json='{}'"); assert.equal(awake(), true);
    db.exec("UPDATE automation_background_children SET issuer_host_id='foreign'"); assert.equal(awake(), false);
    db.exec("UPDATE automation_background_children SET issuer_host_id='original-worker',observed_state='waiting'"); assert.equal(awake(), false);
    db.exec("UPDATE automation_background_children SET observed_state='leased'"); assert.equal(awake(), true);
    db.exec("UPDATE automation_background_children SET terminal_confirmed=1"); assert.equal(awake(), false);
  } finally { db.close(); }
});

test("cloud receipt holds scope until the matching original completion, not a foreign job", () => {
  const { db, awake } = fixture();
  try {
    db.exec("UPDATE automation_cron_runs SET state='waiting'");
    db.prepare("INSERT INTO automation_background_cloud_launches(execution_id,call_id,task_id,arguments_hash,owner,repository,runner,issued_at,result_json) VALUES('execution','call','task','hash','owner','repo','ubuntu-latest',100,'{}')").run();
    assert.equal(awake(), true);
    db.prepare(sql(read("services/automation/store/cloud_waiting.rs"), "INSERT INTO automation_background_cloud_completions")).run("execution", "call", "owner", "other-repo", "task", 99, "success", JSON.stringify({ state: "completed", taskId: "task", runId: 99, conclusion: "success" }), 999);
    assert.equal(awake(), true);
    db.exec("UPDATE automation_background_cloud_completions SET repository='REPO'"); assert.equal(awake(), false);
  } finally { db.close(); }
});

test("video jobs require actual accepted ID, owner and nonterminal state", () => {
  const { db, awake } = fixture();
  try {
    db.exec("UPDATE automation_cron_runs SET state='waiting'");
    db.prepare("INSERT INTO automation_video_jobs(execution_id,call_id,input_json,issuer_host_id,nonce,state,retry_at,created_at) VALUES('execution','call','{}','original-worker','nonce','issuing',100,100)").run();
    assert.equal(awake(), false);
    db.exec("UPDATE automation_video_jobs SET job_id='actual-job',state='in_progress'"); assert.equal(awake(), true);
    db.exec("UPDATE automation_video_jobs SET issuer_host_id='foreign'"); assert.equal(awake(), false);
    db.exec("UPDATE automation_video_jobs SET issuer_host_id='original-worker',state='completed'"); assert.equal(awake(), false);
  } finally { db.close(); }
});

test("native wiring uses genuine Linux FD inhibition, bounded native worker refresh and explicit errors", () => {
  const native = read("services/power_activity.rs"), worker = read("services/worker_supervisor.rs"), command = read("commands/app/system.rs");
  assert.match(native, /target_os="linux"[\s\S]*OwnedFd/);
  assert.match(native, /call_with_unix_fd_list_sync[\s\S]*org.freedesktop.login1.Manager[\s\S]*Inhibit/);
  assert.match(native, /fds.get\(index.0\)/); assert.match(native, /fn stop\(&mut self\)\{self.fd.take\(\);\}/);
  assert.match(native, /not\(any\(target_os = "macos", target_os="linux", windows\)\)/);
  assert.match(worker, /spawn_blocking[\s\S]*background_work_requires_awake[\s\S]*Some\(60_000\)/);
  assert.match(worker, /Ok\(false\)=>power.end\(POWER_SCOPE\)/);
  assert.match(command, /pub async fn system_begin_power_activity[\s\S]*spawn_blocking/);
  assert.match(power, /setting_key='executionMode'/); assert.match(power, /"tools"\|"agent-dev"/);
});
