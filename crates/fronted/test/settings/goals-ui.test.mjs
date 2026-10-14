import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const config={title:"产品发布",description:"整理文档并完成汇报",category:"career",parentId:null,steps:[{id:"research",title:"阅读资料",done:true}]};
const requestId="11111111-1111-4111-8111-111111111111";
const work={requestId,name:"产品汇报",exists:true,state:"leased",success:null};
const goal={id:"launch",config,status:"active",createdAt:100,updatedAt:100,backgroundTasks:[],artifactCount:1,tasks:[{id:"fitness",name:"健身",exists:true,enabled:true,cron:"0 20 * * *"}]};
const flatten=nodes=>nodes.flatMap(node=>[node,...flatten(node.children??[])]);
function fixture(){
  const hooks=createReactHookHarness(),calls=[],confirmations=[];let resolveConfirm;
  const data={snapshot:{revision:1,storeId:"pc-a",goals:[goal],targets:goal.tasks,backgroundTargets:[work]},busy:false,error:"",retryAvailable:false,activity:null,activityBusy:false,activityError:"",artifacts:null,artifactsBusy:false,artifactsError:"",downloadBusy:null,downloadError:"",transfers:{},refresh:async()=>{calls.push("refresh");},retry:async()=>{calls.push("retry");},readActivity:async id=>{calls.push(["activity",id]);},readArtifacts:async id=>{calls.push(["artifacts",id]);},retireArtifacts:()=>{data.artifacts=null;},downloadArtifact:async(...args)=>{calls.push(["download",...args]);},retireActivity:()=>{},apply:async(operation,revision)=>{calls.push({operation,revision});return true;}};
  const mocks={"@xgent/runtime":{getLanPcCommandHostConfig:()=>({enabled:true,localWorkdir:"/phone"})}};for(const [module,names] of Object.entries({Banner:["Banner"],Button:["Button"],CheckboxInput:["CheckboxInput"],DropdownMenu:["DropdownMenu"],IconButton:["IconButton"],Layout:["HStack","VStack"],List:["List","ListItem"],Selector:["Selector"],Spinner:["Spinner"],Text:["Heading","Text"],TextArea:["TextArea"],TextInput:["TextInput"]}))mocks[`@astryxdesign/core/${module}`]=Object.fromEntries(names.map(name=>[name,name]));
  const loader=createTsModuleLoader({mocks:{...mocks,react:hooks.react,"react-dom":{flushSync:fn=>fn()},"../../components/icons":{},"../../i18n":{useLocale:()=>({locale:"zh-CN",t:key=>key})},"../../lib/automation/useGoals":{useGoals:()=>data},"../../lib/useMobileBackNavigation":{useMobileBackNavigation:()=>{}},"../../components/astryx/useConfirmDialog":{useConfirmDialog:()=>({dialog:null,confirm:options=>{confirmations.push(options);return new Promise(resolve=>{resolveConfirm=resolve;});}})},"../../lib/runtimePlatform":{isNativeMobileRuntime:()=>true},"../../runtime/applePresentation":{isApplePresentationRuntime:()=>true},"../../presentation/nativeTheme":{createNativePresentationTheme:()=>undefined},"../../presentation/NativeSurface":{NativeSurface:"NativeSurface"},"../../presentation/NativeSettingsContent":{NativeSettingsContent:"NativeSettingsContent"}}});
  const {GoalsSection}=loader.loadModule("src/pages/settings/GoalsSection.tsx"),{validatePresentationDocument}=loader.loadModule("src/presentation/validateDocument.ts");
  const elements=value=>!value?[]:Array.isArray(value)?value.flatMap(elements):[value,...elements(value.props?.children)];
  const render=()=>{const surface=elements(hooks.render(()=>GoalsSection({settings:{theme:"light"},setSettings(){},onBack:()=>calls.push("back")}))).find(element=>element.type==="NativeSurface");validatePresentationDocument({...surface.props.document,version:1,surface:"goals",revision:1},surface.props.handlers);return surface.props;};
  return {data,calls,confirmations,hooks,render,confirm:value=>resolveConfirm(value),async fire(id,value=null){const view=render(),node=flatten(view.document.nodes).find(node=>node.id===id);assert.ok(node,id);const handler=view.handlers.get(node.action);assert.equal(handler.enabled,true,id);assert.equal(handler.accepts(value),true,id);return handler.run(value);}};
}

test("both goal surfaces use the existing task menu for explicit follow-up and gate unsupported/busy targets",async()=>{
  const f=fixture();
  f.data.snapshot.goals=[{...goal,tasks:[{...goal.tasks[0],followUpEligible:true}]}];
  await f.fire("goal:launch:open");
  await f.fire("goal-task:fitness:followup");
  assert.deepEqual(f.calls.find(c=>c.operation?.follow_up===true),{operation:{op:"link_task",id:"launch",task_id:"fitness",follow_up:true},revision:1});
  f.data.snapshot.goals=[{...goal,tasks:[{...goal.tasks[0],followUpEligible:true,followUp:true}]}];
  await f.fire("goal-task:fitness:followup-disable");
  assert.ok(f.calls.some(c=>c.operation?.follow_up===false));
  f.data.snapshot.goals=[{...goal,tasks:[{...goal.tasks[0],followUpEligible:true,followUpBlocked:"task_changed"}]}];
  const tree=f.render();const menu=flatten(tree.document.nodes).find(n=>n.id==="goal-task:fitness:menu");
  assert.ok(menu.children.some(n=>n.id==="goal-task:fitness:followup"));
  f.data.busy=true;const busy=f.render();assert.equal(flatten(busy.document.nodes).find(n=>n.id==="goal-task:fitness:followup").disabled,true);
  f.data.busy=false;f.data.snapshot.goals=[goal];assert.ok(!flatten(f.render().document.nodes).some(n=>n.id==="goal-task:fitness:followup"));
  assert.equal(f.calls.filter(c=>c.operation?.op==="create").length,0);f.hooks.unmount();
});

test("shared native goal controls save actual drafts, preserve completed steps and never create a fake schedule",async()=>{
  const f=fixture();await f.fire("goals-create:health");assert.equal(f.calls.length,0);
  await f.fire("goal-title","每天运动");await f.fire("goal-plan","晚上健身");await f.fire("goal-save");
  assert.equal(f.calls[0].operation.op,"create");assert.equal(f.calls[0].operation.config.category,"health");assert.equal(f.calls[0].operation.config.title,"每天运动");assert.equal(f.calls[0].revision,1);
  await f.fire("goals-back");await f.fire("goal:launch:open");await f.fire("goal-step-title","完成 PPT");await f.fire("goal-add-step");
  const op=f.calls.at(-1).operation;assert.equal(op.op,"update");assert.equal(op.config.steps[0].done,true);assert.equal(op.config.steps[1].done,false);assert.equal(op.config.steps[1].title,"完成 PPT");assert.ok(!f.calls.some(call=>call?.operation?.op==="cron_create"));f.hooks.unmount();
});

test("goal menus retain confirmation and stale view/owner guards; a paused goal cannot claim its cron stopped",async()=>{
  const f=fixture();const pausing=f.fire("goal:launch:status");assert.equal(f.confirmations[0].description,"goals.independentTasks");assert.equal(f.calls.length,0);f.confirm(true);await pausing;assert.deepEqual(f.calls[0].operation,{op:"set_status",id:"launch",status:"paused"});
  const deleting=f.fire("goal:launch:delete");await f.fire("goal:launch:open");f.confirm(true);await deleting;assert.ok(!f.calls.some(call=>call?.operation?.op==="delete"));
  await f.fire("goals-back");const view=f.render(),oldNode=flatten(view.document.nodes).find(node=>node.id==="goal:launch:complete");
  f.data.snapshot={...f.data.snapshot,storeId:"pc-b"};f.render();await view.handlers.get(oldNode.action).run(true);assert.ok(!f.calls.some(call=>call?.operation?.status==="completed"));f.hooks.unmount();
});

test("changing execution stores clears unsaved drafts and real activity states remain visible with expandable output",async()=>{
  const f=fixture();await f.fire("goal:launch:edit");await f.fire("goal-title","Previous PC draft");
  f.data.snapshot={...f.data.snapshot,storeId:"pc-b"};assert.ok(!flatten(f.render().document.nodes).some(node=>node.id==="goal-save"));
  await f.fire("goal:launch:open");f.data.activity={goalId:"launch",items:[{id:"run:real",kind:"run",label:"健身",state:"leased",success:false,at:1791664740000,output:"Actual output"}],nextCursor:null};
  let nodes=flatten(f.render().document.nodes);assert.equal(nodes.find(node=>node.id==="goal-activity:run:real:status").text,"goals.runRunning");assert.ok(!nodes.some(node=>node.text==="goals.runSucceeded"));
  assert.equal(nodes.find(node=>node.id==="goal-activity:run:real:preview").text,"Actual output");
  await f.fire("goal-activity:run:real:open");nodes=flatten(f.render().document.nodes);assert.equal(nodes.find(node=>node.id==="goal-activity:run:real:output").text,"Actual output");
  f.data.busy=true;assert.equal(f.render().handlers.get(nodes.find(node=>node.id==="goal-add-step").action).enabled,false);f.hooks.unmount();
});

test("refreshing a stale edit requires reloading the actual saved plan before it can overwrite completed steps",async()=>{
  const f=fixture();await f.fire("goal:launch:edit");await f.fire("goal-title","Unsaved title");
  f.data.snapshot={...f.data.snapshot,revision:2,goals:[{...goal,config:{...config,title:"Updated title",steps:[...config.steps,{id:"ppt",title:"Completed report",done:true}]}}]};
  let view=f.render(),save=flatten(view.document.nodes).find(node=>node.id==="goal-save");assert.equal(view.handlers.get(save.action).enabled,false);
  await f.fire("goal-reload-draft");await f.fire("goal-save");assert.equal(f.calls.at(-1).revision,2);assert.equal(f.calls.at(-1).operation.config.steps[1].done,true);assert.equal(f.calls.at(-1).operation.config.title,"Updated title");f.hooks.unmount();
});

test("Goals links only accepted background requests and file controls retain exact identity and retired-view guards",async()=>{
  const f=fixture();await f.fire("goal:launch:open");await f.fire("goal-work-choice",requestId);await f.fire("goal-work-link");
  assert.deepEqual(f.calls.at(-1).operation,{op:"link_work",id:"launch",request_id:requestId});
  f.data.snapshot={...f.data.snapshot,goals:[{...goal,backgroundTasks:[work]}]};
  const nodes=flatten(f.render().document.nodes);assert.equal(nodes.find(node=>node.id===`goal-work:${requestId}:state`).text,"goals.runRunning");
  assert.equal(nodes.find(node=>node.id===`goal-work:${requestId}`).variant,"goal-association");
  assert.equal(nodes.find(node=>node.id===`goal-work:${requestId}:menu`).kind,"Menu");
  await f.fire(`goal-work:${requestId}:unlink`);assert.deepEqual(f.calls.at(-1).operation,{op:"unlink_work",id:"launch",request_id:requestId});
  await f.fire("goal-artifacts-open");f.render();assert.ok(f.calls.some(call=>Array.isArray(call)&&call[0]==="artifacts"&&call[1]==="launch"));
  const file={id:"file",requestId,relativePath:"reports/product.pptx",bytes:1024,contentHash:"a".repeat(64),taskName:work.name,at:100};
  f.data.artifacts={goalId:"launch",storeId:"pc-a",items:[file],nextCursor:null};
  await f.fire("goal-artifact:file");const download=f.calls.find(call=>Array.isArray(call)&&call[0]==="download");assert.deepEqual(download.slice(1,4),["launch",file,"/phone"]);assert.equal(download[4](),true);
  const old=f.render(),oldNode=flatten(old.document.nodes).find(node=>node.id==="goal-artifact:file");await f.fire("goals-back");assert.equal(download[4](),false);
  await old.handlers.get(oldNode.action).run(null);assert.equal(f.calls.filter(call=>Array.isArray(call)&&call[0]==="download").length,1);f.hooks.unmount();
});
