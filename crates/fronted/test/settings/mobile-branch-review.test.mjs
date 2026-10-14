import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const flush = async () => { for(let i=0;i<50;i++) await Promise.resolve(); };
const clone = value => JSON.parse(JSON.stringify(value));
const source = {id:"calendar",requirement:"Arrange the actual event",dependsOn:["report"],locality:"initiating-device"};
const review = (options={}) => ({requestId:"request",sourceHostId:"controller",deviceHostId:"phone",cancelRequested:false,branches:[{
  source,plan:null,records:[],labels:[],attempts:3,recovery:2,lastError:"Actual planning failure",acknowledged:false,canRetryPlanning:true,...options,
}]});
function setup(options={}) {
  const hooks=createReactHookHarness(),calls=[],wakes=[],revokes=[];
  let selected={entry:"entry",request:"request",host:"controller"}, retained=review();
  const backend={
    async getMobileBranchReadAuthorization(){calls.push(["read-auth"]);return clone(retained.branches[0].readAuthorization);},
    async getMobileBranchReadChoices(entry,branch,kind){calls.push(["choices",entry,branch,kind]);return await options.choices?.(kind)??{authorization:clone(retained.branches[0].readAuthorization),kind,calendars:Array.from({length:25},(_,i)=>({id:`list-${i}`,sourceId:`account-${i}`,title:`List ${i}`,source:"Actual OS account",writable:i!==0,isDefault:false})),truncated:true};},
    async decideMobileBranchReadAuthorization(...args){calls.push(["read-decide",...args]);await options.readDecide?.();retained.branches[0].readAuthorization={...retained.branches[0].readAuthorization,revision:args[3]+1,decision:args[5]?"approved":"revoked",allowedKinds:args[5]?["event"]:[],canRevoke:args[5]};},
    async inspectMobileBranches(entry){calls.push(["read",entry]);return options.read?.(entry)??clone(retained);},
    async retryMobileBranchPlanning(entry,branch,recovery){calls.push(["retry",entry,branch,recovery]);await options.retry?.();retained.branches[0].attempts=0;retained.branches[0].recovery++;retained.branches[0].canRetryPlanning=false;},
    async decideMobileBranchAuthorization(entry,branch,hash,revision,approve){calls.push(["decide",entry,branch,hash,revision,approve]);await options.decide?.();retained.branches[0].authorization={...retained.branches[0].authorization,revision:revision+1,decision:approve?"approved":"revoked",allowed:approve,canApprove:!approve,canRevoke:approve};},
  };
  const loader=createTsModuleLoader({mocks:{react:hooks.react,"../../lib/automation/backend":{backend},
    "../../lib/tools/mobilePersonalAssistantTools":{async ensureMobilePersonalReadPermission(kind,signal){calls.push(["os-permission",kind]);await options.permission?.(kind,signal);signal.throwIfAborted();}},
    "../../lib/automation/mobileBranchEvents":{notifyMobileBranchRecovery:entry=>wakes.push(entry),notifyMobileBranchRevocation:entry=>revokes.push(entry)},
  }});
  const {useMobileBranchReview}=loader.loadModule("src/pages/settings/useMobileBranchReview.ts");
  const render=()=>hooks.render(()=>useMobileBranchReview(selected.entry,selected.request,selected.host));
  return {hooks,calls,wakes,revokes,render,select:next=>{selected=next;},setReview:value=>{retained=value;}};
}

test("local review never reserves model attempts or writes; exhausted recovery wakes only after native acceptance", async t=>{
  const f=setup();t.after(()=>f.hooks.unmount());assert.equal(f.render().loading,true);await flush();
  const view=f.render();assert.equal(view.review.branches[0].attempts,3);
  assert.deepEqual(f.calls,[["read","entry"]]);
  await view.retryPlanning("calendar",2);await flush();
  assert.deepEqual(f.calls,[["read","entry"],["retry","entry","calendar",2],["read","entry"]]);
  assert.deepEqual(f.wakes,["entry"]);assert.equal(f.render().review.branches[0].recovery,3);
});

test("stale expected generation, cancelled branch and unavailable recovery never call native reset", async t=>{
  for(const value of [review(),{...review(),cancelRequested:true},review({canRetryPlanning:false})]) {
    const f=setup();t.after(()=>f.hooks.unmount());f.setReview(value);f.render();await flush();
    await f.render().retryPlanning("calendar",value.cancelRequested?2:99);
    assert.equal(f.calls.some(([call])=>call==="retry"),false);
  }
});

test("original controller or request mismatch is an error and disables recovery",async t=>{
  for(const patch of [{requestId:"other"},{sourceHostId:"other"}]) {
    const f=setup({read:()=>({...review(),...patch})});t.after(()=>f.hooks.unmount());f.render();await flush();
    assert.match(f.render().error,/original task/);assert.equal(f.render().review,null);
    await f.render().retryPlanning("calendar",2);assert.equal(f.wakes.length,0);
  }
});

test("retired task view rejects its old actions and late reads",async t=>{
  let release;
  const f=setup({read:entry=>entry==="entry"?new Promise(resolve=>{release=resolve;}):{...review(),requestId:"next"}});
  t.after(()=>f.hooks.unmount());const old=f.render();
  f.select({entry:"next-entry",request:"next",host:"controller"});f.render();await flush();
  release(review());await flush();assert.equal(f.render().review.requestId,"next");
  await old.retryPlanning("calendar",2);assert.equal(f.calls.some(([call])=>call==="retry"),false);
});

test("duplicate recovery click is serialized; offline rejection retains failure and never wakes",async t=>{
  let reject;
  const f=setup({retry:()=>new Promise((_resolve,fail)=>{reject=fail;})});t.after(()=>f.hooks.unmount());f.render();await flush();
  const view=f.render(),first=view.retryPlanning("calendar",2);await view.retryPlanning("calendar",2);
  assert.equal(f.calls.filter(([call])=>call==="retry").length,1);
  reject(new Error("Original controller offline"));await first;
  assert.match(f.render().error,/offline/);assert.equal(f.render().busy,false);assert.equal(f.render().review.branches[0].attempts,3);
  assert.deepEqual(f.wakes,[]);
});

test("native recovery survives navigation while late UI updates cannot replace another task",async t=>{
  let release;
  const f=setup({retry:()=>new Promise(resolve=>{release=resolve;})});t.after(()=>f.hooks.unmount());f.render();await flush();
  const pending=f.render().retryPlanning("calendar",2);
  f.select({entry:"next",request:"request",host:"controller"});f.render();await flush();release();await pending;
  assert.deepEqual(f.wakes,["entry"]);
  assert.equal(f.calls.filter(([call])=>call==="read").length,2);
});

test("unmount retires actions and disabled desktop/browser branch owns no read or timer",async()=>{
  const f=setup();f.select({entry:null,request:"",host:""});assert.equal(f.render().loading,false);await flush();assert.deepEqual(f.calls,[]);
  f.select({entry:"entry",request:"request",host:"controller"});f.render();await flush();const view=f.render();f.hooks.unmount();
  await view.retryPlanning("calendar",2);assert.deepEqual(f.wakes,[]);
});

const authorization = {planHash:"exact-native-hash",revision:2,decision:"pending",allowed:false,required:true,canApprove:true,canRevoke:true,blockedReason:null};

const readAuthorization={contextHash:"original-task-hash",revision:0,decision:"pending",selections:[],allowedKinds:[],canDiscoverKinds:["event","reminder"],blockedReasons:{},canApprove:true,canRevoke:true};
const readKey=choice=>JSON.stringify([choice.kind,choice.id,choice.sourceId]);

test("health metric discovery prompts no generic OS grant and approval retains the exact displayed interval",async t=>{
  const auth={...readAuthorization,canDiscoverKinds:["event","reminder","health"]};
  const metric={id:"heart_rate",sourceId:"healthkit",title:"heart_rate",source:"HealthKit",writable:false,isDefault:false,startMs:1791590400000,endMs:1791676800000};
  const f=setup({choices:()=>({authorization:auth,kind:"health",calendars:[metric],truncated:false})});t.after(()=>f.hooks.unmount());
  f.setReview(review({readAuthorization:auth}));f.render();await flush();
  await f.render().loadReadChoices("calendar","health",auth.contextHash,0);
  assert.equal(f.calls.some(([call])=>call==="os-permission"),false);assert.deepEqual(f.wakes,[]);
  const {mobileReadChoiceKey}=createTsModuleLoader().loadModule("src/lib/automation/mobileBranchActions.ts");
  let view=f.render(),draft=view.readChoices.calendar;
  view.editReadChoices("calendar",draft.generation,mobileReadChoiceKey(draft.choices[0]));
  view=f.render();draft=view.readChoices.calendar;
  await view.decideReadAuthorization("calendar",auth.contextHash,0,draft.generation,true);
  assert.deepEqual(f.calls.find(([call])=>call==="read-decide"),["read-decide","entry","calendar",auth.contextHash,0,[{kind:"health",id:metric.id,sourceId:metric.sourceId,startMs:metric.startMs,endMs:metric.endMs}],true]);
  assert.deepEqual(f.wakes,["entry"]);
  assert.notEqual(mobileReadChoiceKey({...metric,kind:"health"}),mobileReadChoiceKey({...metric,kind:"health",endMs:metric.endMs+1}));
});

test("both UI paths show actual health choices and bound approval with concise metric/range metadata",async()=>{
  const loader=createTsModuleLoader({mocks:{"react-dom":{flushSync:fn=>fn()}}});
  const {mobileBranchReviewNodes}=loader.loadModule("src/pages/settings/mobileBranchReviewNodes.ts"),{presentationControls}=loader.loadModule("src/presentation/controls.ts"),{validatePresentationDocument}=loader.loadModule("src/presentation/validateDocument.ts");
  const auth={...readAuthorization,canDiscoverKinds:["health"]},scope={kind:"health",id:"heart_rate",sourceId:"health-connect",title:"heart_rate",source:"Health Connect",writable:false,startMs:1791590400000,endMs:1791676800000};
  const calls=[],c=presentationControls(),view={review:review({readAuthorization:auth}),readChoices:{calendar:{contextHash:auth.contextHash,revision:0,generation:7,choices:[scope],selected:[scope],page:0,truncated:false}},loading:false,busy:false,error:null,refresh(){},retryPlanning(){},decideAuthorization(){},loadReadChoices:(...args)=>calls.push(["load",...args]),editReadChoices(){},decideReadAuthorization:(...args)=>calls.push(["decide",...args])};
  const nodes=mobileBranchReviewNodes(c,view,key=>key),flatten=items=>items.flatMap(node=>[node,...flatten(node.children??[])]),row=flatten(nodes).find(node=>node.id.includes(":choose:"));
  assert.equal(row.label,"proactive.metric.heart_rate");assert.ok(row.text.includes("Health Connect"));assert.equal(row.selected,true);
  validatePresentationDocument({version:1,surface:"review",revision:1,mode:"root",nodes},c.handlers);
  for(const action of ["load:health","approve:7"])await c.handlers.get(`inbox:phone:branch:calendar:read:${action}`).run(null);
  assert.deepEqual(calls,[["load","calendar","health",auth.contextHash,0],["decide","calendar",auth.contextHash,0,7,true]]);
});

test("shared native/Astryx read controls use actual IDs, generation-bound actions and separate read approval",async()=>{
  const loader=createTsModuleLoader({mocks:{"react-dom":{flushSync:fn=>fn()}}});
  const {mobileBranchReviewNodes}=loader.loadModule("src/pages/settings/mobileBranchReviewNodes.ts"),{presentationControls}=loader.loadModule("src/presentation/controls.ts");
  const {validatePresentationDocument}=loader.loadModule("src/presentation/validateDocument.ts");
  const choices=Array.from({length:25},(_,i)=>({kind:"event",id:`list-${i}`,sourceId:`account-${i}`,source:"OS account",title:`List ${i}`,writable:i!==0}));
  const calls=[],draft={contextHash:readAuthorization.contextHash,revision:0,generation:7,choices,selected:[choices[0]],page:0,truncated:true};
  const view={review:review({readAuthorization}),readChoices:{calendar:draft},loading:false,busy:false,error:null,refresh(){},retryPlanning(){},decideAuthorization(){},
    loadReadChoices:(...args)=>calls.push(["load",...args]),editReadChoices:(...args)=>calls.push(["edit",...args]),decideReadAuthorization:(...args)=>calls.push(["decide",...args])};
  const c=presentationControls(),nodes=mobileBranchReviewNodes(c,view,key=>key),flatten=items=>items.flatMap(node=>[node,...flatten(node.children??[])]);
  assert.equal(flatten(nodes).filter(node=>node.id.includes(":choose:")&&node.kind==="NavigationRow").length,20);
  assert.ok(!flatten(nodes).some(node=>node.text?.includes("account-0")));
  assert.ok(flatten(nodes).some(node=>node.label==="List 0"&&node.selected));
  assert.ok(flatten(nodes).some(node=>node.text?.includes("mobileBranch.read.readOnly")));
  assert.ok(flatten(nodes).some(node=>node.text==="mobileBranch.read.truncated"));
  for(const id of ["load:event","choose:7:0","next:7","approve:7","revoke:0"])await c.handlers.get(`inbox:phone:branch:calendar:read:${id}`).run(null);
  assert.deepEqual(calls,[["load","calendar","event",readAuthorization.contextHash,0],["edit","calendar",7,readKey(choices[0])],["edit","calendar",7,null,1],["decide","calendar",readAuthorization.contextHash,0,7,true],["decide","calendar",readAuthorization.contextHash,0,null,false]]);
  validatePresentationDocument({version:1,surface:"review",revision:1,mode:"root",nodes},c.handlers);
  const stale=flatten(mobileBranchReviewNodes(presentationControls(),{...view,readChoices:{calendar:{...draft,revision:1}}},key=>key));
  assert.ok(stale.some(node=>node.text==="mobileBranch.read.stale"));
  assert.ok(stale.filter(node=>node.id.includes(":choose:")||node.id.includes(":read:approve:")).every(node=>node.disabled));
});

test("OS list discovery grants nothing; exact selected identities approve once, and offline revocation aborts only its task",async t=>{
  const f=setup();t.after(()=>f.hooks.unmount());f.setReview(review({readAuthorization}));f.render();await flush();
  await f.render().loadReadChoices("calendar","event",readAuthorization.contextHash,0);
  let view=f.render(),draft=view.readChoices.calendar;
  assert.equal(draft.choices.length,25);assert.equal(draft.truncated,true);assert.equal(draft.choices[0].writable,false);
  assert.deepEqual(f.wakes,[]);assert.deepEqual(f.revokes,[]);
  view.editReadChoices("calendar",draft.generation,readKey(draft.choices[0]));
  view=f.render();draft=view.readChoices.calendar;
  await view.decideReadAuthorization("calendar",readAuthorization.contextHash,0,draft.generation,true);
  assert.deepEqual(f.calls.find(([kind])=>kind==="read-decide"),["read-decide","entry","calendar",readAuthorization.contextHash,0,[{kind:"event",id:"list-0",sourceId:"account-0"}],true]);
  assert.deepEqual(f.wakes,["entry"]);assert.equal(f.render().readChoices.calendar,undefined);
  await f.render().decideReadAuthorization("calendar",readAuthorization.contextHash,1,null,false);
  assert.deepEqual(f.revokes,["entry"]);
});

test("read selection is bounded, paginated and generation-fenced; stale scope cannot approve or query",async t=>{
  const f=setup();t.after(()=>f.hooks.unmount());f.setReview(review({readAuthorization}));f.render();await flush();
  await f.render().loadReadChoices("calendar","event",readAuthorization.contextHash,0);
  const retired=f.render(),first=retired.readChoices.calendar;
  for(let i=0;i<17;i++){const view=f.render(),draft=view.readChoices.calendar;view.editReadChoices("calendar",draft.generation,readKey(draft.choices[i]));}
  let view=f.render(),draft=view.readChoices.calendar;assert.equal(draft.selected.length,16);
  await retired.decideReadAuthorization("calendar",readAuthorization.contextHash,0,first.generation,true);
  assert.equal(f.calls.some(([call])=>call==="read-decide"),false);
  view.editReadChoices("calendar",draft.generation,null,1);assert.equal(f.render().readChoices.calendar.page,1);
  f.setReview(review({readAuthorization:{...readAuthorization,revision:1}}));await f.render().refresh();
  await f.render().loadReadChoices("calendar","event",readAuthorization.contextHash,0);
  await f.render().decideReadAuthorization("calendar",readAuthorization.contextHash,0,f.render().readChoices.calendar.generation,true);
  assert.equal(f.calls.filter(([call])=>call==="choices").length,1);assert.deepEqual(f.wakes,[]);
});

test("permission denial and task navigation discard discovery without granting, waking or replacing another view",async t=>{
  const denied=setup({permission:async()=>{throw new Error("OS access denied");}});t.after(()=>denied.hooks.unmount());denied.setReview(review({readAuthorization}));denied.render();await flush();
  await denied.render().loadReadChoices("calendar","event",readAuthorization.contextHash,0);
  assert.match(denied.render().error,/OS access denied/);assert.equal(denied.calls.some(([call])=>call==="choices"),false);assert.deepEqual(denied.wakes,[]);
  let release,signal;
  const f=setup({permission:async(_kind,abort)=>{signal=abort;await new Promise(resolve=>release=resolve);}});t.after(()=>f.hooks.unmount());f.setReview(review({readAuthorization}));f.render();await flush();
  const old=f.render(),pending=old.loadReadChoices("calendar","event",readAuthorization.contextHash,0);await flush();
  f.select({entry:"next",request:"request",host:"controller"});f.render();await flush();assert.equal(signal.aborted,true);release();await pending;
  assert.equal(f.calls.some(([call])=>call==="choices"),false);assert.deepEqual(f.render().readChoices,{});
  await old.decideReadAuthorization("calendar",readAuthorization.contextHash,0,null,false);assert.deepEqual(f.revokes,[]);
});

test("native exact-plan approval wakes execution, while offline local revocation aborts only its original task",async t=>{
  const f=setup();t.after(()=>f.hooks.unmount());f.setReview(review({authorization}));f.render();await flush();
  await f.render().decideAuthorization("calendar",authorization.planHash,2,true);
  assert.deepEqual(f.calls.find(([call])=>call==="decide"),["decide","entry","calendar",authorization.planHash,2,true]);
  assert.deepEqual(f.wakes,["entry"]);assert.equal(f.render().review.branches[0].authorization.revision,3);
  await f.render().decideAuthorization("calendar",authorization.planHash,3,false);
  assert.deepEqual(f.revokes,["entry"]);assert.equal(f.render().review.branches[0].authorization.decision,"revoked");
});

test("stale/hash-changed/denied/cancelled approvals never call native; cancelled task can still revoke",async t=>{
  const f=setup();t.after(()=>f.hooks.unmount());f.setReview({...review({authorization}),cancelRequested:true});f.render();await flush();
  for(const [hash,revision] of [["wrong",2],[authorization.planHash,1],[authorization.planHash,2]])
    await f.render().decideAuthorization("calendar",hash,revision,true);
  assert.equal(f.calls.some(([call])=>call==="decide"),false);
  await f.render().decideAuthorization("calendar",authorization.planHash,2,false);assert.deepEqual(f.revokes,["entry"]);
});

test("duplicate decisions serialize; native rejection never wakes or aborts another task",async t=>{
  let reject;const f=setup({decide:()=>new Promise((_resolve,fail)=>reject=fail)});t.after(()=>f.hooks.unmount());
  f.setReview(review({authorization}));f.render();await flush();const view=f.render();
  const pending=view.decideAuthorization("calendar",authorization.planHash,2,true);
  await view.decideAuthorization("calendar",authorization.planHash,2,true);
  assert.equal(f.calls.filter(([call])=>call==="decide").length,1);
  reject(new Error("Original controller offline"));await pending;
  assert.match(f.render().error,/offline/);assert.deepEqual(f.wakes,[]);assert.deepEqual(f.revokes,[]);
});

test("shared approval controls call the exact native hash/revision without explanatory prose and disable during work",async()=>{
  const loader=createTsModuleLoader({mocks:{"react-dom":{flushSync:fn=>fn()}}});
  const {mobileBranchReviewNodes}=loader.loadModule("src/pages/settings/mobileBranchReviewNodes.ts");
  const {presentationControls}=loader.loadModule("src/presentation/controls.ts");
  const calls=[],c=presentationControls();
  const view={review:review({authorization}),loading:false,busy:false,error:null,refresh(){},retryPlanning(){},decideAuthorization:(...args)=>calls.push(args)};
  const nodes=mobileBranchReviewNodes(c,view,key=>key),flatten=nodes=>nodes.flatMap(node=>[node,...flatten(node.children??[])]);
  assert.ok(!flatten(nodes).some(node=>node.text==="mobileBranch.approvalScope"));
  await c.handlers.get("inbox:phone:branch:calendar:approve").run(null);
  await c.handlers.get("inbox:phone:branch:calendar:revoke").run(null);
  assert.deepEqual(calls,[["calendar",authorization.planHash,2,true],["calendar",authorization.planHash,2,false]]);
  const busy=flatten(mobileBranchReviewNodes(presentationControls(),{...view,busy:true},key=>key));
  assert.equal(busy.filter(node=>["inbox:phone:branch:calendar:approve","inbox:phone:branch:calendar:revoke"].includes(node.id)).every(node=>node.disabled),true);
});

test("shared native/Astryx action nodes show account names without internal IDs; unknown effects have no success/replay control",()=>{
  const loader=createTsModuleLoader({mocks:{"react-dom":{flushSync:fn=>fn()}}});
  const {mobileBranchReviewNodes}=loader.loadModule("src/pages/settings/mobileBranchReviewNodes.ts");
  const {presentationControls}=loader.loadModule("src/presentation/controls.ts");
  const {validatePresentationDocument}=loader.loadModule("src/presentation/validateDocument.ts");
  const input={kind:"reminder",operationId:"a".repeat(64),deviceHostId:"phone",request:{title:"Exercise",calendarId:"real-list",dueMs:2000000000000,recurrence:"daily",notes:"Actual task"}};
  const plan={version:1,requestId:"request",sourceHostId:"controller",source,actions:[{input,sourceId:"real-source"}]};
  const record={input,destination:{id:"real-list",sourceId:"real-source",source:"Personal",kind:"reminder"},state:"succeeded",result:{id:"real-sdk-record",detail:"Saved",presented:false},error:null,startedAt:1,finishedAt:2};
  const flatten=nodes=>nodes.flatMap(node=>[node,...flatten(node.children??[])]);
  for(const state of ["succeeded","unknown","running","unexecuted"]) {
    const c=presentationControls();
    const r=state==="unexecuted"?null:{...record,state,result:state==="succeeded"?record.result:null};
    const nodes=mobileBranchReviewNodes(c,{review:review({plan,records:[r],labels:[{id:"real-list",sourceId:"real-source",title:"My list",source:"Personal"}],canRetryPlanning:false}),loading:false,busy:false,error:null,refresh(){},retryPlanning(){assert.fail("No replan for frozen actions");}},key=>key);
    validatePresentationDocument({version:1,surface:"review",revision:1,mode:"root",nodes},c.handlers);
    const values=flatten(nodes);
    assert.ok(values.some(node=>node.text?.includes("My list")&&node.text.includes("Personal")));
    assert.equal(values.some(node=>node.text?.includes("real-sdk-record")||node.text?.includes("real-source")),false);
    if(state!=="unexecuted")assert.ok(values.some(node=>node.text===`mobileBranch.state.${state}`));
    assert.equal([...c.handlers.keys()].some(key=>/retry|success|replay/.test(key)),false);
  }
});
