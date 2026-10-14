import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read=name=>readFileSync(new URL(`../../src-tauri/src/${name}`,import.meta.url),"utf8");
const query=(source,prefix)=>{const found=[...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(match=>match[1].trimStart().startsWith(prefix));assert.ok(found,prefix);return found[1];};
const source=read("services/automation/store/foreground_attention.rs");
const upsert=query(source,"INSERT INTO automation_foreground_attention"),busy=query(source,"SELECT EXISTS(SELECT 1 FROM automation_foreground_attention a");
const open=file=>{const db=new DatabaseSync(file);db.exec("CREATE TABLE IF NOT EXISTS automation_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");db.exec(read("services/automation/foreground_attention.sql"));db.prepare("INSERT OR IGNORE INTO automation_meta VALUES ('background_worker_id.v1','original')").run();return db;};
const observe=(db,id,seq,closed,at=1000,host="original")=>db.prepare(upsert).run(id,host,seq,closed,at,at,at+30000);
const held=(db,now)=>Object.values(db.prepare(busy).get(now))[0]===1;

test("original-host busy observations survive reopen and expire without a cleanup after app/phone shutdown",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-attention-")),file=path.join(directory,"state.sqlite");let db=open(file);
  try{
    observe(db,"old",1,0);assert.equal(held(db,1000),true);db.close();db=open(file);
    assert.equal(held(db,30999),true);assert.equal(held(db,31000),false);
    assert.equal(held(db,999),false); // Clock moving backwards does not hold forever.
    db.prepare("UPDATE automation_meta SET value='other' WHERE key='background_worker_id.v1'").run();assert.equal(held(db,2000),false);
  }finally{db.close();unlinkSync(file);rmdirSync(directory);}
});

test("reordered renewals/close acknowledgements cannot revive a retired scope or clear a newer active scope",()=>{
  const db=open(":memory:");try{
    observe(db,"first",2,0,2000);observe(db,"first",1,0,1000);assert.equal(db.prepare("SELECT sequence FROM automation_foreground_attention").get().sequence,2);
    observe(db,"first",3,1,3000);observe(db,"second",1,0,3000);observe(db,"first",4,0,4000);
    assert.equal(held(db,4000),true);assert.equal(db.prepare("SELECT closed FROM automation_foreground_attention WHERE session_id='first'").get().closed,1);
    observe(db,"second",2,1,4000);assert.equal(held(db,4000),false);
    observe(db,"not-yet-seen",2,1,4000);observe(db,"not-yet-seen",1,0,3000);assert.equal(held(db,5000),false);
    observe(db,"second",9,0,5000,"other");assert.equal(db.prepare("SELECT host_id FROM automation_foreground_attention WHERE session_id='second'").get().host_id,"original");
  }finally{db.close();}
});

test("native intake validates bounded message lifetime before pruning/renewal and event dispatch defers the same occurrence",()=>{
  assert.match(source,/now-input.issued_at>=TTL_MS/);assert.match(source,/input.issued_at>now/);assert.match(source,/count>=64/);
  assert.ok(source.indexOf("now-input.issued_at>=TTL_MS")<source.indexOf("DELETE FROM automation_foreground_attention"));
  const proactive=read("services/automation/store/proactive.rs");
  assert.match(proactive,/foreground_attention::is_foreground_busy\(&tx,db::now_ms\(\)\)/);
  assert.match(proactive,/else if foreground_busy \{ state="deferred"; reason="foreground_busy"; \}/);
  assert.ok(proactive.indexOf("else if foreground_busy")<proactive.indexOf("super::proactive_remote::stage(&tx"));
  assert.match(proactive,/if state == "deferred" \{ break; \}[\s\S]*?UPDATE automation_proactive_rules SET cursor/);
  assert.match(proactive,/WHERE automation_proactive_deliveries.state = 'deferred'/);
  const command=read("commands/automation/proactive.rs"),lib=read("lib.rs"),access=read("services/local_access.rs");
  assert.match(command,/window.label\(\)!="main"/);
  assert.equal((lib.match(/commands::proactive::automation_foreground_attention,/g)??[]).length,2);
  assert.match(access,/command == "automation_foreground_attention"[\s\S]*?return Err/);
  assert.match(read("services/automation/db.rs"),/include_str!\("foreground_attention.sql"\)/);
});
