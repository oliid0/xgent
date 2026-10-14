import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const lease={attempt:1,generation:2,token:"11111111-1111-4111-8111-111111111111"};
const call={id:"original-call",name:"OriginalDeviceTask",arguments:{action:"request_read",branch_id:"calendar"}};
const receipt=()=>({role:"toolResult",toolCallId:call.id,toolName:call.name,isError:false,timestamp:123,
  content:[{type:"text",text:JSON.stringify({queued:true,effectCompleted:false})}],details:{kind:"original_device_planning"}});

function fixture(invoke){
  const calls=[],loader=createTsModuleLoader({mocks:{typebox:{Type},"../automation/backend":{backend:{async planOriginalDevice(...args){calls.push(structuredClone(args));return invoke(calls.length);}}}}});
  const api=loader.loadModule("src/lib/tools/originalDeviceTaskTools.ts");
  return {bundle:api.createOriginalDeviceTaskTools("accepted-execution",lease),calls};
}
test("controller tool returns the exact native admission receipt and retries only its original local intent after lost reply",async()=>{
  const actual=receipt(),f=fixture(attempt=>{if(attempt===1)throw new Error("IPC reply lost");return actual;});
  const result=await f.bundle.executeToolCall(call);
  assert.equal(result,actual);assert.deepEqual(f.calls[0],f.calls[1]);assert.deepEqual(f.calls[0],["accepted-execution",call.id,lease]);
  assert.equal(JSON.parse(result.content[0].text).effectCompleted,false);
  assert.equal(f.bundle.tools[0].name,call.name);
  assert.equal(f.bundle.tools[0].parameters.additionalProperties,false);
});
test("native rejection remains an actual no-effect tool error; foreign receipts and cancelled calls cannot become admission",async()=>{
  const rejected={...receipt(),isError:true,details:{kind:"original_device_planning",knownNoEffect:true}};
  const f=fixture(()=>rejected);assert.equal(await f.bundle.executeToolCall(call),rejected);assert.equal(f.calls.length,1);
  const foreign=fixture(()=>({...receipt(),toolCallId:"another-intent"}));await assert.rejects(foreign.bundle.executeToolCall(call),/changed its intent/);
  const cancelled=fixture(()=>receipt()),signal=new AbortController();signal.abort(new Error("Owner stopped"));
  await assert.rejects(cancelled.bundle.executeToolCall(call,signal.signal),/Owner stopped/);assert.equal(cancelled.calls.length,0);
});
