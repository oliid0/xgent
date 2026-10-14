import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const config = { title:"Product launch", description:"Prepare the presentation", category:"career", parentId:null, steps:[{id:"research",title:"Read documents",done:true}] };
const snapshot = (revision=0,storeId="pc-a") => ({revision,storeId,goals:[],targets:[]});
const deferred = () => { let resolve; const promise=new Promise(yes=>{resolve=yes;}); return {promise,resolve}; };
const tick = async () => { for(let i=0;i<20;i++)await Promise.resolve(); };
function fixture(options={}) {
  const hooks=createReactHookHarness(),calls=[],listeners=new Map(),timers=new Map();let captures=0;
  const previous=globalThis.window;
  globalThis.window={addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:name=>listeners.delete(name),setInterval:(handler,interval)=>{assert.equal(interval,15000);const id=timers.size+1;timers.set(id,handler);return id;},clearInterval:id=>timers.delete(id)};
  const port={invoke:async(command,args)=>{calls.push({command,args});return options.invoke?.(command,args,calls.length)??snapshot(args?.input?.revision+1||0);}};
  const {useGoals}=createTsModuleLoader({mocks:{react:hooks.react,"@xgent/runtime":{isTauriRuntime:()=>false,invoke:()=>{throw new Error("Uncaptured transport");}},"./goalArtifacts":{sameGoalArtifact:(a,b)=>a.id===b.id&&a.requestId===b.requestId&&a.contentHash===b.contentHash&&a.relativePath===b.relativePath&&a.bytes===b.bytes,transferGoalArtifact:async(...args)=>options.transfer?.(...args)??{status:"saved",path:"local/file",bytesWritten:args[1].bytes,contentHash:args[1].contentHash}},"../tools/toolCommandPort":{captureToolCommandPort:async()=>{captures++;return port;}}}}).loadModule("src/lib/automation/useGoals.ts");
  return {calls,hooks,listeners,timers,render:()=>hooks.render(useGoals),get captures(){return captures;},cleanup(){hooks.unmount();globalThis.window=previous;}};
}

test("Goal live reads observe actual task completion without blocking controls or replacing a newer write",async()=>{
  const late=deferred();let reads=0;
  const f=fixture({invoke:(command,args)=>command==="automation_goal_snapshot"?(++reads===1?snapshot():reads===2?{...snapshot(),goals:[{id:"launch",config,status:"active",backgroundTasks:[{requestId:"original",state:"done",success:true}]}]}:late.promise):snapshot(args.input.revision+1)});
  try{
    f.render();await tick();await [...f.timers.values()][0]();
    let ui=f.render();assert.equal(ui.busy,false);assert.equal(ui.snapshot.goals[0].backgroundTasks[0].success,true);assert.equal(ui.snapshot.goals[0].status,"active");assert.equal(f.captures,1);
    const reading=f.listeners.get("focus")();await tick();assert.equal(f.render().busy,false);
    assert.equal(await f.render().apply({op:"set_status",id:"launch",status:"paused"},0),true);
    late.resolve(snapshot(0));await reading;assert.equal(f.render().snapshot.revision,1);
    f.hooks.unmount();assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);
  }finally{f.cleanup();}
});

test("Goal observations retain saved data on an unavailable or changed owner and cannot bypass a lost write receipt",async()=>{
  let mode="offline";const f=fixture({invoke:command=>command==="automation_goal_snapshot"?(f.calls.length===1?snapshot():mode==="offline"?Promise.reject(new Error("PC offline")):snapshot(9,"pc-b")):Promise.reject(new Error("Lost ACK"))});
  try{
    f.render();await tick();await [...f.timers.values()][0]();assert.equal(f.render().observationError,"PC offline");assert.equal(f.render().snapshot.storeId,"pc-a");
    mode="changed";await [...f.timers.values()][0]();assert.equal(f.render().observationError,"goals.ownerChanged");assert.equal(f.render().snapshot.revision,0);
    assert.equal(await f.render().apply({op:"delete",id:"launch"},0),false);const count=f.calls.length;await [...f.timers.values()][0]();assert.equal(f.calls.length,count);assert.equal(f.render().retryAvailable,true);
  }finally{f.cleanup();}
});

test("goal validation preserves completed steps and rejects duplicate, unbounded and malformed content",()=>{
  const {validateGoalConfig}=createTsModuleLoader().loadModule("src/lib/automation/goals.ts");
  validateGoalConfig(config);assert.equal(config.steps[0].done,true);
  for(const patch of [{title:" "},{description:"x".repeat(8001)},{category:"invented"},{parentId:"../other"},{parentId:123},{steps:[config.steps[0],config.steps[0]]},{steps:[{id:"x",title:"Step",done:"yes"}]}])assert.throws(()=>validateGoalConfig({...config,...patch}));
});

test("lost save acknowledgement retries the exact receipt through the same captured owner; no optimistic progress",async()=>{
  let writes=0;const f=fixture({invoke:(command,args)=>{
    if(command==="automation_goal_snapshot")return snapshot();
    if(++writes===1)throw new Error("Response lost");return snapshot(1);
  }});
  try {
    f.render();await tick();let ui=f.render();
    const op={op:"create",id:"launch",config};assert.equal(await ui.apply(op,0),false);
    ui=f.render();assert.equal(ui.snapshot.revision,0);assert.equal(ui.retryAvailable,true);
    assert.equal(await ui.apply({op:"delete",id:"other"},0),false);
    assert.equal(await f.render().retry(),true);
    const writes=f.calls.filter(call=>call.command==="automation_goal_apply");assert.equal(writes.length,2);assert.deepEqual(writes[0].args,writes[1].args);assert.equal(f.captures,1);assert.equal(f.render().retryAvailable,false);
  }finally{f.cleanup();}
});

test("pending Goal edits retain their original content after the caller changes its draft",async()=>{
  let writes=0;
  const f=fixture({invoke:command=>command==="automation_goal_snapshot"?snapshot():++writes===1?Promise.reject(new Error("Lost ACK")):snapshot(1)});
  try{
    f.render();await tick();
    const operation={op:"create",id:"launch",config:structuredClone(config)};
    await f.render().apply(operation,0);
    operation.config.title="Changed draft";operation.config.steps[0].done=false;
    assert.equal(await f.render().retry(),true);
    const calls=f.calls.filter(call=>call.command==="automation_goal_apply");
    assert.deepEqual(calls[0].args,calls[1].args);assert.equal(calls[1].args.input.operation.config.title,config.title);assert.equal(calls[1].args.input.operation.config.steps[0].done,true);
  }finally{f.cleanup();}
});

test("CAS conflict releases a rejected receipt; duplicate clicks and retired owners cannot write",async()=>{
  const pending=deferred();let fail=true;
  const f=fixture({invoke:(command,args)=>command==="automation_goal_snapshot"?snapshot():fail?Promise.reject(new Error("goals.conflict")):pending.promise});
  try {
    f.render();await tick();assert.equal(await f.render().apply({op:"delete",id:"old"},9),false);assert.equal(f.calls.length,1);
    assert.equal(await f.render().apply({op:"delete",id:"old"},0),false);assert.equal(f.render().retryAvailable,false);
    fail=false;const write=f.render().apply({op:"delete",id:"old"},0);await tick();assert.equal(await f.render().apply({op:"delete",id:"other"},0),false);
    f.listeners.get("xgent:lan-pc-session-changed")();pending.resolve(snapshot(1));assert.equal(await write,false);assert.equal(f.render().snapshot,null);
    assert.equal(await f.render().apply({op:"delete",id:"old"},0),false);assert.equal(await f.render().refresh(),true);assert.equal(f.captures,2);
  }finally{f.cleanup();}
});

test("effect replay starts a fresh owner read; old reply cannot overwrite it or unlock a current write",async()=>{
  const first=deferred(),second=deferred(),write=deferred();let reads=0;
  const f=fixture({invoke:command=>command==="automation_goal_snapshot"?(++reads===1?first.promise:second.promise):write.promise});
  try{
    f.render();await tick();f.hooks.replayEffects();await tick();second.resolve(snapshot(4));await tick();assert.equal(f.render().snapshot.revision,4);
    const saving=f.render().apply({op:"set_status",id:"launch",status:"completed"},4);await tick();first.resolve(snapshot(1));await tick();assert.equal(f.render().busy,true);assert.equal(f.render().snapshot.revision,4);
    write.resolve(snapshot(5));assert.equal(await saving,true);assert.equal(f.render().busy,false);
  }finally{f.cleanup();}
});

test("activity paging deduplicates real IDs and discards replies from a retired detail or execution owner",async()=>{
  const late=deferred();let pages=0;
  const item={id:"run:actual",kind:"run",label:"Fitness",at:100,state:"leased",success:null,output:null};
  const f=fixture({invoke:command=>command==="automation_goal_snapshot"?snapshot():++pages===1?{goalId:"launch",items:[item],nextCursor:{at:100,id:item.id}}:pages===2?{goalId:"launch",items:[item,{...item,id:"edit:1",kind:"created"}],nextCursor:null}:late.promise});
  try{
    f.render();await tick();await f.render().readActivity("launch");await f.render().readActivity("launch",f.render().activity.nextCursor);assert.equal(f.render().activity.items.length,2);assert.equal(f.render().activity.items[0].state,"leased");
    const reading=f.render().readActivity("launch");f.render().retireActivity();late.resolve({goalId:"launch",items:[item],nextCursor:null});await reading;assert.equal(f.render().activity,null);assert.equal(f.render().activityBusy,false);
  }finally{f.cleanup();}
});

test("GoalManager exposes real revisions, schedules and errors through the configured command port",async()=>{
  const calls=[],port={invoke:async(command,args)=>{calls.push({command,args});if(command==="automation_goal_snapshot")return {...snapshot(7),goals:[{id:"launch",config}],targets:[{id:"fitness",name:"Fitness",enabled:true,exists:true,cron:"0 20 * * *"}]};if(command==="automation_goal_apply")throw new Error("goals.conflict");return {goalId:args.goal_id,items:[],nextCursor:null};}};
  const {createGoalTools}=createTsModuleLoader({mocks:{"@xgent/runtime":{invoke:()=>{throw new Error("Wrong host");}}}}).loadModule("src/lib/tools/goalTools.ts");
  const tools=createGoalTools({commandPort:port}),run=argumentsValue=>tools.executeToolCall({id:"call",name:"GoalManager",arguments:argumentsValue});
  const result=await run({action:"read"});assert.equal(result.isError,false);assert.equal(JSON.parse(result.content[0].text).revision,7);assert.equal(JSON.parse(result.content[0].text).targets[0].id,"fitness");
  const write=await run({action:"apply",input:{revision:7,requestId:"receipt",operation:{op:"set_status",id:"launch",status:"completed"}}});assert.equal(write.isError,true);assert.equal(write.content[0].text,"goals.conflict");assert.equal(calls.at(-1).args.input.requestId,"receipt");
  assert.equal((await run({action:"activity",goal_id:"launch"})).isError,false);assert.equal(calls.at(-1).args.limit,20);
});

test("artifact paging remains pinned to the actual execution store and ignores retired replies",async()=>{
  const item={id:"file",requestId:"original",relativePath:"actual.pptx",contentHash:"a".repeat(64),bytes:12,taskName:"Product",at:100},late=deferred();let reads=0;
  const page=items=>({goalId:"launch",storeId:"pc-a",items,nextCursor:{at:100,id:"file"}});
  const f=fixture({invoke:command=>command==="automation_goal_snapshot"?snapshot():++reads===1?page([item]):reads===2?page([item,{...item,id:"next"}]):reads===3?{...page([item]),storeId:"other"}:late.promise});
  try{
    f.render();await tick();await f.render().readArtifacts("launch");await f.render().readArtifacts("launch",f.render().artifacts.nextCursor);assert.equal(f.render().artifacts.items.length,2);
    await f.render().readArtifacts("launch");assert.equal(f.render().artifacts,null);assert.equal(f.render().artifactsError,"goals.ownerChanged");
    const reading=f.render().readArtifacts("launch");f.render().retireArtifacts();late.resolve(page([item]));await reading;assert.equal(f.render().artifacts,null);assert.equal(f.render().artifactsBusy,false);assert.equal(f.captures,1);
  }finally{f.cleanup();}
});

test("artifact fetch and local write outcomes cannot report success after changing owner or leaving the view",async()=>{
  const artifact={id:"file",requestId:"original",relativePath:"actual.pptx",contentHash:"a".repeat(64),bytes:12,taskName:"Product",at:100};
  for(const phase of ["fetch","write"]){const pending=deferred();let transfers=0;
    const f=fixture({invoke:command=>command==="automation_goal_snapshot"?snapshot():command==="automation_goal_artifacts"?{goalId:"launch",storeId:"pc-a",items:[artifact],nextCursor:null}:phase==="fetch"?pending.promise:{artifact,contentBase64:"actual"},transfer:()=>{transfers++;return pending.promise;}});
    try{
      f.render();await tick();await f.render().readArtifacts("launch");const download=f.render().downloadArtifact("launch",artifact,"/phone",()=>true);await tick();
      if(phase==="fetch")f.listeners.get("xgent:lan-pc-session-changed")();else f.render().retireArtifacts();
      pending.resolve(phase==="fetch"?{artifact,contentBase64:"actual"}:{status:"saved",path:"local/file",bytesWritten:12,contentHash:artifact.contentHash});await download;
      assert.deepEqual(f.render().transfers,{});assert.equal(transfers,phase==="fetch"?0:1);assert.equal(f.render().downloadBusy,null);
    }finally{f.cleanup();}
  }
});
