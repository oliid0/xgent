import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Actual SQL/bytes, not Rust ZIP/HTTP/validation or platform execution.
const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const sql = (text, prefix) => { const match = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(item => item[1].trimStart().startsWith(prefix)); assert.ok(match, prefix); return match[1]; };
const source = read("services/automation/store/cloud_artifacts.rs"), parts = read("services/automation/store/artifact_parts.rs"), journal = read("services/automation/store/journal.rs");
const schema = sql(read("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta");
const own = sql(source, "SELECT o.arguments_json,o.result_json"), cached = sql(source, "SELECT p.artifact_id,p.owner");
const insert = sql(source, "INSERT INTO automation_background_cloud_artifacts"), artifact = sql(parts, "INSERT INTO automation_background_artifacts");
const complete = sql(journal, "UPDATE automation_background_operations SET state = 'returned'");
const bytes = Buffer.from("Actual Actions deliverable"), hash = createHash("sha256").update(bytes).digest("hex");
function open(file = ":memory:") {
  const db = new DatabaseSync(file); db.exec(schema); db.exec(read("services/automation/cloud_artifacts.sql")); db.exec(read("services/automation/artifact_parts.sql"));
  return db;
}
function intent(db) {
  db.prepare("INSERT INTO automation_background_operations (execution_id,call_id,tool_name,arguments_json,context_revision,state,started_at) VALUES ('parent','import','ImportBackgroundCloudArtifact',?,1,'started',1)").run(JSON.stringify({ cloud_call_id: "start", entry_path: "result.pptx", path: "report.pptx" }));
  db.prepare("INSERT INTO automation_background_operation_leases VALUES ('parent','import',1,2,'original-token')").run();
}
function publish(db, finish = true) {
  db.exec("BEGIN IMMEDIATE");
  db.prepare(artifact).run("parent-file", "parent", "report.pptx", hash, bytes.length, bytes, 2);
  db.prepare(insert).run("parent", "start", "result.pptx", "parent-file", "Owner", "public-worker", "task-original", 17, 23, "a".repeat(64), hash, bytes.length);
  db.prepare(complete).run("parent", "import", JSON.stringify({ role: "toolResult", toolCallId: "import", toolName: "ImportBackgroundCloudArtifact", isError: false, artifact: "parent-file" }), 0, 2);
  db.exec(finish ? "COMMIT" : "ROLLBACK");
}

test("actual fenced cloud import SQL refuses foreign parent/call/lease selection", () => {
  const db = open(); try { intent(db); assert.equal(db.prepare(own).get("parent", "import", 1, 2, "original-token").result_json, null);
    for (const args of [["other", "import", 1, 2, "original-token"], ["parent", "other", 1, 2, "original-token"], ["parent", "import", 1, 3, "original-token"], ["parent", "import", 1, 2, "replacement"]]) assert.equal(db.prepare(own).get(...args), undefined);
  } finally { db.close(); }
});

test("production bytes/provenance/operation receipt commit together and retain exact source after reopen/migration replay", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-cloud-artifacts-")); let db = open(path.join(directory, "result.sqlite"));
  try {
    intent(db); publish(db, false); assert.equal(db.prepare(cached).get("parent", "start", "result.pptx"), undefined); assert.equal(db.prepare(own).get("parent", "import", 1, 2, "original-token").result_json, null);
    publish(db); db.close(); db = open(path.join(directory, "result.sqlite"));
    const saved = db.prepare(cached).get("parent", "start", "result.pptx");
    assert.equal(saved.relative_path, "report.pptx"); assert.equal(saved.run_id, 17); assert.equal(saved.cloud_artifact_id, 23); assert.equal(saved.content_hash, hash);
    assert.deepEqual(Buffer.from(db.prepare("SELECT content FROM automation_background_artifacts WHERE artifact_id='parent-file'").get().content), bytes);
    assert.equal(JSON.parse(db.prepare(own).get("parent", "import", 1, 2, "original-token").result_json).artifact, "parent-file");
    assert.equal(db.prepare(cached).get("parent", "start", "other.pptx"), undefined);
    assert.throws(() => db.prepare(insert).run("parent", "start", "result.pptx", "replacement", "Owner", "public-worker", "task-original", 17, 24, null, hash, bytes.length), /UNIQUE/);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("corrupt parent snapshot metadata cannot be matched as retained cloud provenance", () => {
  const db = open(); try { intent(db); publish(db); db.prepare("UPDATE automation_background_artifacts SET content_hash=? WHERE artifact_id='parent-file'").run("b".repeat(64)); assert.equal(db.prepare(cached).get("parent", "start", "result.pptx"), undefined);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_background_cloud_artifacts").get().n, 1);
  } finally { db.close(); }
});

test("native cloud import binds real job/archive identity, CRC stream, local replay and existing result publication gates", () => {
  const command = read("commands/automation/cloud_artifacts.rs"), cloud = read("services/cloud_execution.rs"), importer = read("services/cloud_artifacts.rs");
  assert.match(command, /window.label\(\)!="agent-worker"/); assert.match(command, /download_artifact\(&token,&source.locator,None,false\)/);
  assert.ok(command.indexOf("if let Some(receipt)") < command.indexOf(".download_artifact("));
  assert.match(source, /super::cloud_waiting::started_cloud_task/); assert.match(source, /known_run.is_some_and/); assert.match(source, /downloaded\.observed_status/);
  assert.match(source, /super::artifact_parts::write_snapshot/); assert.match(source, /tx\.commit/); assert.match(source, /complete_background_operation_on_connection/);
  assert.match(importer, /512 \* 1024 \* 1024/); assert.match(importer, /256\*1024/); assert.match(importer, /entry\.read\(&mut buffer\)/);
  assert.doesNotMatch(importer.split("#[cfg(test)]")[0], /read_to_end/); assert.match(importer, /hash\.finalize\(\)/);
  assert.match(cloud, /expected_digest=artifact.digest/); assert.match(cloud, /archive_hash\.update\(&chunk\)/);
  assert.match(cloud, /Cloud archive failed GitHub SHA-256 digest verification/); assert.match(cloud, /verified_cached_archive\(&target,expected\)/);
  assert.equal(read("lib.rs").split("commands::cloud_artifacts::automation_background_cloud_import_artifact,").length - 1, 1);
});
