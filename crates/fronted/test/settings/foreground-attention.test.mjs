import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const loader=createTsModuleLoader();
const {startForegroundAttention}=loader.loadModule("src/lib/automation/foregroundAttention.ts");

test("visible busy occurrences renew one scope, hiding closes it and returning owns a new scope",context=>{
  context.mock.timers.enable({apis:["setInterval"]});
  const calls=[];let visible=true,at=1000,ids=0,refresh,unsubscribed=0;
  const stop=startForegroundAttention({observe:async input=>{calls.push(input);},isVisible:()=>visible,now:()=>at,createId:()=>`scope-${++ids}`,subscribe:callback=>{refresh=callback;return()=>unsubscribed++;}});
  try{
    assert.deepEqual(calls,[{sessionId:"scope-1",sequence:1,busy:true,issuedAt:1000}]);
    at+=10000;context.mock.timers.tick(10000);assert.equal(calls.at(-1).sequence,2);assert.equal(ids,1);
    visible=false;refresh();assert.equal(calls.at(-1).busy,false);assert.equal(calls.at(-1).sequence,3);
    at+=20000;context.mock.timers.tick(20000);assert.equal(calls.length,3);
    visible=true;refresh();assert.equal(calls.at(-1).sessionId,"scope-2");assert.equal(calls.at(-1).sequence,1);
    stop();assert.equal(calls.at(-1).busy,false);assert.equal(unsubscribed,1);
    const count=calls.length;context.mock.timers.tick(30000);refresh();stop();assert.equal(calls.length,count);assert.equal(unsubscribed,1);
  }finally{stop();context.mock.timers.reset();}
});

test("lost heartbeat replies cannot block scope closure or replacement and hidden startup does not claim busy",async context=>{
  context.mock.timers.enable({apis:["setInterval"]});let resolve,refresh,visible=false,ids=0;const calls=[];
  const pending=new Promise(done=>resolve=done);
  const stop=startForegroundAttention({observe:input=>{calls.push(input);return input.busy?pending:Promise.resolve();},isVisible:()=>visible,now:()=>1000,createId:()=>`scope-${++ids}`,subscribe:callback=>{refresh=callback;return()=>{};}});
  try{
    assert.equal(calls.length,0);visible=true;refresh();assert.equal(calls.length,1);
    stop();assert.equal(calls.length,2);assert.equal(calls[1].busy,false);assert.equal(calls[1].sessionId,calls[0].sessionId);
    resolve();await tick();context.mock.timers.tick(30000);assert.equal(calls.length,2);
  }finally{stop();context.mock.timers.reset();}
});

test("actual root hook remains original-device only, browser/idle make no call and StrictMode cleanup fences its own scope",async context=>{
  context.mock.timers.enable({apis:["setInterval"]});
  const originalWindow=globalThis.window,originalDocument=globalThis.document;
  globalThis.window=new EventTarget();globalThis.document=new EventTarget();globalThis.document.visibilityState="visible";
  const hooks=createReactHookHarness(),calls=[];let native=false,busy=true;
  const hookLoader=createTsModuleLoader({mocks:{react:hooks.react,"@xgent/runtime":{
    invoke:()=>assert.fail("Attention cannot follow the selected PC"),isTauriRuntime:()=>native,
    invokeNative:async(command,args)=>{assert.equal(command,"automation_foreground_attention");calls.push(args.input);},
  }}});
  const {useForegroundAttention}=hookLoader.loadModule("src/lib/automation/foregroundAttention.ts");
  const render=()=>hooks.render(()=>useForegroundAttention(busy));
  try{
    render();await tick();assert.equal(calls.length,0);
    busy=false;native=true;render();assert.equal(calls.length,0);
    busy=true;render();await tick();assert.equal(calls.length,1);const first=calls[0].sessionId;
    hooks.replayEffects();await tick();assert.equal(calls[1].busy,false);assert.equal(calls[1].sessionId,first);
    assert.equal(calls[2].busy,true);assert.notEqual(calls[2].sessionId,first);
    globalThis.document.visibilityState="hidden";globalThis.document.dispatchEvent(new Event("visibilitychange"));await tick();assert.equal(calls.at(-1).busy,false);
    busy=false;render();const count=calls.length;globalThis.window.dispatchEvent(new Event("focus"));context.mock.timers.tick(30000);await tick();assert.equal(calls.length,count);
  }finally{hooks.unmount();context.mock.timers.reset();if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;}
});

test("the existing run/approval/modal signal drives attention without changing model/task routing or navigation",()=>{
  const source=readFileSync(new URL("../../src/App.tsx",import.meta.url),"utf8");
  assert.match(source,/useForegroundAttention\(deferBackgroundNotices\)/);
  assert.match(source,/onNotificationDeferralChange=\{setDeferBackgroundNotices\}/);
  const controller=readFileSync(new URL("../../src/lib/automation/foregroundAttention.ts",import.meta.url),"utf8");
  assert.doesNotMatch(controller,/completeAssistant|submitBackground|cancelBackground|requestPermission|\.invoke\(/);
});
