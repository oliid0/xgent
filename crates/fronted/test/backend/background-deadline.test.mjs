import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";

const read=name=>readFileSync(new URL(`../../src-tauri/src/services/automation/${name}`,import.meta.url),"utf8");
const source=read("store/budget.rs");
const sql=prefix=>{const match=[...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(item=>item[1].trimStart().startsWith(prefix));assert.ok(match,prefix);return match[1];};
const insert=sql("INSERT INTO automation_background_budget_deadlines"),expire=sql("UPDATE automation_background_budgets AS budget"),admit=sql("UPDATE automation_background_budgets SET model_requests"),configured=sql("INSERT INTO automation_background_budgets (execution_id,max_model_requests");
function open(file=":memory:"){const db=new DatabaseSync(file);db.exec(read("budget.sql"));return db;}

test("additive migration leaves legacy ledgers without a deadline and custom limits unchanged on reopen",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-deadline-")),file=path.join(directory,"budget.sqlite");let db=open(file);
  try{
    db.prepare(configured).run("legacy",12,24);db.prepare(configured).run("new",8,16);
    db.prepare(insert).run("new",2000);db.close();db=open(file);
    assert.equal(db.prepare("SELECT deadline_at FROM automation_background_budget_deadlines WHERE execution_id=?").get("legacy"),undefined);
    assert.equal(db.prepare("SELECT deadline_at FROM automation_background_budget_deadlines WHERE execution_id=?").get("new").deadline_at,2000);
    assert.equal(db.prepare("SELECT max_model_requests FROM automation_background_budgets WHERE execution_id=?").get("new").max_model_requests,8);
    assert.throws(()=>db.prepare(insert).run("new",3000),/UNIQUE/);
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test("native deadline SQL persists refusal at the exact boundary and cannot spend a slot if the clock moves back",()=>{
  const db=open();try{
    db.prepare(configured).run("execution",12,24);db.prepare(insert).run("execution",2000);
    db.prepare(expire).run("execution",1999);assert.equal(db.prepare(admit).run("execution").changes,1);
    db.exec("BEGIN IMMEDIATE");db.prepare(expire).run("execution",2000);assert.equal(db.prepare(admit).run("execution").changes,0);db.exec("COMMIT");
    const state=db.prepare("SELECT model_requests,exhausted FROM automation_background_budgets").get();assert.equal(state.model_requests,1);assert.equal(state.exhausted,1);
    db.prepare(expire).run("execution",1000);assert.equal(db.prepare(admit).run("execution").changes,0);
  }finally{db.close();}
});

test("invalid deadline retention rolls back task budget acceptance instead of granting unbounded execution",()=>{
  const db=open();try{
    for(const value of [0,-1,8_640_000_000_000_001]){
      db.exec("BEGIN IMMEDIATE");db.prepare(configured).run("execution",8,16);assert.throws(()=>db.prepare(insert).run("execution",value),/CHECK/);db.exec("ROLLBACK");
      assert.equal(db.prepare("SELECT count(*) AS n FROM automation_background_budgets").get().n,0);
    }
  }finally{db.close();}
});

test("native roots freeze configuration on acceptance and both child paths inherit the same unexpired deadline",()=>{
  const root=source.slice(source.indexOf("pub(super) fn initialize_background_budget"),source.indexOf("pub fn background_budget"));
  assert.match(root,/background_scheduling_budget\(conn\)/);assert.match(root,/created_at FROM automation_background_tasks/);assert.match(root,/created.checked_add/);
  const allocation=source.slice(source.indexOf("pub(super) fn allocate_background_child_budget"),source.indexOf("pub(super) fn initialize_background_budget"));
  assert.match(allocation,/deadline!=budget.deadline_at/);assert.match(allocation,/time<=db::now_ms\(\)/);
  const children=read("store/model_children.rs");assert.match(children,/deadline_at:Self::background_budget_deadline\(&tx,id\)\?/);
  const admission=source.slice(source.indexOf("pub fn background_budget"));assert.match(admission,/expire_background_budget\(&tx,execution_id\)\?/);assert.doesNotMatch(admission,/background_scheduling_budget|initialize_background_budget/);
});
