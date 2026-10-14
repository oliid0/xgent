import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const idle = () => ({phase:"idle",flowId:null,userCode:null,expiresAt:null,nextPollAt:null,account:null,error:null});
const pending = (id="00000000-0000-4000-8000-000000000001") => ({...idle(),phase:"pending",flowId:id,userCode:"ABCD-EFGH",expiresAt:Date.now()+900000,nextPollAt:Date.now()+5000});
const account = () => ({accountId:"actual-grant",githubUserId:"17",login:"account-owner",clientId:"registered-client",scopes:["public_repo","read:user","workflow"],authenticatedAt:1000,expiresAt:null});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
function harness(reply=async command=>command==="github_oauth_start"?pending():idle()){
  const hooks=createReactHookHarness(),calls=[],copies=[],props={enabled:true},changes=[];
  const loader=createTsModuleLoader({mocks:{react:hooks.react,"@xgent/runtime":{
    invoke(){throw Error("Mutable selected-PC transport must not receive account authorization");},
    async invokeNative(command,args){calls.push({command,args});return reply(command,args);},
  },"../system/clipboardText":{async writeClipboardText(value){copies.push(value);return true;}}}});
  const {useGitHubAuthorization}=loader.loadModule("src/lib/connectors/useGitHubAuthorization.ts");
  return {render:()=>hooks.render(()=>useGitHubAuthorization(props.enabled,async()=>changes.push("account"))),props,calls,copies,changes,
    close:()=>hooks.unmount(),replay:()=>hooks.replayEffects()};
}

test("account metadata keeps actual scopes while discarding every secret field",()=>{
  const {parseGitHubAuthorizationStatus}=createTsModuleLoader().loadModule("src/lib/connectors/githubAuthorization.ts");
  const actual=parseGitHubAuthorizationStatus({...idle(),phase:"connected",account:{...account(),refreshToken:"private"},deviceCode:"private",accessToken:"private"});
  assert.deepEqual(actual.account,account());assert.doesNotMatch(JSON.stringify(actual),/private|refreshToken|accessToken|deviceCode/);
  const verifying=parseGitHubAuthorizationStatus({...idle(),phase:"verifying",flowId:pending().flowId});
  assert.equal(verifying.phase,"verifying");assert.equal(verifying.userCode,null);
  for(const data of [null,{phase:"fake"},{...idle(),phase:"pending"},{...idle(),phase:"connected"},
    {...idle(),phase:"connected",account:{...account(),scopes:["invalid scope"]}},
    {...idle(),phase:"connected",account:{...account(),expiresAt:Infinity}}])assert.throws(()=>parseGitHubAuthorizationStatus(data),/response/);
});

test("sign in starts only from an action and uses the latest client ID before a new document",async t=>{
  const h=harness(async command=>command==="github_oauth_start"?pending():command==="github_oauth_open"?null:idle());t.after(h.close);
  h.render();h.replay();await tick();const view=h.render();
  assert.equal(h.calls.some(call=>call.command==="github_oauth_start"),false);
  view.setClientId("registered-client");assert.equal(await view.start(),true);
  assert.equal(h.calls.filter(call=>call.command==="github_oauth_start").length,1);
  assert.equal(h.calls.find(call=>call.command==="github_oauth_start").args.clientId,"registered-client");
  assert.equal(h.calls.filter(call=>call.command==="github_oauth_open").length,1);
  assert.equal(h.render().status.userCode,"ABCD-EFGH");await h.render().copy();assert.deepEqual(h.copies,["ABCD-EFGH"]);
});

test("leaving the page retires results and cannot open a browser for a late login",async t=>{
  const accepted=deferred(),h=harness(async command=>command==="github_oauth_start"?accepted.promise:idle());t.after(h.close);
  h.render();await tick();const view=h.render();view.setClientId("registered-client");const starting=view.start();
  h.props.enabled=false;h.render();accepted.resolve(pending());assert.equal(await starting,false);
  assert.equal(h.calls.some(call=>call.command==="github_oauth_open"),false);
  h.props.enabled=true;h.render();await tick();assert.equal(h.render().status.phase,"idle");
});

test("an old flow's cancel handler cannot cancel the newly observed flow",async t=>{
  let status=pending();const h=harness(async command=>command==="github_oauth_cancel"?idle():status);t.after(h.close);
  h.render();await tick();const old=h.render();status=pending("00000000-0000-4000-8000-000000000002");
  await old.refresh();h.render();assert.equal(await old.cancel(),false);
  assert.equal(h.calls.some(call=>call.command==="github_oauth_cancel"),false);
  assert.equal(await h.render().cancel(),true);assert.equal(h.calls.at(-1).args.flowId,status.flowId);
});

test("failed browser opening retains the native grant and real account installation refreshes consumers",async t=>{
  let actual=idle();const h=harness(async command=>{
    if(command==="github_oauth_start"){actual=pending();return actual;}
    if(command==="github_oauth_open")throw Error("github-oauth-open");return actual;
  });t.after(h.close);h.render();await tick();h.render().setClientId("registered-client");
  assert.equal(await h.render().start(),false);assert.equal(h.render().status.phase,"pending");
  actual={...idle(),phase:"connected",account:account()};await h.render().refresh();await tick();
  assert.equal(h.render().status.account.login,"account-owner");assert.deepEqual(h.changes,["account"]);
});

test("passive status reads do not disable typing or overwrite a new login with a stale result",async t=>{
  const set=globalThis.setInterval,clear=globalThis.clearInterval;let poll;
  globalThis.setInterval=callback=>{poll=callback;return 1;};globalThis.clearInterval=()=>{};
  const observed=deferred();let reads=0;
  const h=harness(async command=>command==="github_oauth_status"?(++reads===1?idle():observed.promise):command==="github_oauth_start"?pending():null);
  t.after(()=>{h.close();globalThis.setInterval=set;globalThis.clearInterval=clear;});
  h.render();await tick();h.render().setClientId("registered-client");poll();
  assert.equal(h.render().busy,"");assert.equal(h.render().canStart,true);
  assert.equal(await h.render().start(),true);observed.resolve(idle());await tick();
  assert.equal(h.render().status.phase,"pending");
});

test("native token exchange is bounded, persisted, account-bound and unavailable to workers/relays",()=>{
  const read=path=>readFileSync(new URL(`../../src-tauri/src/${path}`,import.meta.url),"utf8");
  const service=read("services/github_oauth.rs"),commands=read("commands/integration/github_oauth.rs"),vault=read("services/cloud_secret_vault.rs");
  assert.match(service,/https:\/\/github.com\/login\/device\/code/);assert.match(service,/urn:ietf:params:oauth:grant-type:device_code/);
  assert.match(service,/Policy::none\(\)/);assert.match(service,/65_536/);assert.match(service,/token_response = Some\(body.clone\(\)\)/);
  assert.match(service,/flow\.next_poll_at = now\(\) \+ flow\.interval_ms/);assert.match(service,/flow\.interval_ms \+ 5000/);
  assert.match(service,/fn live_flow\(flow:&Pending\)/);assert.match(service,/else if flow.phase=="pending" && flow.token_response.is_some\(\)/);
  assert.match(service,/https:\/\/api.github.com\/user/);assert.match(service,/grant\.account\.github_user_id != github_user_id/);
  assert.match(service,/attempt.response.is_none\(\) \|\| attempt.next_attempt_at>now\(\)/);
  assert.match(vault,/github_digest\(current_token.as_deref\(\), current_name.as_deref\(\)\) != expected/);
  assert.match(read("commands/automation/cron.rs"),/vault.github_background_material\(\)/);
  assert.match(commands,/window.label\(\)!="main"/);assert.doesNotMatch(commands,/pub .*token|access_token|refresh_token/);
  assert.match(read("commands/mod.rs"),/pub use integration_commands::github_oauth/);
  assert.equal((read("lib.rs").match(/commands::github_oauth::github_oauth_start/g)??[]).length,2);
  const local=read("services/local_access.rs");assert.doesNotMatch(local,/"github_oauth_start"|"github_oauth_open"|"github_oauth_cancel"/);
});
