import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const lease = {attempt:1,generation:2,token:"11111111-1111-4111-8111-111111111111"};
const call = {id:"import-operation",name:"ImportBackgroundChildArtifact",arguments:{child_call_id:"original-submit",artifact_id:"observed-artifact",path:"report.pptx"}};
const receipt = () => ({role:"toolResult",toolCallId:call.id,toolName:call.name,isError:false,timestamp:101,
  content:[{type:"text",text:'{"artifact":{"id":"parent-artifact","relativePath":"report.pptx"}}'}],
  details:{kind:"background_artifact",result:{artifact:{id:"parent-artifact",relativePath:"report.pptx"}}}});

function fixture(invoke) {
  const calls=[];
  const api=createTsModuleLoader({mocks:{"../automation/backend":{backend:{
    async importBackgroundChildArtifact(...args){calls.push(args);return invoke(...args);},
  }}}}).loadModule("src/lib/tools/backgroundTaskTools.ts");
  return {calls,tools:api.createBackgroundArtifactTools("original-parent",lease)};
}

test("only the captured parent/lease and actual call IDs reach native import; exact committed receipt survives late cancellation",async()=>{
  const controller=new AbortController(),saved=receipt();
  const f=fixture(()=>{controller.abort();return saved;});
  const result=await f.tools.executeToolCall(call,controller.signal);
  assert.equal(result,saved);assert.equal(result.timestamp,101);assert.equal(result.isError,false);
  assert.deepEqual(f.calls,[["original-parent",call.id,"original-submit","observed-artifact",lease]]);
  assert.equal(f.tools.metadataByName.get(call.name).isReadOnly,false);
  const schema=f.tools.tools.find(tool=>tool.name===call.name).parameters;
  assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.path.type,"string");
});

test("malformed import identifiers and attempted peer/byte injection are rejected before native effects",async()=>{
  for(const args of [null,{},[],{...call.arguments,peer_id:"replacement"},{...call.arguments,contentBase64:"invented"},
    {...call.arguments,child_call_id:""},{...call.arguments,child_call_id:"x".repeat(257)},
    {...call.arguments,artifact_id:10},{...call.arguments,path:false},{...call.arguments,path:"x".repeat(4097)}]){
    const f=fixture(()=>receipt());const result=await f.tools.executeToolCall({...call,arguments:args});
    assert.equal(result.isError,true);assert.equal(f.calls.length,0);
  }
});

test("cancelled before dispatch never imports and a native refusal never becomes a parent artifact",async()=>{
  const controller=new AbortController();controller.abort();
  const f=fixture(()=>receipt());assert.equal((await f.tools.executeToolCall(call,controller.signal)).isError,true);assert.equal(f.calls.length,0);
  const rejected=fixture(()=>{throw new Error("Parent artifact quota exceeded");});
  const result=await rejected.tools.executeToolCall(call);
  assert.equal(result.isError,true);assert.match(result.content[0].text,/quota/);assert.equal(rejected.calls.length,1);
});

test("another call's receipt cannot be reported as imported success and a persisted refusal stays exact",async()=>{
  for(const patch of [{toolCallId:"foreign"},{toolName:"OtherTool"},{role:"assistant"}]){
    const f=fixture(()=>({...receipt(),...patch}));assert.equal((await f.tools.executeToolCall(call)).isError,true);
  }
  const saved={...receipt(),isError:true,content:[{type:"text",text:"Original refusal"}]};
  assert.equal(await fixture(()=>saved).tools.executeToolCall(call),saved);
});

test("native backend import bypasses selected-PC transport and pins the operation's lease",async()=>{
  const calls=[],saved=receipt();
  const api=createTsModuleLoader({mocks:{"@xgent/runtime":{
    invokeNative:(command,args)=>{calls.push({command,args});return Promise.resolve(saved);},
    invoke:()=>{throw new Error("Selected PC transport must not be used");},isTauriRuntime:()=>true,
  }}}).loadModule("src/lib/automation/backend.ts");
  assert.equal(await api.backend.importBackgroundChildArtifact("parent",call.id,"child","artifact",lease),saved);
  assert.deepEqual(calls,[{command:"automation_background_child_import_artifact",args:{execution_id:"parent",call_id:call.id,child_call_id:"child",artifact_id:"artifact",lease}}]);
});

test("a lost native import ACK recovers the already committed receipt without fetching or importing again",async()=>{
  let committed,imports=0;
  const backend={
    saveBackgroundCheckpoint:async(_,revision)=>revision,
    beginBackgroundOperation:async()=>committed?{status:"returned",result:committed}:{status:"execute"},
    completeBackgroundOperation:async(_,__,result)=>{
      if(JSON.stringify(result)!==JSON.stringify(committed))throw new Error("Operation receipt is immutable");
    },
    importBackgroundChildArtifact:async()=>{imports++;committed=receipt();throw new Error("Native ACK lost after commit");},
  };
  const loader=createTsModuleLoader({mocks:{"../automation/backend":{backend},"./backend":{backend}}});
  const tools=loader.loadModule("src/lib/tools/backgroundTaskTools.ts").createBackgroundArtifactTools("parent",lease);
  const api=loader.loadModule("src/lib/automation/backgroundExecutionJournal.ts");
  const make=()=>api.createBackgroundExecutionJournal("parent",{systemPrompt:"Original request",messages:[{role:"user",content:"Deliver report",timestamp:1}]},new AbortController().signal,{lease,isTaskStateOnly:()=>true});
  const first=make();
  try{await assert.rejects(first.execute(call,undefined,()=>tools.executeToolCall(call)),/receipt could not be confirmed/);}finally{first.dispose();}
  const reopened=make();
  try{
    assert.equal(await reopened.execute(call,undefined,()=>assert.fail("No second native import")),committed);
    assert.equal(imports,1);
  }finally{reopened.dispose();}
});

test("a refused atomic local import leaves independent task work available without claiming delivered bytes",async()=>{
  const saved=[];
  const backend={
    saveBackgroundCheckpoint:async(_,revision)=>revision,
    beginBackgroundOperation:async()=>({status:"execute"}),
    completeBackgroundOperation:async(_,__,result)=>saved.push(result),
    importBackgroundChildArtifact:async()=>{throw new Error("Parent artifact quota exceeded");},
  };
  const loader=createTsModuleLoader({mocks:{"../automation/backend":{backend},"./backend":{backend}}});
  const tools=loader.loadModule("src/lib/tools/backgroundTaskTools.ts").createBackgroundArtifactTools("parent",lease);
  const api=loader.loadModule("src/lib/automation/backgroundExecutionJournal.ts");
  const journal=api.createBackgroundExecutionJournal("parent",{systemPrompt:"Original request",messages:[{role:"user",content:"Report and itinerary",timestamp:1}]},new AbortController().signal,{lease,isTaskStateOnly:operation=>operation.name===call.name});
  try{
    const failed=await journal.execute(call,undefined,()=>tools.executeToolCall(call));
    assert.equal(failed.isError,true);assert.notEqual(failed.details.outcomeUncertain,true);assert.equal(journal.signal.aborted,false);
    const independent={id:"read-itinerary",name:"Read",arguments:{path:"itinerary.txt"}};
    const result={role:"toolResult",toolCallId:independent.id,toolName:independent.name,isError:false,timestamp:102,content:[{type:"text",text:"Actual itinerary"}]};
    assert.equal(await journal.execute(independent,undefined,()=>Promise.resolve(result)),result);assert.equal(saved.length,2);
  }finally{journal.dispose();}
});
