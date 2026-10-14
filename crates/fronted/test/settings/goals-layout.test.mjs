import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdir,mkdtemp,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { annotationBrowser } from "../helpers/document-annotation-browser.mjs";
import { imageBrowserCompletion } from "../helpers/image-browser-completion.mjs";

const glyphData=JSON.parse(readFileSync(new URL("../../node_modules/@iconify-json/lucide/icons.json",import.meta.url),"utf8"));
const icons=Object.fromEntries(Object.entries({Building2:"building-2",Check:"check",Clock3:"clock",ChevronRight:"chevron-right",Download:"download",FileText:"file-text",ChevronLeft:"chevron-left",Circle:"circle",Heart:"heart",Laptop:"laptop",MoreHorizontal:"ellipsis",Palette:"palette",Plus:"plus",RefreshCw:"refresh-cw",Users:"users",Wallet:"wallet"}).map(([key,name])=>[key,()=>React.createElement("svg",{width:24,height:24,viewBox:"0 0 24 24","aria-hidden":true,dangerouslySetInnerHTML:{__html:glyphData.icons[name].body}})]));

test("installed Astryx Goals match shared SwiftUI values and fit narrow screens, enlarged text and both languages",{skip:annotationBrowser?false:"Chromium required"},async()=>{
  const vendor={react:React,"react/jsx-runtime":jsx,"../../components/icons":icons,"../../components/astryx/useConfirmDialog":{},"../../lib/automation/useGoals":{},"../../lib/useMobileBackNavigation":{},"../../presentation/NativeSurface":{},"../../presentation/NativeSettingsContent":{}};
  for(const name of ["Banner","Button","CheckboxInput","DropdownMenu","IconButton","Layout","List","Selector","Spinner","Text","TextArea","TextInput","theme"])vendor[`@astryxdesign/core/${name}`]=await import(`@astryxdesign/core/${name}`);
  const loader=createTsModuleLoader({mocks:vendor}),{GoalComponents}=loader.loadModule("src/pages/settings/GoalsSection.tsx"),{goalNodes}=loader.loadModule("src/presentation/goalNodes.ts"),{translations}=loader.loadModule("src/i18n/config.ts"),{validatePresentationDocument}=loader.loadModule("src/presentation/validateDocument.ts"),{xgentCompactTheme}=loader.loadModule("src/theme/xgentTheme.ts");
  const {Theme,generateThemeCSS}=vendor["@astryxdesign/core/theme"],theme=generateThemeCSS(xgentCompactTheme);
  const goal={id:"launch",config:{title:"产品发布",description:"整理资料、制作汇报与产品网站",category:"career",parentId:null,steps:[{id:"read",title:"阅读资料",done:true},{id:"ppt",title:"制作 PPT",done:false}]},status:"active",createdAt:100,updatedAt:100,tasks:[{id:"fitness",name:"每天晚上提醒健身",exists:true,enabled:true,cron:"0 20 * * *"}],backgroundTasks:[{requestId:"original",name:"整理公司资料并制作产品发布汇报",exists:true,state:"leased",success:null}],artifactCount:3};
  const noop=()=>{},fixtures=[];
  for(const width of [240,390,768])for(const scale of [1,1.5])for(const locale of ["zh-CN","en-US"])for(const mode of ["list","detail","draft","artifacts","launch","launch-loading","launch-error"]) {
    const t=key=>{assert.ok(key in translations[locale],key);return translations[locale][key];},data={snapshot:{revision:1,storeId:"pc-a",goals:[goal],targets:[]},busy:false,error:"",retryAvailable:false,activity:{goalId:"launch",items:[{id:"run:1",kind:"run",label:"整理公司资料并制作产品发布汇报",at:1791664740000,state:"done",success:true,output:"已生成产品说明书、实施方案和汇报文件。\n详细记录"},{id:"edit:1",kind:"created",label:goal.config.title,at:1791664740000,state:null,success:null,output:null}],nextCursor:null},activityBusy:false,activityError:"",refresh:noop,apply:noop,readActivity:noop};
    data.artifacts={goalId:"launch",storeId:"pc-a",items:[{id:"ppt",requestId:"original",relativePath:"reports/产品实施方案.pptx",taskName:"产品汇报",bytes:512000,at:100,contentHash:"a".repeat(64)},{id:"doc",requestId:"original",relativePath:"产品说明书.docx",taskName:"产品汇报",bytes:142000,at:100,contentHash:"b".repeat(64)},{id:"web",requestId:"original",relativePath:"product.html",taskName:"产品官网",bytes:8200,at:100,contentHash:"c".repeat(64)}],nextCursor:null};data.artifactsBusy=false;data.artifactsError="";data.downloadError="";data.transfers={};
    const screen={scope:`${width}-${scale}-${locale}-${mode}`,current:()=>true,data,selected:["detail","artifacts"].includes(mode)?goal:null,draft:mode==="draft"?{id:"new",storeId:"pc-a",config:{...goal.config,title:"新目标"},revision:1,editing:false}:null,showCompleted:false,stepTitle:"",taskId:"",workId:"",setWorkId:noop,linkWork:noop,artifactsOpen:mode==="artifacts",openArtifacts:noop,download:noop,expanded:null,back:noop,open:noop,create:noop,edit:noop,patch:noop,save:noop,setStepTitle:noop,addStep:noop,setTaskId:noop,linkTask:noop,remove:noop,setStatus:noop,toggleCompleted:noop,expand:noop};
    if(mode.startsWith("launch")){
      screen.selected=goal;
      const model={value:JSON.stringify(["provider","main"]),label:"Provider · Main planning model",providerId:"provider",model:"main"};
      const target={peerId:"executor",label:"Windows · workstation",host:{hostId:"executor",intelligentSchedulingVersion:1,workdir:"C:/Users/example/Documents/project"}};
      screen.launch={draft:{goalId:"launch",storeId:"pc-a",revision:1,peer:"executor",model:model.value,scheduling:false},targets:[target],models:[model],target,
        loading:mode==="launch-loading",busy:false,error:mode==="launch-error"?"goals.executorUnavailable":"",retry:mode==="launch-error",canRun:mode==="launch",start:noop,setPeer:noop,setModel:noop,setScheduling:noop};
    }
    const content=goalNodes(screen,t,locale);validatePresentationDocument({version:1,surface:"goals",revision:1,mode:"sheet",title:t("goals.title"),nodes:content.nodes},content.handlers);
    const markup=renderToStaticMarkup(React.createElement(GoalComponents,content));assert.ok(!markup.includes("goals.category."));assert.ok(!markup.includes("pc-a"));if(mode==="list"){assert.ok(markup.includes(goal.config.title));assert.match(markup,/type="checkbox"/);assert.ok(!/<p\b[^>]*>.*(?:autonomous|后台运行)/.test(markup));}
    fixtures.push(React.createElement("section",{key:screen.scope,className:"fixture","data-width":width,"data-scale":scale,"data-locale":locale,"data-mode":mode,style:{width,fontSize:`${15*scale}px`,"--text-label-size":`${15*scale}px`,"--text-supporting-size":`${13*scale}px`}},React.createElement(GoalComponents,content)));
  }
  const css=readFileSync(new URL("../../src/index.css",import.meta.url),"utf8").replace(/^@import .*;$/gm,""),core=readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css",import.meta.url),"utf8"),reset=readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")),"utf8");
  const html=`<!doctype html><html data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><style>${reset}\n${core}\n${css}\n@layer reset{${theme.prose}} @layer astryx-theme{${theme.component}}body{margin:0}.fixture{box-sizing:border-box;margin:8px;padding:20px;background:var(--color-background);color:var(--color-text)}#result{display:none}</style>${renderToStaticMarkup(React.createElement(Theme,{theme:xgentCompactTheme},...fixtures))}<pre id="result"></pre><script>requestAnimationFrame(()=>requestAnimationFrame(()=>{const failures=[];for(const f of document.querySelectorAll('.fixture')){const box=f.getBoundingClientRect();if(f.scrollWidth>Math.ceil(box.width)+1)failures.push('overflow '+JSON.stringify(f.dataset));for(const row of f.querySelectorAll('.goal-row,.goal-category')){const b=row.getBoundingClientRect();if(b.height<69.9||b.left<box.left||b.right>box.right+1)failures.push('row bounds '+JSON.stringify(f.dataset));}for(const button of f.querySelectorAll('button')){const b=button.getBoundingClientRect();if(b.width<43.9||b.height<43.9)failures.push('button target '+button.textContent);}}document.getElementById('result').textContent=JSON.stringify({failures,fixtures:document.querySelectorAll('.fixture').length});}));</script></html>`;
  const directory=await mkdtemp(path.join(tmpdir(),"xgent-goals-layout-")),artifacts=path.resolve("../../.ci-artifacts/autonomy-goals-layout");
  try{
    await mkdir(artifacts,{recursive:true});const file=path.join(directory,"review.html");await writeFile(file,html);await writeFile(path.join(artifacts,"review.html"),html);
    const selector=mode=>`.fixture[data-width="390"][data-scale="1"][data-locale="zh-CN"][data-mode="${mode}"]`;
    const result=JSON.parse(await imageBrowserCompletion(annotationBrowser,pathToFileURL(file).href,directory,{screenshotPath:path.join(artifacts,"goals.png"),screenshotSelector:selector("list"),isolateScreenshot:true}));await writeFile(path.join(artifacts,"measurements.json"),JSON.stringify(result,null,2));assert.deepEqual(result.failures,[]);assert.equal(result.fixtures,84);
    const detailDirectory=path.join(directory,"detail");await mkdir(detailDirectory);
    await imageBrowserCompletion(annotationBrowser,pathToFileURL(file).href,detailDirectory,{screenshotPath:path.join(artifacts,"detail.png"),screenshotSelector:selector("detail"),isolateScreenshot:true});
    const filesDirectory=path.join(directory,"files");await mkdir(filesDirectory);
    await imageBrowserCompletion(annotationBrowser,pathToFileURL(file).href,filesDirectory,{screenshotPath:path.join(artifacts,"artifacts.png"),screenshotSelector:selector("artifacts"),isolateScreenshot:true});
    const launchDirectory=path.join(directory,"launch");await mkdir(launchDirectory);
    await imageBrowserCompletion(annotationBrowser,pathToFileURL(file).href,launchDirectory,{screenshotPath:path.join(artifacts,"launch.png"),screenshotSelector:selector("launch"),isolateScreenshot:true});
  }finally{await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
