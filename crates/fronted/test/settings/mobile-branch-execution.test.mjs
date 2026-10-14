import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const device = "11111111-1111-4111-8111-111111111111";
const controller = "22222222-2222-4222-8222-222222222222";
const source = { id:"calendar",requirement:"Schedule on the original phone",dependsOn:["report"],locality:"initiating-device" };
const proposal = {kind:"calendar_event",sourceId:"actual-source",request:{title:"Event",calendarId:"actual-calendar",startMs:2000000000000,endMs:2000003600000,allDay:false,notes:null,location:null}};
const plan = () => ({version:1,requestId:"request",sourceHostId:controller,source:{...source,dependsOn:[...source.dependsOn]},
  actions:[{sourceId:proposal.sourceId,input:{operationId:"a".repeat(64),deviceHostId:device,kind:proposal.kind,request:{...proposal.request}}}]});
const clone = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => { for(let i=0;i<80;i++) await Promise.resolve(); };

test("phone action proposals normalize tool roundtrips and never infer account/default/time", () => {
  const {parseMobileBranchProposals,mobileBranchToolCall} = createTsModuleLoader().loadModule("src/lib/automation/mobileBranchActions.ts");
  const actions = parseMobileBranchProposals({actions:[{...proposal,request:{...proposal.request,title:" Event ",notes:" note "}}]});
  assert.equal(actions[0].request.title,"Event"); assert.equal(actions[0].request.notes,"note");
  const call = mobileBranchToolCall({...plan().actions[0],input:{...plan().actions[0].input,request:actions[0].request}});
  assert.equal(Date.parse(call.arguments.start),actions[0].request.startMs);
  assert.equal(call.arguments.calendar_id,"actual-calendar");
  for(const change of [{sourceId:""}, {kind:"home"}, {request:{...proposal.request,calendarId:""}}, {request:{...proposal.request,endMs:proposal.request.startMs}}, {request:{...proposal.request,expectedSourceId:"injected"}}])
    assert.throws(()=>parseMobileBranchProposals({actions:[{...proposal,...change}]}));
  assert.throws(()=>parseMobileBranchProposals({actions:[],completed:true}));
});

test("phone recurring reminders require a first due time and preserve daily/weekly frequency", () => {
  const {parseMobileBranchProposals,mobileBranchToolCall} = createTsModuleLoader().loadModule("src/lib/automation/mobileBranchActions.ts");
  for(const recurrence of ["daily","weekly"]) {
    const action = parseMobileBranchProposals({actions:[{kind:"reminder",sourceId:"source",request:{title:"Exercise",calendarId:"list",dueMs:2000000000000,recurrence}}]})[0];
    const call=mobileBranchToolCall({sourceId:action.sourceId,input:{...plan().actions[0].input,kind:action.kind,request:action.request}});
    assert.equal(call.arguments.recurrence,recurrence); assert.equal(Date.parse(call.arguments.due),action.request.dueMs);
  }
  for(const request of [{title:"Exercise",calendarId:"list",recurrence:"daily"}, {title:"Exercise",calendarId:"list",dueMs:2000000000000,recurrence:"hourly"}])
    assert.throws(()=>parseMobileBranchProposals({actions:[{kind:"reminder",sourceId:"source",request}]}));
});

function execution(options={}) {
  const calls=[], settings={system:{executionMode:"agent",toolPolicies:{"personal:calendar":"allow"},commandSafetyMode:"auto"},
    selectedModel:{customProviderId:"local-model",model:"configured-model"},customProviders:[{id:"local-model",type:"openai",baseUrl:"https://provider.example",apiKey:"local-only-key"}]};
  let state=options.state ?? {plan:options.newPlan?null:plan(),states:options.newPlan?[]:["succeeded"]};
  const signal=new AbortController();
  const backend={
    async getMobileBranchReadAuthorization(){calls.push("read-authorize");return options.readAuthorization?.(calls.filter(call=>call==="read-authorize").length)??{contextHash:"original-task",revision:1,decision:"approved",allowedKinds:["event","reminder"]};},
    async readMobileBranchData(entry,branch,action,request){calls.push("native-read");assert.equal(entry,"entry");assert.equal(branch,"calendar");if(options.readData)return options.readData(action,request);assert.equal(action,"list_calendars");assert.deepEqual(request,{kind:"event"});return {calendars:[{id:"actual-calendar",sourceId:"actual-source",writable:true}],truncated:false};},
    async getMobileBranchAuthorization(){calls.push("authorize");return options.authorization?.(calls.filter(call=>call==="authorize").length)??{planHash:"frozen-plan",revision:1,decision:"approved",required:true,allowed:true,canApprove:false,canRevoke:true,blockedReason:null};},
    async getReceivedDeviceBranches(){calls.push("handoff");return {planningVersion:options.planningVersion,requestId:"request",hostId:controller,initiatingHostId:device,branches:[{source:clone(options.source??source),ready:options.ready??true,state:options.branchState??"waiting"}]};},
    async exchangeOriginalDevicePlanning(entry,branch){calls.push("controller-plan");assert.equal(entry,"entry");assert.equal(branch,"calendar");if(options.controllerFails)throw new Error("Original controller offline");if(options.controllerReady)state={plan:plan(),states:["unexecuted"]};options.afterController?.(signal);},
    async readMobileBranch(){calls.push("read");return clone(state);},
    async getMobileBranchContext(){calls.push("reserve");return {prompt:"Original compound request",sourceContext:options.sourceContext??{version:1,requestScope:"original-task",systemPrompt:"Original memory",messages:[{role:"user",content:"Original compound request",timestamp:1}]},planning:{attempts:3,recovery:4}};},
    async noteMobileBranchError(entry,branch,error,planning){options.diagnostic?.({entry,branch,error,planning});},
    async getReceivedBackgroundTask(){return {outcomes:{branches:[{branch:{id:"report"},state:"verified",evidence:{answer:"Actual report"}}]}};},
    async prepareMobileBranch(_entry,_branch,actions){calls.push("prepare");assert.equal(actions[0].sourceId,proposal.sourceId);state={plan:plan(),states:["unexecuted"]};options.afterPrepare?.(settings);return clone(state.plan);},
    async executeMobileBranchAction(_entry,_branch,index,request){
      calls.push("native-write");assert.equal(index,0);assert.deepEqual(request,proposal.request);
      const value={input:clone(state.plan.actions[0].input),destination:{kind:"calendar_event",id:"actual-calendar",sourceId:"actual-source",source:"Personal"},
        state:"succeeded",result:{id:"real-fixture-id",presented:false,detail:"Saved"},error:null,startedAt:1,finishedAt:2};
      options.receipt?.(value);state.states=["succeeded"];return value;
    },
    async completeMobileBranch(){calls.push("native-complete");if(options.lostAck)throw new Error("ACK lost");return {accepted:true};},
  };
  const loader=createTsModuleLoader({mocks:{
    "./backend":{backend},
    "../settings":{normalizeSettings:value=>value,isAgentExecutionMode:mode=>mode==="agent",findProviderModelConfig:()=>undefined},
    "../runtimePlatform":{resolveRuntimePlatform:async()=>"ios"},
    "../providers/llm":{assistantMessageToText:assistant=>assistant.content[0].text},
    "../tools/mobilePersonalAssistantTools":{createMobilePersonalAssistantTools(bundleOptions){
      return {tools:[{name:"MobilePersonalData"},{name:"MobilePersonalActions"}],async executeToolCall(call){
        if(call.name==="MobilePersonalData"){
          if(!await bundleOptions.isDurableReadApproved(call))return {role:"toolResult",isError:true};
          const health=call.arguments?.action==="read_health_samples";
          const result=await bundleOptions.executeDurableRead(health?"read_health_samples":"list_calendars",health?options.healthRequest:{kind:"event"});return {role:"toolResult",isError:false,content:[{type:"text",text:JSON.stringify(result)}]};
        }
        if(options.exerciseApproval && !await bundleOptions.isDurableWriteApproved(options.candidate?.(call)??call)) return {role:"toolResult",isError:true};
        await bundleOptions.executeDurableWrite("calendar_event",clone(proposal.request));
        return {role:"toolResult",isError:false};
      }};
    }},
    "../chat/runner/agentRunner":{async runAssistantWithTools(params){
      calls.push("model");assert.equal(params.model,"configured-model");assert.equal(params.runtime.apiKey,"local-only-key");
      assert.deepEqual(params.tools.map(tool=>tool.name),["MobilePersonalData"]);
      await assert.rejects(params.executeToolCall({name:"MobilePersonalActions",arguments:{action:"create_reminder"}}),/only authorized/);
      await params.executeToolCall({name:"MobilePersonalData",arguments:{action:"list_calendars"}});
      await options.model?.(params);
      options.afterModel?.(signal);
      return {assistant:{stopReason:"stop",content:[{type:"text",text:options.modelText??JSON.stringify({actions:[proposal]})}]}};
    }},
  }});
  const {executeMobileDeviceBranch}=loader.loadModule("src/lib/automation/mobileBranchExecution.ts");
  return {calls,settings,state,run:()=>executeMobileDeviceBranch(()=>settings,"entry","calendar",signal.signal)};
}

test("controller planning waits then executes a retained phone plan without local model/provider credentials", async () => {
  const options={newPlan:true,planningVersion:1,controllerReady:false};
  const f=execution(options);f.settings.selectedModel=null;f.settings.customProviders=[];
  await f.run();
  assert.deepEqual(f.calls,["handoff","read","controller-plan","read"]);
  options.controllerReady=true;await f.run();
  assert.equal(f.calls.includes("model"),false);assert.equal(f.calls.includes("reserve"),false);
  assert.equal(f.calls.filter(call=>call==="native-write").length,1);
  assert.equal(f.calls.at(-1),"native-complete");
  await f.run();assert.equal(f.calls.filter(call=>call==="native-write").length,1);
});

test("controller failure, abort or missing phone write grant cannot fall back to another planner or execute effects",async()=>{
  for(const mode of ["offline","abort","grant"]){
    const f=execution({newPlan:true,planningVersion:1,controllerReady:true,controllerFails:mode==="offline",
      afterController:signal=>{if(mode==="abort")signal.abort(new Error("Phone left"));},
      authorization:()=>({allowed:false,blockedReason:"Exact phone scope was revoked"})});
    await assert.rejects(f.run(),mode==="offline"?/controller offline/:mode==="abort"?/Phone left/:/revoked/);
    assert.equal(f.calls.some(call=>["model","reserve","native-write","native-complete"].includes(call)),false);
  }
});

test("a verified phone branch without a local plan cannot open a new controller planning exchange",async()=>{
  const f=execution({newPlan:true,planningVersion:1,branchState:"verified",ready:false});await f.run();
  assert.deepEqual(f.calls,["handoff","read"]);
});

test("a native read-only health exchange never falls back to phone planning or manufactures write receipts after reconnect",async()=>{
  const options={newPlan:true,planningVersion:1,source:{...source,observation:{kind:"health_samples",metric:"heart_rate",startMs:1000,endMs:2000,limit:200}},
    afterController:()=>{options.ready=false;options.branchState="verified";}};
  const f=execution(options);f.settings.selectedModel=null;f.settings.customProviders=[];
  await f.run();assert.deepEqual(f.calls,["handoff","read","controller-plan","read"]);
  await f.run();assert.deepEqual(f.calls.slice(4),["handoff","read"]);
  assert.equal(f.calls.some(call=>["model","reserve","prepare","authorize","native-write","native-complete"].includes(call)),false);
});

test("retained complete phone actions retry only native receipt delivery and never call model/SDK", async () => {
  const f=execution({lostAck:true});await assert.rejects(f.run(),/ACK lost/);await assert.rejects(f.run(),/ACK lost/);
  assert.equal(f.calls.filter(call=>call==="native-complete").length,2);
  assert.equal(f.calls.filter(call=>call==="model"||call==="native-write").length,0);
});

test("unknown/running phone actions stay unfinished without replanning or replay", async () => {
  for(const state of ["unknown","running"]) {
    const f=execution({state:{plan:plan(),states:[state]}});
    await assert.rejects(f.run(),/will not be replayed/);
    assert.equal(f.calls.some(call=>["model","native-write","native-complete"].includes(call)),false);
  }
});

test("real dependency readiness gates native planning and completed callback ACK can recover", async () => {
  const waiting=execution({newPlan:true,ready:false});await waiting.run();assert.deepEqual(waiting.calls,["handoff","read"]);
  const completed=execution({ready:false,branchState:"verified"});await completed.run();assert.equal(completed.calls.at(-1),"native-complete");
});

test("new phone plans use captured history and actual local model before frozen native writes", async () => {
  const f=execution({newPlan:true});await f.run();
  assert.deepEqual(f.calls,["handoff","read","read-authorize","reserve","model","read-authorize","read-authorize","native-read","prepare","read","authorize","native-write","native-complete"]);
});

test("deferred phone planning retains the original local day and timestamp instead of recovery time", async () => {
  const timestampMs=Date.parse("2026-10-14T06:30:00Z");
  const sourceContext={version:2,requestScope:"original-task",systemPrompt:"Original memory",originalRequest:"Arrange tomorrow",
    messages:[{role:"user",content:"Arrange tomorrow",timestamp:timestampMs}],requestClock:{timestampMs,timeZone:"America/Los_Angeles"}};
  const f=execution({newPlan:true,sourceContext,model(params){
    assert.match(params.context.systemPrompt,/original local date: 2026-10-13/);
    assert.match(params.context.systemPrompt,/never execution\/recovery time/);
    assert.match(params.context.systemPrompt,/availability\/past-due checks only/);
    assert.equal(params.context.messages[1].timestamp,timestampMs);
  }});
  await f.run();assert.equal(f.calls.filter(call=>call==="native-write").length,1);
});

test("reviewed native health observations inform phone planning with bounded scope metadata and no health effect",async()=>{
  const scope={kind:"health",id:"heart_rate",sourceId:"healthkit",startMs:1791504000000,endMs:1791590400000,writable:false};
  const healthRequest={metric:scope.id,startMs:scope.startMs,endMs:scope.endMs,limit:12};
  const health={metric:"heart_rate",unit:"bpm",startMs:scope.startMs,endMs:scope.endMs,source:"healthkit",samples:[{id:"observed-id",value:80,startMs:scope.startMs+1,endMs:scope.startMs+1,source:"actual-source"}],accessLimited:true,truncated:false};
  let reads=0;
  const f=execution({newPlan:true,healthRequest,
    readAuthorization:()=>({contextHash:"original-task",revision:2,decision:"approved",selections:[scope],allowedKinds:["event","health"]}),
    readData(action,request){if(action==="list_calendars")return {calendars:[]};reads++;assert.equal(action,"read_health_samples");assert.deepEqual(request,healthRequest);return {health};},
    async model(params){assert.ok(params.context.systemPrompt.includes(JSON.stringify([scope])));const result=await params.executeToolCall({name:"MobilePersonalData",arguments:{action:"read_health_samples",metric:"heart_rate"}});assert.deepEqual(JSON.parse(result.content[0].text),{health});},
  });
  await f.run();assert.equal(reads,1);assert.equal(f.calls.filter(call=>call==="native-write").length,1);assert.equal(f.calls.at(-1),"native-complete");
});

test("read revision or context changes stop a planning attempt before data, writes or completion even under ALLOW",async()=>{
  for(const change of ["revision","context","decision"]) {
    const f=execution({newPlan:true,readAuthorization:count=>({contextHash:change==="context"&&count>2?"changed":"original-task",revision:change==="revision"&&count>2?2:1,decision:change==="decision"&&count>2?"revoked":"approved",allowedKinds:["event"]})});
    await assert.rejects(f.run(),/changed during planning/);
    assert.equal(f.calls.some(call=>["native-read","prepare","native-write","native-complete"].includes(call)),false);
  }
});

test("missing task read approval leaves model budget untouched; a read grant never grants a write",async()=>{
  for(const decision of ["pending","revoked"]) {
    const f=execution({newPlan:true,readAuthorization:()=>({contextHash:"original-task",decision,allowedKinds:[]})});
    await assert.rejects(f.run(),/no model attempt was reserved/);
    assert.equal(f.calls.some(call=>["reserve","model","native-read","prepare","native-write"].includes(call)),false);
  }
  const f=execution({newPlan:true,authorization:()=>({planHash:"frozen-plan",decision:"pending",allowed:false})});
  await assert.rejects(f.run(),/approval/);assert.equal(f.calls.includes("native-read"),true);assert.equal(f.calls.includes("native-write"),false);
});

test("unapproved/revoked phone plan cannot prompt OS access or claim an effect", async()=>{
  for(const decision of ["pending","revoked"]) {
    const f=execution({state:{plan:plan(),states:["unexecuted"]},authorization:()=>({planHash:"frozen-plan",decision,allowed:false})});
    await assert.rejects(f.run(),/approval/);assert.equal(f.calls.includes("native-write"),false);assert.equal(f.calls.includes("native-complete"),false);
  }
});

test("write ASK grant is reread for the exact call and immutable plan hash",async()=>{
  const approved=execution({state:{plan:plan(),states:["unexecuted"]},exerciseApproval:true});await approved.run();
  assert.equal(approved.calls.filter(call=>call==="authorize").length,2);
  for(const change of ["revoked","hash","call"]) {
    const f=execution({state:{plan:plan(),states:["unexecuted"]},exerciseApproval:true,
      candidate:change==="call"?call=>({...call,id:"different-operation"}):undefined,
      authorization:count=>({planHash:change==="hash"&&count>1?"changed-plan":"frozen-plan",decision:change==="revoked"&&count>1?"revoked":"approved",allowed:!(change==="revoked"&&count>1)})});
    await assert.rejects(f.run(),/unfinished/);assert.equal(f.calls.includes("native-write"),false,change);
  }
});

test("invalid planning, cancellation and disabled execution never start an OS effect", async () => {
  const invalid=execution({newPlan:true,modelText:'{"actions":[],"done":true}'});await assert.rejects(invalid.run());assert.equal(invalid.calls.includes("prepare"),false);
  const cancelled=execution({newPlan:true,afterModel:signal=>signal.abort()});await assert.rejects(cancelled.run());assert.equal(cancelled.calls.includes("prepare"),false);
  const disabled=execution({newPlan:true,afterPrepare:settings=>settings.system.executionMode="chat"});
  await assert.rejects(disabled.run(),/disabled/);assert.equal(disabled.calls.includes("native-write"),false);
});

test("native operation/account/receipt mismatches cannot reach controller completion", async () => {
  for(const receipt of [value=>value.input.deviceHostId=controller,value=>value.destination.sourceId="other-source",value=>value.result.presented=true]) {
    const f=execution({state:{plan:plan(),states:["unexecuted"]},receipt});
    await assert.rejects(f.run());assert.equal(f.calls.includes("native-complete"),false);
  }
});

test("planning failure diagnostics preserve the exact native attempt/recovery ticket",async()=>{
  const diagnostics=[];
  const f=execution({newPlan:true,modelText:"Not a concrete plan",diagnostic:value=>diagnostics.push(value)});
  await assert.rejects(f.run());
  assert.equal(diagnostics.length,1);
  assert.deepEqual(diagnostics[0].planning,{attempts:3,recovery:4});
  assert.equal(diagnostics[0].entry,"entry");assert.equal(diagnostics[0].branch,"calendar");
  assert.equal(f.calls.includes("native-write"),false);
});

test("diagnostic storage failure cannot invalidate actual controller receipt acceptance",async()=>{
  const f=execution({diagnostic:()=>{throw new Error("Diagnostic capacity reached");}});
  await f.run();assert.equal(f.calls.includes("native-complete"),true);
});

function worker(t,options={}) {
  t.mock.timers.enable({apis:["setInterval","setTimeout","Date"],now:1000});
  const executed=[],scans=[];let visible=options.visible??true;
  const {startMobileBranchWorker}=createTsModuleLoader().loadModule("src/lib/automation/mobileBranchWorker.ts");
  const instance=startMobileBranchWorker({
    isVisible:()=>visible,
    async listPendingMobileBranches(cursor){scans.push(["plans",cursor]);return options.plans?.(cursor)??{items:[],nextCursor:null};},
    async listBackgroundInbox(cursor,limit,unreadOnly){scans.push(["inbox",cursor,limit,unreadOnly]);return options.inbox?.(cursor)??{items:[{id:"entry",state:"waiting",readAt:1}],nextCursor:null};},
    async getReceivedDeviceBranches(){return {branches:[{source:{id:"one"},ready:true},{source:{id:"two"},ready:true}]};},
    async execute(entry,branch,signal){executed.push({entry,branch,signal});await options.execute?.(entry,branch,signal);},
  });
  t.after(()=>instance.stop());
  return {instance,executed,scans,setVisible:value=>visible=value};
}

test("phone worker consumes acknowledged waiting tasks and continues independent branch after failure", async t => {
  const f=worker(t,{execute:async(_entry,branch)=>{if(branch==="one")throw new Error("Permission unavailable");}});
  await flush();assert.deepEqual(f.executed.map(call=>call.branch),["one","two"]);
  assert.ok(f.scans.some(scan=>scan[0]==="inbox"&&scan[3]===false));
  t.mock.timers.tick(30_000);await flush();assert.equal(f.executed.length,2);
});

test("explicit native-accepted recovery clears this task's backoff without restarting another owner",async t=>{
  let fail=true;
  const f=worker(t,{execute:async()=>{if(fail)throw new Error("Model unavailable");}});
  await flush();assert.equal(f.executed.length,2);
  fail=false;f.instance.retryEntry("entry");await flush();assert.equal(f.executed.length,4);
  f.instance.stop();f.instance.retryEntry("entry");await flush();assert.equal(f.executed.length,4);
});

test("phone worker paginates native retained plans and notices with at most two task owners", async t => {
  let release;const blocked=new Promise(resolve=>release=resolve);
  const f=worker(t,{
    plans:cursor=>({items:cursor?[{entryId:"three",branchId:"one"}]:[{entryId:"one",branchId:"one"},{entryId:"two",branchId:"one"}],nextCursor:cursor?null:2}),
    inbox:()=>({items:[{id:"one",state:"waiting",readAt:1}],nextCursor:20}),
    execute:()=>blocked,
  });
  await flush();assert.equal(f.executed.length,2);
  t.mock.timers.tick(30_000);await flush();assert.equal(f.executed.length,2);
  assert.ok(f.scans.some(scan=>scan[0]==="plans"&&scan[1]===2));
  release();await flush();await f.instance.refresh();await flush();
  assert.ok(f.executed.some(call=>call.entry==="three"));
});

test("local revocation stops only its task's active branch and leaves other owners running",async t=>{
  const releases=[];
  const f=worker(t,{plans:()=>({items:[{entryId:"one",branchId:"one"},{entryId:"two",branchId:"one"}],nextCursor:null}),inbox:()=>({items:[],nextCursor:null}),execute:()=>new Promise(resolve=>releases.push(resolve))});
  await flush();assert.equal(f.executed.length,2);f.instance.stopEntry("one");
  assert.equal(f.executed.find(call=>call.entry==="one").signal.aborted,true);
  assert.equal(f.executed.find(call=>call.entry==="two").signal.aborted,false);
  f.instance.stop();for(const release of releases)release();await flush();
});

test("hidden or stopped phone worker cannot discover/start more effects, and aborts active work", async t => {
  let release;const f=worker(t,{execute:()=>new Promise(resolve=>release=resolve)});await flush();assert.equal(f.executed.length,1);
  f.setVisible(false);await f.instance.refresh();assert.equal(f.executed[0].signal.aborted,true);
  const scans=f.scans.length;f.instance.stop();f.setVisible(true);release();await flush();t.mock.timers.tick(300_000);await flush();
  assert.equal(f.scans.length,scans);assert.equal(f.executed.length,1);
});
