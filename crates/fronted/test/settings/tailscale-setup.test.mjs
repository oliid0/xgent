import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const status=(state="login-required")=>({state,engine:"embedded-rust",canAuthenticate:true,canLogout:false,addresses:state==="running"?["100.70.1.2"]:[],observedAt:1720000000000});
function fixture(options={}) {
 const hooks=createReactHookHarness(),calls=[];let active=true,mobile=options.mobile??false;
 const loader=createTsModuleLoader({mocks:{react:hooks.react,"@xgent/runtime":{
  invoke:()=>assert.fail("Tailscale must not route through the selected PC"),
  invokeNative:async(command,args)=>{calls.push({command,args});return options.invoke?options.invoke(command,args):command==="tailscale_setup_status"?status():command==="tailscale_authenticate"?status("running"):undefined;},
 }}});
 const {useTailscaleSetup}=loader.loadModule("src/lib/useTailscaleSetup.ts");
 return {hooks,calls,loader,render:()=>hooks.render(()=>useTailscaleSetup(active,mobile)),setActive:value=>{active=value;},setMobile:value=>{mobile=value;}};
}

test("setup observes this native device without installation or automatic authentication",async()=>{
 const f=fixture();try{f.render();await tick();const ui=f.render();assert.equal(ui.status.state,"login-required");assert.equal(ui.busy,"");assert.deepEqual(f.calls.map(c=>c.command),["tailscale_setup_status"]);assert.equal(ui.credential,"");}finally{f.hooks.unmount();}
});

test("auth-key and tagged OAuth actions clear credentials and report only actual native status",async()=>{
 for(const mode of ["auth-key","oauth"]) {
  const f=fixture();try{f.render();await tick();let ui=f.render();ui.setMode(mode);ui.setCredential(mode==="oauth"?"tskey-client-dummysecret":"tskey-auth-dummysecret");ui.setTags(mode==="oauth"?"tag:worker, tag:pc":"");ui=f.render();assert.equal(await ui.connect(),true);ui=f.render();assert.equal(ui.credential,"");assert.equal(ui.status.state,"running");
   const sent=f.calls.find(c=>c.command==="tailscale_authenticate");assert.deepEqual(sent.args.input,{mode,credential:mode==="oauth"?"tskey-client-dummysecret":"tskey-auth-dummysecret",tags:mode==="oauth"?["tag:worker","tag:pc"]:[]});assert.equal(f.calls.filter(c=>c.command==="tailscale_authenticate").length,1);
  }finally{f.hooks.unmount();}
 }
});

test("OAuth and credential validation reject altered URLs, missing tags and invalid methods before native effects",()=>{
 const f=fixture();try{const {tailscaleAuthInput}=f.loader.loadModule("src/lib/tailscaleSetup.ts");
  for(const values of [["oauth","tskey-client-secret",""],["oauth","tskey-client-secret?baseURL=https://other","tag:worker"],["auth-key","tskey-client-secret",""],["auth-key","tskey-auth-secret\ncommand",""],["oauth","tskey-client-secret","tag:worker,tag:worker"],["oauth","tskey-client-secret","invalid"],["unknown","tskey-auth-secret",""]])assert.throws(()=>tailscaleAuthInput(...values));
 }finally{f.hooks.unmount();}
});

test("tag validation follows tailcfg CheckTag before any native authentication", () => {
 const f=fixture();
 try {
  const {tailscaleAuthInput}=f.loader.loadModule("src/lib/tailscaleSetup.ts");
  for(const tag of ["tag:pc", "tag:Worker-2", "tag:a"]) {
   assert.deepEqual(tailscaleAuthInput("oauth", "tskey-client-secret", tag).tags, [tag]);
  }
  for(const tag of ["tag:2pc", "tag:-pc", "tag:_pc", "tag:", "tag:a_b", "tag:pc,tag:pc"]) {
   assert.throws(()=>tailscaleAuthInput("oauth", "tskey-client-secret", tag), /tailscale-invalid-input/);
  }
  assert.deepEqual(f.calls, []);
 } finally { f.hooks.unmount(); }
});

test("pending authentication fences duplicates and stale page results across disable/reopen",async()=>{
 const pending=deferred();const f=fixture({invoke:command=>command==="tailscale_authenticate"?pending.promise:status()});
 try{f.render();await tick();let ui=f.render();ui.setCredential("tskey-auth-secret");ui=f.render();const sent=ui.connect();assert.equal(f.render().credential,"");assert.equal(f.render().busy,"connect");assert.equal(await f.render().connect(),false);
  f.setActive(false);f.render();pending.resolve(status("running"));assert.equal(await sent,false);assert.equal(f.render().status,null);f.setActive(true);f.render();await tick();assert.equal(f.render().status.state,"login-required");assert.equal(f.calls.filter(c=>c.command==="tailscale_authenticate").length,1);
 }finally{f.hooks.unmount();}
});

test("failed authentication preserves native observation and displays fixed localized errors without echoed secrets",async()=>{
 const f=fixture({invoke:command=>{if(command==="tailscale_authenticate")throw new Error("tailscale-command-failed tskey-auth-dummysecret");return status("approval-required");}});
 try{f.render();await tick();let ui=f.render();ui.setCredential("tskey-auth-dummysecret");ui=f.render();assert.equal(await ui.connect(),false);ui=f.render();assert.equal(ui.credential,"");assert.equal(ui.status.state,"approval-required");const {tailscaleErrorMessage}=f.loader.loadModule("src/lib/tailscaleSetup.ts");assert.equal(tailscaleErrorMessage(ui.error,key=>key),"settings.tailscaleCommandFailed");assert.equal(f.calls.at(-1).command,"tailscale_setup_status");}finally{f.hooks.unmount();}
});

test("embedded setup never installs a system client and follows actual native authorization availability",async context=>{
 context.mock.timers.enable({apis:["setTimeout"]});
 let actual={...status(),engine:"embedded-rust",canAuthenticate:true,canLogout:false};
 const f=fixture({invoke:command=>{
  if(command==="tailscale_authenticate") actual={...status("starting"),engine:"embedded-rust",canAuthenticate:false,canLogout:true};
  if(command==="tailscale_logout") actual={...status(),engine:"embedded-rust",canAuthenticate:true,canLogout:false};
  return actual;
 }});
 try {
  f.render();await tick();let ui=f.render();assert.equal(ui.canConnect,true);assert.equal(ui.canLogout,false);
  assert.deepEqual(f.calls.map(c=>c.command),["tailscale_setup_status"]);
  assert.equal("install" in ui,false);assert.equal("download" in ui,false);assert.equal(await ui.logout(),false);
  ui.setCredential("tskey-auth-dummysecret");ui=f.render();assert.equal(await ui.connect(),true);ui=f.render();
  assert.equal(ui.status.state,"starting");assert.equal(ui.canConnect,false);assert.equal(ui.canLogout,true);assert.equal(ui.credential,"");
  actual={...status("running"),engine:"embedded-rust",canAuthenticate:false,canLogout:true};
  context.mock.timers.tick(3000);await tick();ui=f.render();assert.equal(ui.status.state,"running");
  assert.equal(await ui.connect(),false);assert.equal(await ui.logout(),true);ui=f.render();assert.equal(ui.status.state,"login-required");
  assert.ok(!f.calls.some(c=>["tailscale_install_start","tailscale_install_status","tailscale_open_install"].includes(c.command)));
 } finally { f.hooks.unmount();context.mock.timers.reset(); }
});

test("embedded native controls keep real credential and disconnect actions while omitting external installation",async()=>{
 const f=fixture({invoke:()=>({...status("login-required"),engine:"embedded-rust",canAuthenticate:false,canLogout:true})});
 try {
  f.render();await tick();const snapshot=f.render();const {tailscaleSetupNodes}=f.loader.loadModule("src/presentation/tailscaleSetupNodes.ts");
  const {presentationControls}=f.loader.loadModule("src/presentation/controls.ts");const c=presentationControls();
  const nodes=tailscaleSetupNodes(c,snapshot,key=>key,false,true)[0].children;
  assert.ok(!nodes.some(n=>["tailscale-install","tailscale-official-download","tailscale-install-status"].includes(n.id)));
  assert.equal(nodes.find(n=>n.id==="tailscale-credential").secure,true);
  assert.equal(nodes.find(n=>n.id==="tailscale-connect").disabled,true);
  assert.equal(nodes.find(n=>n.id==="tailscale-logout").disabled,false);
  assert.equal(await c.handlers.get("tailscale-logout").run(null),true);
  assert.equal(f.calls.filter(c=>c.command==="tailscale_logout").length,1);
 } finally {f.hooks.unmount();}
});

test("embedded phone setup authenticates its own node, polls actual readiness and retires a late observation",async context=>{
 context.mock.timers.enable({apis:["setTimeout"]});
 let actual={...status(),engine:"embedded-rust",canAuthenticate:true,canLogout:false};
 let late=null;
 const f=fixture({mobile:true,invoke:command=>{
  if(command==="tailscale_authenticate") actual={...status("starting"),engine:"embedded-rust",canAuthenticate:false,canLogout:true};
  if(command==="tailscale_logout") actual={...status(),engine:"embedded-rust",canAuthenticate:true,canLogout:false};
  if(command==="tailscale_setup_status" && late)return late.promise;
  return actual;
 }});
 try {
  f.render();await tick();let ui=f.render();assert.equal(ui.canConnect,true);
  ui.setMode("oauth");ui.setCredential("tskey-client-dummysecret");ui.setTags("tag:phone");ui=f.render();
  const {tailscaleSetupNodes}=f.loader.loadModule("src/presentation/tailscaleSetupNodes.ts");
  const {presentationControls}=f.loader.loadModule("src/presentation/controls.ts");const c=presentationControls();
  const nodes=tailscaleSetupNodes(c,ui,key=>key,true,true)[0].children;
  assert.equal(nodes.find(n=>n.id==="tailscale-credential").secure,true);
  assert.equal(nodes.find(n=>n.id==="tailscale-tags").value,"tag:phone");
  assert.ok(!nodes.some(n=>["tailscale-install","tailscale-official-download"].includes(n.id)));
  assert.equal(nodes.find(n=>n.id==="tailscale-connect").disabled,false);
  assert.equal(await c.handlers.get("tailscale-connect").run(null),true);
  ui=f.render();assert.equal(ui.status.state,"starting");assert.equal(ui.credential,"");assert.equal(ui.canConnect,false);assert.equal(ui.canLogout,true);
  assert.deepEqual(f.calls.find(c=>c.command==="tailscale_authenticate").args.input,{mode:"oauth",credential:"tskey-client-dummysecret",tags:["tag:phone"]});
  actual={...status("running"),engine:"embedded-rust",canAuthenticate:false,canLogout:true};
  context.mock.timers.tick(3000);await tick();ui=f.render();assert.equal(ui.status.state,"running");
  assert.equal(await ui.logout(),true);ui=f.render();assert.equal(ui.canLogout,false);
  late=deferred();context.mock.timers.tick(3000);await tick();f.setActive(false);f.render();
  late.resolve({...status("running"),engine:"embedded-rust",canAuthenticate:false,canLogout:true});await tick();
  assert.equal(f.render().status,null);
  assert.ok(!f.calls.some(c=>["tailscale_install_status","tailscale_install_start","tailscale_open_install"].includes(c.command)));
 } finally {f.hooks.unmount();context.mock.timers.reset();}
});
