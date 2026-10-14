import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const flatten=tree=>Array.isArray(tree)?tree.flatMap(flatten):tree?.props?[tree,...flatten(tree.props.children)]:[];
const nativeNodes=nodes=>nodes.flatMap(node=>[node,...nativeNodes(node.children??[])]);
function fixture(apple){
  const hooks=createReactHookHarness(),calls=[];
  const task={id:"actual-task",name:"Evening exercise",type:"prompt",cron:"0 20 * * *",enabled:true,remainingExecutions:7};
  const mocks={react:{...hooks.react,Fragment:"Fragment"},"../../i18n":{useLocale:()=>({t:key=>key})},
    "../../components/icons":Object.fromEntries(["AlertTriangle","CalendarClock","Clock3","Eye","MoreHorizontal","Pencil","Trash2"].map(key=>[key,key])),
    "../../lib/automation":{useAutomation:()=>({cron:{tasks:[task]}}),applyCronOps:async ops=>calls.push(ops)},
    "../../lib/chat/page/chatPageHelpers":{buildModelOptions:()=>[]},"../../lib/runtimePlatform":{isNativeMobileRuntime:()=>true},
    "../../runtime/applePresentation":{isApplePresentationRuntime:()=>apple},"../../presentation/nativeTheme":{createNativePresentationTheme:()=>undefined},
    "../../presentation/NativeSurface":{NativeSurface:"NativeSurface"},"../../presentation/NativeSettingsContent":{NativeSettingsContent:"NativeSettingsContent"},
    "./CronTaskModal":{CronTaskModal:"CronTaskModal"},"./CronTaskViewModal":{CronTaskViewModal:"CronTaskViewModal"},
    "./BackgroundInboxSection":{BackgroundInboxSection:"BackgroundInboxSection"},"./ProactiveRulesSection":{ProactiveRulesSection:"ProactiveRulesSection"},
    "./shared":{AgentActivationSwitch:"AgentActivationSwitch",ConfirmDeletePopover:"ConfirmDeletePopover"},
  };
  for(const [module,names] of Object.entries({Badge:["Badge"],Banner:["Banner"],Button:["Button"],DropdownMenu:["DropdownMenu"],EmptyState:["EmptyState"],Icon:["Icon"],Layout:["HStack","Section","VStack"],List:["List","ListItem"],StatusDot:["StatusDot"],Text:["Text"]}))mocks[`@astryxdesign/core/${module}`]=Object.fromEntries(names.map(key=>[key,key]));
  const loader=createTsModuleLoader({mocks}),{CronSection}=loader.loadModule("src/pages/settings/CronSection.tsx"),{getDefaultSettings}=loader.loadModule("src/lib/settings/index.ts");
  return {calls,task,render:()=>hooks.render(()=>CronSection({settings:getDefaultSettings(),setSettings(){}})),unmount:()=>hooks.unmount()};
}

test("Astryx cron row opens the actual task, menu edits it and delete still requires the existing confirmation",async t=>{
  const f=fixture(false);t.after(f.unmount);
  let row=flatten(f.render()).find(node=>node.type==="ListItem");
  row.props.onClick();let detail=f.render();assert.equal(detail.type,"CronTaskViewModal");assert.equal(detail.props.taskId,f.task.id);
  detail.props.onClose();
  row=flatten(f.render()).find(node=>node.type==="ListItem");
  const confirmation=flatten(row.props.endContent).find(node=>node.type==="ConfirmDeletePopover");
  let opened=0;const menu=confirmation.props.children(()=>opened++);
  menu.props.items.find(item=>item.label==="settings.cronEdit").onClick();detail=f.render();
  assert.equal(detail.type,"CronTaskModal");assert.equal(detail.props.initialData.id,f.task.id);assert.equal(detail.props.mode,"edit");
  detail.props.onClose();
  menu.props.items.find(item=>item.label==="settings.cronDelete").onClick();assert.equal(opened,1);assert.deepEqual(f.calls,[]);
  await confirmation.props.onConfirm();assert.deepEqual(f.calls,[[{op:"delete",id:f.task.id}]]);
});

test("SwiftUI cron menu binds original task actions, preserves remaining-run disablement and confirmed deletion",async t=>{
  const f=fixture(true);t.after(f.unmount);
  const view=()=>flatten(f.render()).find(node=>node.type==="NativeSurface"&&node.props.document.mode!=="alert");
  let surface=view(),nodes=nativeNodes(surface.props.document.nodes);
  assert.ok(nodes.some(node=>node.id===`${f.task.id}:actions`&&node.kind==="Menu"));
  await surface.props.handlers.get(`${f.task.id}:view`).run(null);assert.equal(f.render().props.taskId,f.task.id);
  f.render().props.onClose();surface=view();
  await surface.props.handlers.get(`${f.task.id}:enabled`).run(false);
  assert.deepEqual(f.calls,[[{op:"update",id:f.task.id,patch:{enabled:false}}]]);
  f.task.remainingExecutions=0;assert.equal(view().props.handlers.get(`${f.task.id}:enabled`).enabled,false);
  await view().props.handlers.get(`${f.task.id}:delete`).run(null);assert.equal(f.calls.length,1);
  const confirmation=flatten(f.render()).find(node=>node.type==="NativeSurface"&&node.props.document.mode==="alert");
  await confirmation.props.handlers.get("delete").run(null);assert.deepEqual(f.calls.at(-1),[{op:"delete",id:f.task.id}]);
});
