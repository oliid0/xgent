import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const preference=(slug="exercise",patch={})=>({slug,scope:"global",memoryType:"user",description:"Evening exercise",headline:"Fitness",updatedAt:100,unreviewed:true,confidence:"low",...patch});
const original=()=>({version:1,requestScope:"original-conversation/user-message",systemPrompt:"Original coding and user context",messages:[{role:"user",content:"Remind me about evening exercise",timestamp:100}]});
function fixture(options={}){
  const calls=[],entries=options.entries??[preference()];
  const loader=createTsModuleLoader({mocks:{"@xgent/runtime":{
    invoke:()=>assert.fail("Source personal context cannot follow a selected PC or browser relay"),
    async invokeNative(command,args){
      calls.push({command,args});
      if(command==="memory_index_overview"){
        if(options.indexFails)throw new Error("Origin store unavailable");
        return {user:entries,project:[],global:[],recentDays:[],root:"/origin-memory"};
      }
      assert.equal(command,"memory_read");
      await options.onRead?.(args.args);
      if(options.readFails)throw new Error("Original entry unavailable");
      const entry=entries.find(entry=>entry.slug===args.args.slug);
      return {...entry,body:options.body??"I prefer evening exercise after dinner",window:{offset:0,length:1,truncated:options.truncated??false},meta:{archived:false,confidence:entry.confidence,unreviewed:entry.unreviewed,updatedAt:entry.updatedAt,source:{source_quote:"I prefer exercise after dinner",conversationId:"original-history"}}};
    },
  }}});
  return {calls,...loader.loadModule("src/lib/automation/backgroundOriginMemory.ts")};
}

test("remote source capture freezes bounded actual original-device personal evidence with provenance and leaves SDK messages untouched",async()=>{
  const f=fixture(),source=original(),before=structuredClone(source);
  const captured=await f.captureBackgroundOriginMemory(source,"/original-scope","Evening exercise",new AbortController().signal);
  assert.deepEqual(source,before);assert.deepEqual(captured.messages,before.messages);
  assert.match(captured.systemPrompt,/Original coding and user context/);
  assert.match(captured.systemPrompt,/original-conversation\/user-message/);
  assert.match(captured.systemPrompt,/I prefer evening exercise after dinner/);
  assert.match(captured.systemPrompt,/"confidence":"low","unreviewed":true,"updatedAt":100/);
  assert.match(captured.systemPrompt,/original-history/);
  assert.match(captured.systemPrompt,/not this executor's memory store/);
  assert.match(captured.systemPrompt,/Do not resolve their IDs/);
  assert.deepEqual(f.calls.map(call=>[call.command,call.args.workdir??call.args.args.workdir]),[["memory_index_overview","/original-scope"],["memory_read","/original-scope"]]);
});

test("missing original memory stays missing without model calls or same-named executor substitution",async()=>{
  for(const options of [{indexFails:true},{readFails:true},{entries:[]}]){
    const f=fixture(options),source=original();
    const captured=await f.captureBackgroundOriginMemory(source,"/origin","evening exercise",new AbortController().signal);
    assert.deepEqual(captured.messages,source.messages);
    assert.doesNotMatch(captured.systemPrompt,/I prefer evening exercise after dinner/);
    if(options.readFails)assert.match(captured.systemPrompt,/original-scope entries were unavailable/);
    else assert.equal(captured,source);
    assert.ok(f.calls.every(call=>["memory_index_overview","memory_read"].includes(call.command)));
  }
});

test("source enrichment never trims an at-limit original conversation",async()=>{
  const f=fixture(),source=original();source.systemPrompt="";
  const envelopeBytes=new TextEncoder().encode(JSON.stringify(source)).length;
  source.systemPrompt="x".repeat(2*1024*1024-envelopeBytes);
  const captured=await f.captureBackgroundOriginMemory(source,"/origin","evening exercise",new AbortController().signal);
  assert.equal(captured,source);assert.equal(new TextEncoder().encode(JSON.stringify(captured)).length,2*1024*1024);
  assert.equal(captured.messages[0].content,"Remind me about evening exercise");
});

test("cancellation before/during original reads cannot become a fallback handoff snapshot",async()=>{
  const before=new AbortController();before.abort(new Error("Task stopped"));const first=fixture();
  await assert.rejects(first.captureBackgroundOriginMemory(original(),"/origin","exercise",before.signal),/Task stopped/);assert.equal(first.calls.length,0);
  const during=new AbortController(),second=fixture({onRead:()=>during.abort(new Error("Task stopped during recall"))});
  await assert.rejects(second.captureBackgroundOriginMemory(original(),"/origin","evening exercise",during.signal),/Task stopped during recall/);
  assert.equal(second.calls.length,2);
});

test("unrelated/code/reference entries are not exported; body/source limits and truncation remain explicit",async()=>{
  const f=fixture({entries:[preference(),preference("code",{memoryType:"project"}),preference("reference",{memoryType:"reference"}),preference("other",{description:"Jazz albums",headline:"Music"})],body:"运动".repeat(1000),truncated:true});
  const captured=await f.captureBackgroundOriginMemory(original(),"/origin","evening exercise",new AbortController().signal);
  assert.equal(f.calls.filter(call=>call.command==="memory_read").length,1);
  const line=captured.systemPrompt.split("\n").find(line=>line.startsWith('{"slug"'));
  const evidence=JSON.parse(line);assert.equal(Array.from(evidence.excerpt).length,600);assert.equal(evidence.truncated,true);
  assert.equal(evidence.slug,"exercise");assert.equal(evidence.sourceTruncated,false);
});
