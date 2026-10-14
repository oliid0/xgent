import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root=new URL("../../src-tauri/src/",import.meta.url);
const read=name=>readFileSync(new URL(name,root),"utf8");
const source=read("services/automation/store/mobile_connector_writes.rs");
const statement=prefix=>{
  const found=[...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(match=>match[1].startsWith(prefix));
  assert.ok(found,prefix);return found[1];
};

test("an unsettled Home effect blocks replacements only on that same physical home/characteristic",()=>{
  const db=new DatabaseSync(":memory:");
  try {
    const schema=[...read("services/automation/db.rs").matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(match=>match[1].trimStart().startsWith("CREATE TABLE IF NOT EXISTS automation_meta"));
    db.exec(schema[1]);
    const insert=statement("INSERT INTO automation_mobile_connector_writes"),blocked=db.prepare(statement("SELECT EXISTS(SELECT 1 FROM automation_mobile_connector_writes WHERE kind='home_power'"));
    const request=JSON.stringify({homeId:"home-one",characteristicId:"power-one",power:true});
    db.prepare(insert).run("original","original-phone","home_power",request,'{"id":"power-one","sourceId":"home-one"}',100);
    const isBlocked=(home,id)=>Object.values(blocked.get(home,id))[0]===1;
    assert.equal(isBlocked("home-one","power-one"),true);
    assert.equal(isBlocked("home-one","power-two"),false);assert.equal(isBlocked("home-two","power-one"),false);
    db.exec("UPDATE automation_mobile_connector_writes SET state='unknown'");assert.equal(isBlocked("home-one","power-one"),true);
    db.exec("BEGIN IMMEDIATE;UPDATE automation_mobile_connector_writes SET state='succeeded'");assert.equal(isBlocked("home-one","power-one"),false);
    db.exec("ROLLBACK");assert.equal(isBlocked("home-one","power-one"),true);
    db.exec("UPDATE automation_mobile_connector_writes SET state='succeeded'");assert.equal(isBlocked("home-one","power-one"),false);
  }finally{db.close();}
});

test("private SDK control starts after durable native ownership and receipts require exact readback identity",()=>{
  const native=read("commands/automation/mobile_connector.rs").split("fn execute_home_power(")[1];
  assert.ok(native.indexOf("resolve_home_power_destination(")<native.indexOf("begin_mobile_connector_write("));
  assert.ok(native.indexOf("begin_mobile_connector_write(")<native.indexOf("set_home_power("));
  assert.ok(native.indexOf("set_home_power(")<native.indexOf("complete_mobile_connector_write("));
  assert.ok(native.includes('window.label()=="agent-worker"'));
  const mobileRoot=new URL("../../../mobile-assistant/",import.meta.url);
  const swift=readFileSync(new URL("ios/Sources/HomeKitAccess.swift",mobileRoot),"utf8");
  assert.ok(swift.includes("characteristic.writeValue(NSNumber(value: args.power))"));
  assert.ok(swift.includes("value.boolValue == args.power"));
  assert.ok(swift.includes("guard self.pending[id] != nil else { return }"));
  assert.ok(swift.includes("!self.startedPowerRequests.contains(id)"));
  assert.ok(swift.includes("HMCharacteristicPropertyReadable"));assert.ok(swift.includes("HMCharacteristicPropertyWritable"));
  assert.ok(source.includes('value["id"]!=input.request["characteristicId"]'));
  for(const file of ["src/lib.rs","build.rs"]) {
    const publicAPI=readFileSync(new URL(file,mobileRoot),"utf8");
    assert.ok(!publicAPI.includes("commands::set_home_power"));assert.ok(!publicAPI.includes('"set_home_power"'));
  }
});
