import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const child={callId:"write-site",requestId:"child-request",peerId:"child-pc",accepted:true,state:"waiting",success:false,terminalConfirmed:false,cancelRequested:false,cancelAcknowledged:false,lastError:null};
const parent={requestId:"root-request",hostId:"original-pc",children:[child]};
const result={requestId:child.requestId,hostId:child.peerId,name:"产品官网",run:{state:"waiting",success:false,output:"实际结果："+"中文🙂".repeat(3000)},artifacts:[{id:"file",relativePath:"产品.html",bytes:27}]};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const loader=createTsModuleLoader({mocks:{"./backend":{backend:{}}}});
const {readInboxChild}=loader.loadModule("src/lib/automation/backgroundInboxChildren.ts");
const {sha256Hex}=loader.loadModule("src/lib/trajectory/sha256.ts");
function transport(payload=result,change=()=>{}){
  const text=JSON.stringify(payload),hash=sha256Hex(text),calls=[];
  return {calls,read:async(entry,call,offset,bound)=>{
    calls.push({entry,call,offset,bound});if(offset)assert.equal(bound,hash);
    let prefix="",consumed=0;for(const ch of text){if(consumed<offset){consumed+=Buffer.byteLength(ch);continue;}if(Buffer.byteLength(prefix)+Buffer.byteLength(ch)>8192)break;prefix+=ch;}
    const next=offset+Buffer.byteLength(prefix);
    const reply={requestId:parent.requestId,hostId:parent.hostId,child,available:true,snapshot:{offset,totalBytes:Buffer.byteLength(text),text:prefix,nextOffset:next<Buffer.byteLength(text)?next:null,snapshotHash:hash}};
    change(reply,calls.length);return reply;
  }};
}

test("child results follow the original parent and exact child across UTF8/hash-bound chunks without contacting a new PC",async()=>{
  const wire=transport(),actual=await readInboxChild("entry",parent,child,()=>true,wire.read);
  assert.deepEqual(actual.result,result);assert.ok(wire.calls.length>1);
  assert.ok(wire.calls.every(call=>call.entry==="entry"&&call.call===child.callId));
  const unavailable=await readInboxChild("entry",parent,child,()=>true,async()=>({requestId:parent.requestId,hostId:parent.hostId,child,available:false,snapshot:null}));
  assert.equal(unavailable.result,null);assert.equal(unavailable.child.state,"waiting");
});

test("wrong parent/child/revision, missing cursor, malformed manifest and retired views never become actual results",async()=>{
  for(const mutate of [reply=>reply.hostId="other-parent",reply=>reply.child={...child,peerId:"other-pc"},reply=>reply.snapshot.nextOffset=1,reply=>reply.snapshot.snapshotHash="0".repeat(64),reply=>reply.snapshot.totalBytes=524289]){
    const wire=transport(result,mutate);await assert.rejects(readInboxChild("entry",parent,child,()=>true,wire.read));
  }
  const wire=transport(result,(reply,page)=>{if(page===2)reply.snapshot.snapshotHash="0".repeat(64);});await assert.rejects(readInboxChild("entry",parent,child,()=>true,wire.read));
  for(const bad of [{...result,requestId:"other-child"},{...result,artifacts:[{relativePath:"result",bytes:-1}]}])await assert.rejects(readInboxChild("entry",parent,child,()=>true,transport(bad).read));
  let live=true;const retired=transport(result,()=>{live=false;});await assert.rejects(readInboxChild("entry",parent,child,()=>live,retired.read));assert.equal(retired.calls.length,1);
});

test("child disclosure keeps exact owner, preserves previous results on read failure and retires late replies/old actions",async()=>{
  const hooks=createReactHookHarness(),reads=[];let resolve,fail=false,scope="entry",root=parent;
  const local=createTsModuleLoader({mocks:{react:hooks.react,"./backgroundInboxChildren":{readInboxChild:async(entry,p,c,current)=>{reads.push({entry,p,c,current});if(fail)throw new Error("Original PC offline");return new Promise(done=>{resolve=done;});}}}});
  const {useInboxChildren}=local.loadModule("src/lib/automation/useInboxChildren.ts");const render=()=>hooks.render(()=>useInboxChildren(scope,root));
  render();const old=render(),reading=old.open(child);await flush();assert.equal(render().busy,true);
  render().close();resolve({child,result});await reading;assert.equal(render().detail,null);
  const fresh=render().open(child);await flush();resolve({child,result});await fresh;assert.equal(render().detail.result.name,result.name);
  const other={...child,callId:"slides",requestId:"slides-request"};root={...parent,children:[child,other]};
  const oldClose=render().close;const openingOther=render().open(other);await flush();assert.equal(render().detail,null);oldClose(child);assert.equal(render().selected.callId,"slides");resolve({child:other,result:{...result,requestId:other.requestId,name:"演示文稿"}});await openingOther;
  const backToOriginal=render().open(child);await flush();resolve({child,result});await backToOriginal;
  fail=true;await render().open(child);assert.equal(render().error,"Original PC offline");assert.equal(render().detail.result.name,result.name);
  scope="another-entry";root={...parent,requestId:"another-root"};render();await flush();assert.equal(render().selected,null);
  const count=reads.length;await old.open(child);old.close();assert.equal(reads.length,count);hooks.unmount();
});

test("shared native/Astryx disclosure shows real waiting/stop/unknown states and outputs with working refresh actions",()=>{
  const {inboxChildNodes}=loader.loadModule("src/presentation/inboxChildNodes.ts"),{presentationControls}=loader.loadModule("src/presentation/controls.ts");
  const c=presentationControls(),calls=[];const view={selected:child,detail:{child,result},busy:false,error:"",open:c=>calls.push(c.callId),close:()=>calls.push("close")};
  let nodes=inboxChildNodes(c,parent,view,key=>key,true);assert.ok(nodes.some(node=>node.text===result.run.output));assert.equal(nodes.find(node=>node.kind==="NavigationRow").text,"backgroundInbox.waiting");
  c.handlers.get(`inbox:child:refresh:${child.callId}`).run(null);assert.deepEqual(calls,[child.callId]);
  for(const [changes,label] of [[{cancelRequested:true},"backgroundInbox.childStopping"],[{state:"done",terminalConfirmed:false},"backgroundInbox.childUnconfirmed"],[{state:"done",terminalConfirmed:true,success:true},"backgroundInbox.completed"]]){
    const observed={...child,...changes};nodes=inboxChildNodes(c,{...parent,children:[observed]},{...view,detail:{child:observed,result:null}},key=>key,true);assert.equal(nodes.find(node=>node.kind==="NavigationRow").text,label);
  }
  assert.deepEqual(inboxChildNodes(c,{...parent,children:[]},view,key=>key,true),[]);
});

test("native child observation routes only through the original received parent, bounded read-only path and both platform registrations",()=>{
  const read=name=>readFileSync(new URL(`../../src-tauri/src/${name}`,import.meta.url),"utf8"),source=read("commands/automation/received_children.rs");
  assert.match(source,/window\.label\(\) != "main"/);assert.match(source,/received_task_source\(&entry\)/);assert.match(source,/registry\.invoke\(&watch\.source_host_id/);assert.match(source,/read_background_children/);assert.match(source,/offset > 512 \* 1024/);
  assert.equal((source.match(/received_task_source/g)??[]).length,2);assert.match(source,/actual\["hostId"\] != watch\.source_host_id/);
  assert.doesNotMatch(source,/submit_background|resume_background|invoke_child|provider|api_key/);
  assert.equal((read("lib.rs").match(/commands::received_children::automation_result_child,/g)??[]).length,2);
});
