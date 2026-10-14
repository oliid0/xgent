import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function fixture(){
  const hooks=createReactHookHarness();
  const vendor=Object.fromEntries(["Button","Selector","Text","TextInput"].map(name=>[`@astryxdesign/core/${name}`,{[name]:name}]));
  const loader=createTsModuleLoader({mocks:{react:hooks.react,"react-dom":{flushSync:fn=>fn()},...vendor,"@astryxdesign/core/List":{List:"List",ListItem:"ListItem"},"@astryxdesign/core/Layout":{VStack:"VStack"},"../../i18n":{useLocale:()=>({t:key=>key})}}});
  const {getDefaultSettings}=loader.loadModule("src/lib/settings/index.ts");
  const {useSchedulingBudgetEditor}=loader.loadModule("src/pages/settings/useSchedulingBudgetEditor.ts");
  const {SchedulingBudgetContent}=loader.loadModule("src/pages/settings/SchedulingBudgetSettings.tsx");
  const {schedulingBudgetNodes}=loader.loadModule("src/presentation/schedulingBudgetNodes.ts");
  let value=getDefaultSettings(),active=true;
  const flatten=node=>!node?[]:Array.isArray(node)?node.flatMap(flatten):[node,...flatten(node.props?.children)];
  return {hooks,loader,render:()=>hooks.render(()=>useSchedulingBudgetEditor({settings:value,setSettings:fn=>{value=fn(value);}},active)),web:editor=>flatten(SchedulingBudgetContent({editor})),native:editor=>schedulingBudgetNodes(editor,key=>key),get value(){return value;},set value(next){value=next;},set active(next){active=next;}};
}

test("settings normalize supported counts and lifetime, preserving default-off legacy settings",()=>{
  const f=fixture(),{normalizeSettings}=f.loader.loadModule("src/lib/settings/index.ts");
  assert.deepEqual({...f.value.system.schedulingBudget},{maxModelRequests:128,maxToolCalls:256,lifetimeMinutes:0});
  const custom={maxModelRequests:12,maxToolCalls:24,lifetimeMinutes:90};
  assert.deepEqual({...normalizeSettings({...f.value,system:{...f.value.system,schedulingBudget:custom}}).system.schedulingBudget},custom);
  for(const invalid of [{...custom,maxModelRequests:129},{...custom,maxToolCalls:0},{...custom,lifetimeMinutes:43201},{...custom,extra:true},{...custom,maxModelRequests:"12"}])assert.deepEqual({...normalizeSettings({...f.value,system:{...f.value.system,schedulingBudget:invalid}}).system.schedulingBudget},{maxModelRequests:128,maxToolCalls:256,lifetimeMinutes:0});
  f.hooks.unmount();
});

test("real Astryx controls save exact budgets, cancel drafts and preserve unrelated settings",()=>{
  const f=fixture();
  f.web(f.render()).find(node=>node.type==="ListItem").props.onClick();
  let e=f.render();f.web(e).find(node=>node.type==="TextInput"&&node.props.label==="schedulingBudget.requests").props.onChange("12");
  e=f.render();f.web(e).find(node=>node.type==="TextInput"&&node.props.label==="schedulingBudget.tools").props.onChange("24");
  e=f.render();f.web(e).find(node=>node.type==="Selector").props.onChange("60");
  f.value={...f.value,system:{...f.value.system,commandSafetyMode:"strict"}};
  e=f.render();f.web(e).find(node=>node.type==="Button"&&node.props.label==="settings.save").props.onClick();
  assert.deepEqual({...f.value.system.schedulingBudget},{maxModelRequests:12,maxToolCalls:24,lifetimeMinutes:60});
  assert.equal(f.value.system.commandSafetyMode,"strict");assert.equal(f.render().draft,null);
  f.render().open();f.render().patch("requests","7");f.render().cancel();
  assert.equal(f.value.system.schedulingBudget.maxModelRequests,12);f.hooks.unmount();
});

test("SwiftUI-bound handlers share validation, custom lifetime values and actual save actions",()=>{
  const f=fixture();let e=f.render(),native=f.native(e);
  native.handlers.get(native.nodes[0].action).run(null);
  e=f.render();native=f.native(e);let fields=native.nodes[0].children;
  native.handlers.get(fields.find(node=>node.id==="requests").action).run("0");
  e=f.render();native=f.native(e);assert.equal(native.nodes[0].children.find(node=>node.id==="save").disabled,true);
  e.patch("requests","8");f.render().patch("minutes","90");
  native=f.native(f.render());fields=native.nodes[0].children;
  assert.ok(fields.find(node=>node.id==="lifetime").options.some(option=>option.value==="90"));
  native.handlers.get(fields.find(node=>node.id==="save").action).run(null);
  assert.equal(f.value.system.schedulingBudget.maxModelRequests,8);assert.equal(f.value.system.schedulingBudget.lifetimeMinutes,90);f.hooks.unmount();
});

test("concurrent budgets, retired handlers and unmounted editors cannot overwrite accepted settings",()=>{
  const f=fixture();const retired=f.render();retired.open();let e=f.render();
  retired.save();assert.equal(f.render().draft.requests,"128");
  e.patch("requests","12");e=f.render();
  f.value={...f.value,system:{...f.value.system,schedulingBudget:{maxModelRequests:7,maxToolCalls:14,lifetimeMinutes:30}}};
  // Invoke a rendered handler before props update: the functional updater still fences the conflict.
  e.save();assert.equal(f.value.system.schedulingBudget.maxModelRequests,7);assert.equal(f.render().error,"schedulingBudget.conflict");
  e=f.render();f.active=false;f.render();e.cancel();e.save();assert.equal(f.render().draft,null);
  f.active=true;f.render();f.hooks.replayEffects();f.render().open();assert.ok(f.render().draft);
  e=f.render();f.hooks.unmount();e.save();assert.equal(f.value.system.schedulingBudget.maxModelRequests,7);
});
