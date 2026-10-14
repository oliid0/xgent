import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const source = name => readFileSync(new URL(`../../src-tauri/src/services/automation/${name}`, import.meta.url), "utf8");
function sqlFrom(text, start) {
  const literal = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(match => match[1].trimStart().startsWith(start));
  assert.ok(literal, `Missing native SQL: ${start}`);
  return literal[1];
}
const schema = sqlFrom(source("db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta");
const grant = sqlFrom(source("store/device_grants.rs"), "INSERT INTO automation_mobile_branch_grants");
const readGrant = sqlFrom(source("store/device_reads.rs"), "INSERT INTO automation_mobile_branch_reads");
const run = (db, sql, values) => db.prepare(sql).run(Object.fromEntries(values.map((value, index) => [String(index + 1), value])));

// This exercises embedded SQL migration/persistence, not Rust authorization
// handlers or SDK writes. Those source assertions require native compilation.
test("task read scopes survive reopen and revocation without granting another branch or changing write approval",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-read-grants-")),file=path.join(directory,"config.sqlite");let db;
  try {
    db=new DatabaseSync(file);db.exec(schema);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_mobile_branch_reads").get().count,0);
    const selected=JSON.stringify([{kind:"event",id:"actual-list",sourceId:"actual-source",title:"Actual list",source:"Actual OS account",writable:false}]);
    run(db,readGrant,["original-task","calendar","context-hash",1,"approved",selected,100]);
    run(db,grant,["original-task","calendar","frozen-plan-hash",1,"approved",100,100]);
    run(db,readGrant,["original-task","calendar","context-hash",2,"revoked",selected,200]);
    db.close();db=new DatabaseSync(file);db.exec(schema);
    const retained=db.prepare("SELECT * FROM automation_mobile_branch_reads").get();
    assert.equal(retained.context_hash,"context-hash");assert.equal(retained.revision,2);assert.equal(retained.decision,"revoked");assert.equal(retained.selections_json,selected);
    assert.equal(db.prepare("SELECT * FROM automation_mobile_branch_grants").get().decision,"approved");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_mobile_branch_reads WHERE branch_id = 'other'").get().count,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_mobile_connector_writes").get().count,0);
    assert.throws(()=>run(db,readGrant,["other","calendar","hash",0,"approved",selected,300]),/CHECK/);
    assert.throws(()=>run(db,readGrant,["other","calendar","hash",1,"automatic",selected,300]),/CHECK/);
  } finally {db?.close();rmSync(file,{force:true});rmdirSync(directory);}
});
test("legacy frozen phone plans gain persistent task operation owners without granting approval", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-mobile-grants-"));
  const file = path.join(directory, "config.sqlite"); let db;
  try {
    db = new DatabaseSync(file); db.exec(schema);
    db.exec("DROP TABLE automation_mobile_branch_action_owners; DROP TABLE automation_mobile_branch_grants");
    const plan = {actions:[{input:{operationId:"a".repeat(64)}},{input:{operationId:"b".repeat(64)}}]};
    db.prepare("INSERT INTO automation_mobile_branch_plans (request_id,branch_id,entry_id,plan_json,created_at) VALUES (?,?,?,?,?)").run("original-task", "calendar", "original-entry", JSON.stringify(plan), 1);
    db.exec(schema); db.close(); db = new DatabaseSync(file); db.exec(schema);
    const owners = db.prepare("SELECT * FROM automation_mobile_branch_action_owners ORDER BY action_index").all().map(row => ({...row}));
    assert.deepEqual(owners, plan.actions.map((action, index) => ({operation_id:action.input.operationId,request_id:"original-task",branch_id:"calendar",entry_id:"original-entry",action_index:index})));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_mobile_branch_grants").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_mobile_connector_writes").get().count, 0);
    assert.throws(() => db.prepare("INSERT INTO automation_mobile_branch_action_owners VALUES (?,?,?,?,?)").run(plan.actions[0].input.operationId,"another-task","calendar","another-entry",0), /UNIQUE/);
  } finally { db?.close(); rmSync(file, {force:true}); rmdirSync(directory); }
});

test("native grant SQL retains revocation across reopen without changing its frozen plan hash or creating effects", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-mobile-revoke-"));
  const file = path.join(directory, "config.sqlite"); let db;
  try {
    db = new DatabaseSync(file); db.exec(schema);
    run(db, grant, ["task","calendar","exact-hash",1,"approved",100,100]);
    run(db, grant, ["task","calendar","exact-hash",2,"revoked",null,200]);
    db.close(); db = new DatabaseSync(file); db.exec(schema);
    const retained = db.prepare("SELECT * FROM automation_mobile_branch_grants").get();
    assert.equal(retained.plan_hash,"exact-hash"); assert.equal(retained.revision,2);
    assert.equal(retained.decision,"revoked"); assert.equal(retained.approved_at,null);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_mobile_connector_writes").get().count,0);
    assert.throws(() => run(db,grant,["task","calendar","exact-hash",3,"automatic",null,300]),/CHECK/);
  } finally { db?.close(); rmSync(file,{force:true}); rmdirSync(directory); }
});
