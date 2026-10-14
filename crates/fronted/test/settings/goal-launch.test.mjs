import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const goal={id:"launch",config:{title:"产品汇报"},status:"active"};
const host={hostId:"pc-a",executorReady:true,acceptsBackgroundTasks:true,workspaceAvailable:true,workdir:"/accepted",intelligentSchedulingVersion:1,providers:[{id:"provider-a",name:"A",models:["main","video"],modelProfiles:[{model:"video",skills:["video"]}]},{id:"provider-b",name:"B",models:["main"],modelProfiles:[]}]};
const target={peerId:"pc-a",label:"Windows · device",host};
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
function fixture(options={}){
  const hooks=createReactHookHarness(),calls=[];
  const data={snapshot:{storeId:"source-store",revision:1},readExecutors:async()=>options.catalog??{storeId:"source-store",targets:[target]},launch:async input=>{calls.push(input);return options.launch?.(input,calls.length)??{requestId:input.requestId,sourceHostId:host.hostId,accepted:false,snapshot:data.snapshot};}};
  const {useGoalLaunch,goalPlanningModels}=createTsModuleLoader({mocks:{react:hooks.react}}).loadModule("src/lib/automation/useGoalLaunch.ts");
  const render=()=>hooks.render(()=>useGoalLaunch(data));
  return{hooks,data,calls,render,goalPlanningModels,async select(){await render().open(goal,1,"source-store");render().setPeer("pc-a");render().setModel(JSON.stringify(["provider-a","main"]));return render();}};
}

test("Goal execution is explicit, defaults scheduling off, preserves duplicate model names by provider and excludes known media-only planners",async()=>{
  const f=fixture();f.render();f.hooks.replayEffects();assert.equal(f.calls.length,0);
  let ui=await f.select();assert.equal(ui.draft.scheduling,false);assert.equal(ui.models.length,2);assert.notEqual(ui.models[0].value,ui.models[1].value);assert.equal(ui.canRun,true);
  await ui.start();assert.equal(f.calls.length,1);assert.equal(f.calls[0].intelligentSchedulingEnabled,false);assert.deepEqual(f.calls[0].goal,{goalId:"launch",storeId:"source-store",revision:1});assert.equal(f.calls[0].workdir,"/accepted");assert.equal(f.render().draft,null);f.hooks.unmount();
});

test("lost Goal acceptance reply retries exactly the original request/goal/device/model without another nonce or mutable selection",async()=>{
  const f=fixture({launch:(input,count)=>count===1?Promise.reject(new Error("Reply lost")):{requestId:input.requestId,sourceHostId:"pc-a",accepted:true}});
  await(await f.select()).start();let ui=f.render();assert.equal(ui.retry,true);ui.setPeer("other");ui.setModel("other");ui.setScheduling(true);ui=f.render();assert.equal(ui.draft.peer,"pc-a");assert.equal(ui.draft.scheduling,false);
  await ui.start();assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(f.render().draft,null);f.hooks.unmount();
});

test("closed/changed Goal views retire late catalogs and acceptance without cancelling the native task or unlocking a newer action",async()=>{
  const old=deferred(),next=deferred();const f=fixture({launch:(_input,count)=>count===1?old.promise:next.promise});
  const first=(await f.select()).start();await tick();f.render().close();
  await f.render().open(goal,1,"source-store");f.render().setPeer("pc-a");f.render().setModel(JSON.stringify(["provider-a","main"]));
  const second=f.render().start();await tick();old.resolve({requestId:f.calls[0].requestId,sourceHostId:"pc-a",accepted:true});await first;
  assert.equal(f.render().busy,true);assert.ok(f.render().draft);next.resolve({requestId:f.calls[1].requestId,sourceHostId:"pc-a",accepted:true});await second;assert.equal(f.render().draft,null);
  const reading=deferred(),g=fixture({catalog:reading.promise});const opening=g.render().open(goal,1,"source-store");g.render().close();reading.resolve({storeId:"source-store",targets:[target]});await opening;assert.equal(g.render().draft,null);assert.deepEqual(g.render().targets,[]);f.hooks.unmount();g.hooks.unmount();
});

test("rejected Goal versions or unavailable executors do not become pending acceptance; a mismatched returned source is never accepted",async()=>{
  for(const error of ["goals.conflict","goals.runActive","goals.executorUnavailable"]){const f=fixture({launch:()=>Promise.reject(new Error(error))});await(await f.select()).start();assert.equal(f.render().retry,false);assert.equal(f.render().error,error);f.hooks.unmount();}
  const f=fixture({launch:input=>({requestId:input.requestId,sourceHostId:"wrong",accepted:true})});await(await f.select()).start();assert.equal(f.render().error,"goals.ownerChanged");assert.equal(f.render().retry,true);assert.ok(f.render().draft);f.hooks.unmount();
});

test("shared Goal launch controls use actual target/model handlers, fields and protocol; staged work has no success label",async()=>{
  const loader=createTsModuleLoader(),{goalNodes}=loader.loadModule("src/presentation/goalNodes.ts"),{validatePresentationDocument}=loader.loadModule("src/presentation/validateDocument.ts"),{translations}=loader.loadModule("src/i18n/config.ts");
  const calls=[],noop=()=>{},models=[{value:JSON.stringify(["provider-a","main"]),label:"A · main",providerId:"provider-a",model:"main"}];
  const data={snapshot:{storeId:"source-store",revision:1,launchVersion:1,goals:[{...goal,config:{...goal.config,steps:[],category:"career"},tasks:[],backgroundTasks:[{requestId:"actual",name:"产品汇报",state:"submitting",success:null,exists:true}]}],targets:[]},busy:false,error:"",activity:null};
  const selected=data.snapshot.goals[0],launch={draft:{goalId:goal.id,storeId:"source-store",revision:1,peer:"pc-a",model:models[0].value,scheduling:false},targets:[target],models,target,loading:false,busy:false,error:"",retry:false,canRun:true,start:()=>calls.push("start"),setPeer:value=>calls.push(["peer",value]),setModel:value=>calls.push(["model",value]),setScheduling:value=>calls.push(["scheduling",value])};
  const screen={scope:"run",current:()=>true,data,selected,draft:null,launch,artifactsOpen:false,back:noop,stepTitle:"",taskId:"",workId:""};
  const t=key=>{assert.ok(key in translations["zh-CN"],key);return translations["zh-CN"][key];};
  let content=goalNodes(screen,t,"zh-CN");validatePresentationDocument({version:1,surface:"goals",revision:1,mode:"sheet",title:"Goal",nodes:content.nodes},content.handlers);
  const nodes=content.nodes.flatMap(node=>[node,...(node.children??[])]),scheduling=nodes.find(node=>node.id==="goal-run-scheduling");assert.equal(scheduling.value,"off");await content.handlers.get(scheduling.action).run("on");assert.deepEqual(calls[0],["scheduling",true]);
  const start=nodes.find(node=>node.id==="goal-run-start");await content.handlers.get(start.action).run(null);assert.equal(calls[1],"start");assert.equal(nodes.find(node=>node.id==="goal-run-workdir").disabled,true);
  screen.launch=undefined;screen.setWorkId=noop;screen.linkWork=noop;screen.setStepTitle=noop;screen.addStep=noop;screen.create=noop;screen.setTaskId=noop;screen.linkTask=noop;
  content=goalNodes(screen,t,"zh-CN");const flat=nodes=>nodes.flatMap(node=>[node,...flat(node.children??[])]);assert.equal(flat(content.nodes).find(node=>node.id==="goal-work:actual:state").text,translations["zh-CN"]["goals.runSubmitting"]);
});
