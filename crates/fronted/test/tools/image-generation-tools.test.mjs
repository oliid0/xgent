import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const png=readFileSync(new URL("../../src-tauri/icons/StoreLogo.png",import.meta.url));
const provider=()=>({id:"original-account",type:"codex",name:"Images",baseUrl:"https://openrouter.ai/api/v1",requestFormat:"openai-completions",apiKey:"",apiKeyConfigured:true,activeModels:["actual/image-model","text-model"],models:[{id:"actual/image-model"},{id:"text-model"}]});
const image=()=>({data:[{b64_json:png.toString("base64"),media_type:"image/png"}]});
const catalog=()=>({data:[{id:"actual/image-model",architecture:{input_modalities:["text","image"],output_modalities:["image"]}},{id:"text-model",architecture:{input_modalities:["text"],output_modalities:["text"]}},{id:"unconfigured-image",architecture:{input_modalities:["text"],output_modalities:["image"]}}]});
const call=(argumentsPatch={})=>({id:"generate",name:"GenerateImage",arguments:{provider_id:"original-account",model:"actual/image-model",prompt:"Product illustration",path:"assets/产品",...argumentsPatch}});
function fixture({responses=[catalog(),image()],existing=false,writeFailure,onFetch,onWrite,verify,budgetFailure}={}){
  const reads=[],writes=[],checks=[],requests=[],preparations=[];let admitted=0;
  const port={invoke:async(command,args)=>{
    if(command==="fs_path_status"){reads.push(args);return {exists:existing};}
    if(command==="fs_create_binary"){writes.push(args);onWrite?.();if(writeFailure)throw new Error(writeFailure);return {path:args.path,bytesWritten:Buffer.from(args.content_base64,"base64").length,contentHash:args.expected_content_hash};}
    assert.fail(`Unexpected command ${command}`);
  },homeDir:async()=>"/home",listen:async()=>()=>{}};
  const settings=[provider()];
  const loader=createTsModuleLoader({mocks:{"../providers/runtime/requestOptions":{prepareProviderRequest:async(type,runtime,options)=>{preparations.push({type,runtime,options});assert.equal(options.invoke,port.invoke);return {baseUrl:"http://127.0.0.1:1234/proxy/codex/api/v1",headers:{"x-xgent-provider-config-id":runtime.providerConfigId}};}}}});
  const api=loader.loadModule("src/lib/tools/imageGenerationTools.ts");
  const tools=api.createImageGenerationTools({providers:settings,verifyConfiguration:async()=>{checks.push(checks.length+1);await verify?.(checks.length);},beforeRequest:async()=>{if(budgetFailure)throw new Error("Original shared budget exhausted");admitted++;}},port,"/accepted");
  // Mutable settings/UI cannot replace the captured account or filesystem port.
  settings[0].id="replacement";settings[0].baseUrl="https://replacement.invalid";
  const fetch=async(url,options)=>{requests.push({url,options});onFetch?.(requests.length);const body=responses[requests.length-1];if(body instanceof Error)throw body;return body instanceof Response?body:new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});};
  return {tools,fetch,reads,writes,checks,requests,preparations,admitted:()=>admitted};
}
async function run(f,operation=call(),signal){const original=globalThis.fetch;globalThis.fetch=f.fetch;try{return await f.tools.executeToolCall(operation,signal);}finally{globalThis.fetch=original;}}

test("actual image discovery excludes unconfigured/text-only models and never generates, writes or admits model use",async()=>{
  const accountFixture=fixture();const accounts=await run(accountFixture,{id:"accounts",name:"ImageModels",arguments:{}});
  assert.deepEqual(accounts.details.result,{accounts:[{providerId:"original-account",name:"Images",configuredModels:2}],nextOffset:null});assert.equal(accountFixture.requests.length,0);
  const f=fixture();const result=await run(f,{id:"list",name:"ImageModels",arguments:{provider_id:"original-account"}});
  assert.equal(result.isError,false);assert.deepEqual(result.details.result.models,[{id:"actual/image-model",input:["text","image"]}]);
  assert.equal(f.requests[0].options.method,"GET");assert.match(f.requests[0].url,/images\/models$/);
  assert.equal(f.writes.length,0);assert.equal(f.admitted(),0);assert.equal(f.tools.metadataByName.get("ImageModels").isReadOnly,true);
});

test("one admitted real generation saves verified PNG bytes through the original exclusive filesystem port",async()=>{
  const f=fixture(),result=await run(f);assert.equal(result.isError,false,JSON.stringify(result));
  assert.equal(f.admitted(),1);assert.equal(f.requests.length,2);assert.equal(f.requests[1].options.method,"POST");
  assert.deepEqual(JSON.parse(f.requests[1].options.body),{model:"actual/image-model",prompt:"Product illustration"});
  assert.match(f.requests[1].url,/\/images$/);assert.equal(f.writes.length,1);
  assert.equal(f.writes[0].workdir,"/accepted");assert.equal(f.writes[0].path,"assets/产品.png");
  assert.deepEqual(Buffer.from(f.writes[0].content_base64,"base64"),png);
  assert.equal(result.details.result.contentHash,createHash("sha256").update(png).digest("hex"));
  assert.doesNotMatch(result.content[0].text,/b64_json|base64|x-xgent|apiKey/);
  assert.equal(f.tools.metadataByName.get("GenerateImage").isReadOnly,false);
});

test("invalid paths/IDs, no actual capability, existing files and exhausted budget cannot start paid generation",async()=>{
  for(const args of [{provider_id:"replacement"},{path:"../private"},{path:"root://secret/file"},{path:"image.png"},{path:"images/\0invalid"},{model:"text-model"},{model:"unconfigured-image"},{prompt:""},{endpoint:"https://evil.test"}]){
    const f=fixture(),result=await run(f,call(args));assert.equal(result.isError,true);assert.equal(f.admitted(),0);assert.equal(f.requests.some(request=>request.options.method==="POST"),false);assert.equal(f.writes.length,0);
  }
  for(const options of [{existing:true},{budgetFailure:true}]){const f=fixture(options),result=await run(f);assert.equal(result.isError,true);assert.equal(f.requests.length,1);assert.equal(f.writes.length,0);}
});

test("captured proxy preparation bypasses selected-PC cached transport and retains original account headers",async()=>{
  const localCalls=[];
  const {prepareProviderRequest}=createTsModuleLoader({mocks:{"@xgent/runtime":{invoke:()=>assert.fail("No mutable selected PC")}}}).loadModule("src/lib/providers/runtime/requestOptions.ts");
  const invoke=async(command)=>{localCalls.push(command);return {baseUrl:"http://127.0.0.1:1241",token:"original-private-token"};};
  const prepared=await prepareProviderRequest("codex",{providerConfigId:"original-account",baseUrl:"https://openrouter.ai/api/v1",isFullUrl:false,apiKey:"",requestFormat:"openai-completions"},{invoke});
  assert.deepEqual(localCalls,["proxy_get_server_info"]);assert.match(prepared.baseUrl,/^http:\/\/127\.0\.0\.1:1241\/proxy\/codex/);
  assert.equal(prepared.headers["x-xgent-provider-config-id"],"original-account");assert.equal(prepared.headers["x-xgent-proxy-token"],"original-private-token");
  await prepareProviderRequest("codex",{providerConfigId:"original-account",baseUrl:"https://openrouter.ai/api/v1",isFullUrl:false,apiKey:"",requestFormat:"openai-completions"},{invoke});assert.equal(localCalls.length,2);
});

test("post request failures, wrong MIME, missing/multiple/invalid media and failed writes retain uncertainty without retries or fake files",async()=>{
  const variants=[new Error("Network response lost"),{data:[]},{data:[image().data[0],image().data[0]]},{data:[{b64_json:png.toString("base64"),media_type:"image/jpeg"}]},{data:[{b64_json:"bad encoding"}]},{data:[{b64_json:Buffer.from("not an image").toString("base64")}]},new Response("",{status:503})];
  for(const response of variants){const f=fixture({responses:[catalog(),response]}),result=await run(f);assert.equal(result.isError,true);assert.equal(result.details.outcomeUncertain,true);assert.equal(f.requests.length,2);assert.equal(f.writes.length,0);}
  const f=fixture({writeFailure:"Disk failure"}),failed=await run(f);assert.equal(failed.isError,true);assert.equal(failed.details.outcomeUncertain,true);assert.equal(f.writes.length,1);assert.equal(f.requests.length,2);
});

test("cancellation/revocation cannot leak late generated files; a confirmed write retains its actual receipt after cancellation",async()=>{
  const stopped=new AbortController();stopped.abort();const idle=fixture();assert.equal((await run(idle,call(),stopped.signal)).isError,true);assert.equal(idle.requests.length,0);
  const controller=new AbortController(),f=fixture({onFetch:n=>{if(n===2)controller.abort();}});
  const cancelled=await run(f,call(),controller.signal);assert.equal(cancelled.isError,true);assert.equal(cancelled.details.outcomeUncertain,true);assert.equal(f.writes.length,0);
  const changed=fixture({verify:async(n)=>{if(n===6)throw new Error("Original account revoked");}});
  const refusal=await run(changed);assert.equal(refusal.isError,true);assert.equal(changed.writes.length,0);
  const late=new AbortController(),saved=fixture({onWrite:()=>late.abort()});assert.equal((await run(saved,call(),late.signal)).isError,false);assert.equal(saved.writes.length,1);
});

test("bounded body readers reject oversized/ambiguous catalogs and oversized returned image bodies",async()=>{
  for(const response of [new Response("{}",{headers:{"content-length":"2097153"}}),{data:[catalog().data[0],catalog().data[0]]}]){
    const f=fixture({responses:[response]}),result=await run(f,{id:"list",name:"ImageModels",arguments:{provider_id:"original-account"}});assert.equal(result.isError,true);assert.equal(f.admitted(),0);
  }
  const f=fixture({responses:[catalog(),new Response("{}",{headers:{"content-length":"12582913"}})]});const result=await run(f);assert.equal(result.isError,true);assert.equal(result.details.outcomeUncertain,true);assert.equal(f.writes.length,0);
});

test("unsupported relays, full URLs, OAuth, credentialless accounts and mismatched chat formats expose no fake media tool",()=>{
  const {createImageGenerationTools}=createTsModuleLoader().loadModule("src/lib/tools/imageGenerationTools.ts");
  for(const patch of [{baseUrl:"https://relay.example/api/v1"},{baseUrl:"https://openrouter.ai/api/v1?key=secret"},{isFullUrl:true},{authMode:"oauth-managed"},{apiKeyConfigured:false},{requestFormat:"openai-responses"},{type:"gemini"}])assert.equal(createImageGenerationTools({providers:[{...provider(),...patch}],verifyConfiguration:async()=>{},beforeRequest:async()=>{}},{},"/accepted"),null);
});
