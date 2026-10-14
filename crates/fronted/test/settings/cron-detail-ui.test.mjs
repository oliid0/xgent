import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { annotationBrowser } from "../helpers/document-annotation-browser.mjs";
import { imageBrowserCompletion } from "../helpers/image-browser-completion.mjs";

const modules = { Banner:["Banner"], EmptyState:["EmptyState"], List:["ListItem"], Spinner:["Spinner"], IconButton:["IconButton"], SegmentedControl:["SegmentedControl","SegmentedControlItem"], Stack:["Stack"], Text:["Heading","Text"] };
const task = { id:"actual-task", name:"产品汇报与明日行程安排 Product presentation and tomorrow's itinerary", type:"prompt", cron:"0 20 * * *", enabled:true, remainingExecutions:7, timeoutSeconds:300, prompt:"Review the documents and prepare the implementation plan.", selectedModel:{model:"configured-model",customProviderId:"internal-account-id"} };
const records = [
  {id:"completed",taskId:task.id,state:"done",success:true,startedAt:1791664740000,durationMs:1250,exitCode:0,output:"Actual execution result"},
  {id:"expired",taskId:task.id,state:"expired",success:true,startedAt:1791578340000,durationMs:300000,output:"Timed out"},
  {id:"leased",taskId:task.id,state:"leased",success:false,startedAt:1791491940000,durationMs:0,output:""},
];
const history = () => ({ logs:records,successCount:1,failCount:1,runningCount:1,clearableCount:2,loading:false,isClearing:false,loadError:"",clearError:"",async refresh(){},async clear(){} });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree?.props ? [tree,...nodes(tree.props.children)] : [];
const flatten = list => list.flatMap(node=>[node,...flatten(node.children??[])]);
const glyphs = JSON.parse(readFileSync(new URL("../../node_modules/@iconify-json/lucide/icons.json",import.meta.url),"utf8"));
const icons = Object.fromEntries(Object.entries({BrushCleaning:"brush-cleaning",ChevronDown:"chevron-down",ChevronLeft:"chevron-left",ChevronRight:"chevron-right",Loader2:"loader-circle",Play:"play",RefreshCw:"refresh-cw",X:"x"}).map(([key,name])=>[key,()=>React.createElement("svg",{width:24,height:24,viewBox:"0 0 24 24","aria-hidden":true,dangerouslySetInnerHTML:{__html:glyphs.icons[name].body}})]));
const sharedMocks = { "../../i18n":{useLocale:()=>({t:key=>key})}, "../../components/icons":icons, "./SettingsModalShell":{SettingsModalShell:()=>null}, "./SettingsDetailHeader":{SettingsDetailHeader:()=>null}, "./shared":{ConfirmActionPopover:({children})=>children(()=>{})}, "../../presentation/NativeSurface":{NativeSurface:()=>null}, "../../presentation/NativeSettingsContent":{NativeSettingsContent:()=>null}, "../../presentation/nativeTheme":{createNativePresentationTheme:()=>undefined} };

test("Astryx history expands the original run, retries and invokes the existing confirmation before clearing",async t=>{
  const hooks=createReactHookHarness(),calls=[],state=history();
  state.refresh=async()=>calls.push("refresh");state.clear=async()=>calls.push("clear");
  const mocks={...sharedMocks,react:{...hooks.react,Fragment:"Fragment"},"./shared":{ConfirmActionPopover:"ConfirmActionPopover"},"./useCronRunHistory":{useCronRunHistory:id=>{assert.equal(id,task.id);return state;}}};
  for(const [name,exports] of Object.entries(modules))mocks["@astryxdesign/core/"+name]=Object.fromEntries(exports.map(key=>[key,key]));
  const {CronRunHistoryPanel}=createTsModuleLoader({mocks}).loadModule("src/pages/settings/CronTaskViewModal.tsx");
  const render=()=>hooks.render(()=>CronRunHistoryPanel({task,t:key=>key,onClose(){}}));t.after(hooks.unmount);
  let tree=render();nodes(tree).find(node=>node.type==="ListItem").props.onClick();tree=render();
  assert.ok(nodes(tree).some(node=>node.type==="pre"&&node.props.children===records[0].output));
  const retry=nodes(tree).find(node=>node.type==="IconButton"&&node.props.label==="presentation.retry");await retry.props.onClick();assert.deepEqual(calls,["refresh"]);
  const confirmation=nodes(tree).find(node=>node.type==="ConfirmActionPopover");let opens=0;
  confirmation.props.children(()=>opens++).props.onClick();assert.equal(opens,1);assert.deepEqual(calls,["refresh"]);
  await confirmation.props.onConfirm();assert.deepEqual(calls,["refresh","clear"]);
  state.loading=true;assert.equal(nodes(render()).find(node=>node.type==="IconButton"&&node.props.label==="presentation.retry").props.isDisabled,true);
  state.logs=[];state.loadError="offline";state.loading=false;
  tree=render();assert.ok(nodes(tree).some(node=>node.type==="Banner"&&node.props.children==="offline"));assert.ok(!nodes(tree).some(node=>node.type==="EmptyState"));
});

test("SwiftUI history shares exact display values, validates the protocol and guards retired confirmations",async()=>{
  const loader=createTsModuleLoader(),{presentationControls}=loader.loadModule("src/presentation/controls.ts"),{nativeCronRunNodes}=loader.loadModule("src/presentation/nativeCronRunNodes.ts"),{cronRunDisplay}=loader.loadModule("src/presentation/cronDisplay.ts"),{validatePresentationDocument}=loader.loadModule("src/presentation/validateDocument.ts");
  let expanded=null,current=true,approved=false;const state=history(),calls=[];
  state.clear=async()=>calls.push("clear");state.refresh=async()=>calls.push("refresh");
  const controls=presentationControls(),options={controls,task,history:state,t:key=>key,compact:false,tab:"logs",setTab(){},expanded,setExpanded:id=>expanded=id,running:false,runError:null,run:async()=>calls.push("run"),confirm:async()=>approved,current:()=>current};
  const render=()=>{const result=nativeCronRunNodes({...options,expanded});validatePresentationDocument({version:1,surface:"cron",revision:1,mode:"sheet",title:task.name,nodes:result},controls.handlers);return flatten(result);};
  let view=render();assert.ok(view.some(node=>node.variant==="cron-run-list"));assert.ok(!JSON.stringify(view).includes("internal-account-id"));assert.ok(!JSON.stringify(view).includes("cronViewNoDesc"));
  const row=view.find(node=>node.id==="completed:expand"),display=cronRunDisplay(records[0],key=>key);assert.equal(row.label,display.date);assert.equal(row.text,display.time);assert.equal(row.value,display.label);
  options.locale="zh-CN";assert.match(render().find(node=>node.id==="completed:expand").label,/年/);
  options.locale="en-US";assert.doesNotMatch(render().find(node=>node.id==="completed:expand").label,/年/);
  assert.equal(view.find(node=>node.id==="cron-run:expired").status,"error");
  await controls.handlers.get("completed:expand").run(null);assert.equal(render().find(node=>node.id==="completed:output").text,records[0].output);
  await controls.handlers.get("clear-logs").run(null);assert.deepEqual(calls,[]);
  approved=true;current=false;await controls.handlers.get("clear-logs").run(null);assert.deepEqual(calls,[]);
  current=true;await controls.handlers.get("clear-logs").run(null);assert.deepEqual(calls,["clear"]);assert.equal(expanded,null);
});

test("installed Astryx task details and run history fit narrow screens, text scaling and both locales",{skip:annotationBrowser?false:"Chromium required"},async()=>{
  const vendor={};for(const name of [...Object.keys(modules),"theme"])vendor["@astryxdesign/core/"+name]=await import("@astryxdesign/core/"+name);
  const base=createTsModuleLoader(),{translations}=base.loadModule("src/i18n/config.ts"),{xgentCompactTheme}=base.loadModule("src/theme/xgentTheme.ts"),fixtures=[];
  for(const width of [320,390])for(const scale of [1,1.5])for(const locale of ["zh-CN","en-US"])for(const view of ["prompt","bash","http","history","empty","loading","error"]){
    const state=history();if(view==="empty"||view==="loading"||view==="error")state.logs=[];state.loading=view==="loading";state.loadError=view==="error"?"Network unavailable": "";
    const loader=createTsModuleLoader({mocks:{...sharedMocks,...vendor,"../../i18n":{useLocale:()=>({locale})},react:{...React,useState:initial=>[initial===null?"completed":initial,()=>{}]},"react/jsx-runtime":jsx,"./useCronRunHistory":{useCronRunHistory:()=>state}}});
    const {CronTaskDetails,CronRunHistoryPanel}=loader.loadModule("src/pages/settings/CronTaskViewModal.tsx"),t=key=>{assert.ok(key in translations[locale],"Missing translation "+key);return translations[locale][key];};
    const selected={...task,type:view,workdir:"/very-long-project-path/product-presentation/reports-and-implementation-plan",...(view==="bash"?{script:"echo actual-script"}:{}),...(view==="http"?{requests:[{id:"http",method:"POST",url:"https://example.com/very-long-api-endpoint/implementation-plan",headers:{"Content-Type":"application/json"},body:{actual:"payload"}}]}:{})};
    const detail=["prompt","bash","http"].includes(view);
    fixtures.push(React.createElement("section",{className:"fixture",key:[width,scale,locale,view].join("-"),"data-width":width,"data-scale":scale,"data-locale":locale,"data-view":view,style:{width,height:760,display:"flex",flexDirection:"column","--text-label-size":(15*scale)+"px","--text-body-size":(15*scale)+"px"}},React.createElement(detail?CronTaskDetails:CronRunHistoryPanel,{task:detail?selected:task,t,isRunningNow:false,runNowError:null,onRunNow(){},onClose(){},hideClose:true})));
  }
  const {Theme,generateThemeCSS}=vendor["@astryxdesign/core/theme"],css=generateThemeCSS(xgentCompactTheme);
  const appCss=readFileSync(new URL("../../src/index.css",import.meta.url),"utf8").replace(/^@import .*;$/gm,""),vendorCss=readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css",import.meta.url),"utf8"),reset=readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")),"utf8");
  const markup=renderToStaticMarkup(React.createElement(Theme,{theme:xgentCompactTheme},...fixtures));
  const directory=await mkdtemp(path.join(tmpdir(),"xgent-cron-detail-")),artifacts=path.resolve("../../.ci-artifacts/autonomy-cron-detail-layout");
  try{
    await mkdir(artifacts,{recursive:true});const file=path.join(directory,"cron.html");
    await writeFile(file,`<!doctype html><html data-theme="light" data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><style>${reset}\n${vendorCss}\n${appCss}\n@layer reset{${css.prose}}@layer astryx-theme{${css.component}}.fixture{margin:16px;background:white;font-family:system-ui,sans-serif}.fixture *{box-sizing:border-box}#result{display:none}</style>${markup}<pre id="result"></pre><script>requestAnimationFrame(()=>requestAnimationFrame(()=>{const failures=[];for(const section of document.querySelectorAll('.fixture')){const r=section.getBoundingClientRect();if(section.scrollWidth>section.clientWidth+1)failures.push('Overflow '+JSON.stringify(section.dataset));for(const c of section.querySelectorAll('button')){const b=c.getBoundingClientRect();if(!b.height)continue;if(b.left<r.left-1||b.right>r.right+1)failures.push('Clipped '+JSON.stringify(section.dataset));if(b.height<43.9)failures.push('Small target '+JSON.stringify(section.dataset));}for(const row of section.querySelectorAll('.cron-history-entry .astryx-list-item')){const end=row.querySelector('.cron-history-status');if(end&&end.getBoundingClientRect().right>row.getBoundingClientRect().right+1)failures.push('Clipped status '+JSON.stringify(section.dataset));}if(/internal-account-id|暂无描述|No description/.test(section.textContent))failures.push('Unrelated metadata');}const item=document.querySelector('.cron-history-entry .astryx-list-item button span');const fonts=item?{row:getComputedStyle(item).fontFamily,body:getComputedStyle(document.body).fontFamily}:{};document.getElementById('result').textContent=JSON.stringify({failures,fixtures:document.querySelectorAll('.fixture').length,fonts});}));</script></html>`);
    await writeFile(path.join(artifacts,"cron.html"),readFileSync(file));
    const result=JSON.parse(await imageBrowserCompletion(annotationBrowser,pathToFileURL(file).href,directory,{screenshotPath:path.join(artifacts,"history.png"),screenshotSelector:'.fixture[data-width="390"][data-scale="1"][data-locale="zh-CN"][data-view="history"]',isolateScreenshot:true}));
    await writeFile(path.join(artifacts,"measurements.json"),JSON.stringify(result,null,2));assert.deepEqual(result.failures,[]);assert.equal(result.fixtures,56);
  }finally{await rm(directory,{recursive:true,force:true});}
});
