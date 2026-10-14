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
import { annotationBrowser } from "../helpers/document-annotation-browser.mjs";
import { imageBrowserCompletion } from "../helpers/image-browser-completion.mjs";

test("actual task action renderer fits narrow screens, long account IDs and enlarged text in both locales", {
  skip: annotationBrowser ? false : "A Chromium browser is required for layout evidence",
}, async()=>{
  const vendor={};
  for(const name of ["Banner","Button","DropdownMenu","Icon","IconButton","List","Layout","Text","TextInput","theme"])
    vendor[`@astryxdesign/core/${name}`]=await import(`@astryxdesign/core/${name}`);
  const glyphs=JSON.parse(readFileSync(new URL("../../node_modules/@iconify-json/lucide/icons.json",import.meta.url),"utf8"));
  const icon=name=>()=>React.createElement("svg",{width:24,height:24,viewBox:"0 0 24 24","aria-hidden":true,dangerouslySetInnerHTML:{__html:glyphs.icons[name].body}});
  const loader=createTsModuleLoader({mocks:{...vendor,react:React,"react/jsx-runtime":jsx,"react-dom":{flushSync:fn=>fn()},
    "@xgent/runtime":{},"../../i18n":{},"../../lib/automation/backend":{},
    "../../lib/automation/backgroundInboxArtifacts":{},"../../lib/automation/backgroundInboxSnapshot":{},
    "../../lib/runtimePlatform":{},"../../runtime/applePresentation":{},
    "../../presentation/NativeSurface":{},"../../presentation/NativeSettingsContent":{},"../../presentation/nativeTheme":{},
    "./useMobileBranchReview":{},
    "../../components/icons":{Check:icon("check"),Circle:icon("circle"),MoreHorizontal:icon("ellipsis"),RefreshCw:icon("refresh-cw")},
  }});
  const {backgroundInboxNodeRenderer}=loader.loadModule("src/pages/settings/BackgroundInboxSection.tsx");
  const {mobileBranchReviewNodes}=loader.loadModule("src/pages/settings/mobileBranchReviewNodes.ts");
  const {presentationControls}=loader.loadModule("src/presentation/controls.ts");
  const {translations}=loader.loadModule("src/i18n/config.ts");
  const {xgentCompactTheme}=loader.loadModule("src/theme/xgentTheme.ts");
  const {Theme,generateThemeCSS}=vendor["@astryxdesign/core/theme"];
  const themeCss=generateThemeCSS(xgentCompactTheme);
  const css=readFileSync(new URL("../../src/index.css",import.meta.url),"utf8").replace(/^@import .*;$/gm,"");
  const vendorCss=readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css",import.meta.url),"utf8");
  const reset=readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")),"utf8");
  const source={id:"calendar",requirement:"处理这些文档之后安排明天行程，每天晚上提醒我健身 / Arrange the actual requested event and reminder",dependsOn:["report"],locality:"initiating-device"};
  const input={operationId:"a".repeat(64),deviceHostId:"original-phone",kind:"reminder",request:{title:"每晚健身 / Evening exercise",calendarId:"calendar-"+"x".repeat(90),dueMs:2000000000000,recurrence:"daily"}};
  const accountId="native-account-"+"x".repeat(120);
  const action={input,sourceId:accountId};
  const fixtures=[];
  for(const width of [240,320,390,768]) for(const scale of [1,1.5]) for(const locale of ["en-US","zh-CN"]) for(const variant of ["saved","unknown","exhausted","offline","loading","empty","cancelled","busy","pending","approved","revoked","policy-denied","read-choices","read-page","read-empty","read-approved","read-revoked","read-denied","read-stale","read-busy","read-cancelled","read-single","health-choices","health-approved","health-denied"]) {
    const c=presentationControls();
    const branch={source,plan:variant==="exhausted"?null:{version:1,requestId:"request",sourceHostId:"controller",source,actions:[action]},
      records:[{input,destination:{kind:"reminder",id:input.request.calendarId,sourceId:accountId,source:"Work account / 工作账户"},state:variant==="unknown"?"unknown":"succeeded",
        result:variant==="unknown"?null:{id:"actual-native-record-"+"x".repeat(80),presented:false,detail:"Saved"},error:variant==="unknown"?"Provider reply lost / 系统回执尚未确认":null,startedAt:1,finishedAt:2}],
      labels:[{id:input.request.calendarId,title:"实际观察到的提醒列表 / Observed reminder list",sourceId:accountId,source:"Work account / 工作账户"}],
      attempts:3,recovery:2,lastError:variant==="exhausted"?"实际规划失败 / Actual model planning failed":null,acknowledged:variant==="saved",canRetryPlanning:variant==="exhausted"};
    if(["pending","approved","revoked","policy-denied","busy","cancelled"].includes(variant)) {
      branch.records=[null];branch.authorization={planHash:"exact-hash",revision:2,required:true,decision:variant==="approved"?"approved":variant==="revoked"?"revoked":"pending",
        allowed:variant==="approved",blockedReason:variant==="policy-denied"?"The current policy denies this connector / 当前策略拒绝此连接器":null,
        canApprove:!["approved","policy-denied","cancelled"].includes(variant),canRevoke:variant!=="revoked"};
    }
    const readChoices={};
    if(variant.startsWith("health-")) {
      branch.plan=null;branch.records=[];
      const choices=[{kind:"health",id:"heart_rate",sourceId:"healthkit",title:"heart_rate",source:"HealthKit",writable:false,startMs:1791590400000,endMs:1791676800000}];
      branch.readAuthorization={contextHash:"actual-context",revision:2,decision:variant==="health-approved"?"approved":"pending",selections:variant==="health-approved"?choices:[],allowedKinds:variant==="health-approved"?["health"]:[],canDiscoverKinds:variant==="health-denied"?[]:["health"],blockedReasons:variant==="health-denied"?{health:"Access revoked / 访问已撤销"}:{},canApprove:variant!=="health-denied",canRevoke:true};
      if(variant==="health-choices")readChoices.calendar={contextHash:"actual-context",revision:2,generation:7,choices,selected:choices,page:0,truncated:false};
    }
    if(variant.startsWith("read-")) {
      branch.plan=null;branch.records=[];
      const choices=Array.from({length:25},(_,i)=>({kind:"event",id:`actual-${i}-`+"x".repeat(90),sourceId:accountId,title:"实际只读日历 / Observed calendar "+i,source:"Actual work account / 实际工作账户",writable:i!==0}));
      branch.readAuthorization={contextHash:"actual-context",revision:2,decision:variant==="read-approved"?"approved":variant==="read-revoked"?"revoked":"pending",selections:variant==="read-approved"?[choices[0]]:[],allowedKinds:variant==="read-approved"?["event"]:[],canDiscoverKinds:variant==="read-denied"?[]:["event","reminder"],blockedReasons:variant==="read-denied"?{event:"The current policy denies reads / 当前策略拒绝读取"}:{},canApprove:variant!=="read-denied",canRevoke:variant!=="read-revoked"};
      if(["read-choices","read-page","read-empty","read-stale","read-busy","read-cancelled","read-single"].includes(variant))readChoices.calendar={contextHash:"actual-context",revision:variant==="read-stale"?1:2,generation:7,choices:variant==="read-empty"?[]:variant==="read-single"?choices.slice(0,1):choices,selected:variant==="read-empty"?[]:[choices[0]],page:variant==="read-page"?1:0,truncated:!["read-empty","read-single"].includes(variant)};
    }
    const view={review:variant==="loading"?null:{requestId:"request",sourceHostId:"controller",deviceHostId:"original-phone",cancelRequested:variant==="cancelled"||variant==="read-cancelled",branches:variant==="empty"?[]:[branch]},
      loading:variant==="loading",busy:variant==="busy"||variant==="read-busy",error:variant==="offline"?"Original controller unavailable / 原主机不可达 "+accountId:null,readChoices,
      refresh(){},retryPlanning(){},decideAuthorization(){},loadReadChoices(){},editReadChoices(){},decideReadAuthorization(){}};
    const nodes=mobileBranchReviewNodes(c,view,key=>translations[locale][key]??key);
    const render=backgroundInboxNodeRenderer(c);
    fixtures.push(React.createElement("section",{key:`${width}-${scale}-${locale}-${variant}`,className:"fixture autonomy-settings","data-width":width,"data-scale":scale,"data-locale":locale,"data-variant":variant,
      style:{width,fontSize:`${15*scale}px`,"--text-label-size":`${15*scale}px`}},...nodes.map(node=>render(node))));
  }
  const markup=renderToStaticMarkup(React.createElement(Theme,{theme:xgentCompactTheme},...fixtures));
  const html=`<!doctype html><html data-theme="light" data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><style>${reset}\n${vendorCss}\n${css}
    @layer reset {${themeCss.prose}} @layer astryx-theme {${themeCss.component}}
    :root {--spacing-1:4px;--spacing-2:8px;--size-element-sm:32px;--size-element-md:40px;--size-element-lg:44px;}
    .fixture{margin:16px}.fixture *{box-sizing:border-box}#result{display:none}
    </style>${markup}<pre id="result"></pre><script>addEventListener('load',()=>requestAnimationFrame(()=>{
      const failures=[],evidence=[];
      for(const section of document.querySelectorAll('.fixture')) {
        const bounds=section.getBoundingClientRect();
        if(section.scrollWidth>section.clientWidth+1)failures.push('Overflow '+JSON.stringify(section.dataset));
        const controls=[...section.querySelectorAll('button')].filter(c=>c.getBoundingClientRect().height>0);
        const boxes=controls.map(c=>c.getBoundingClientRect());
        for(let i=0;i<boxes.length;i++) {
          const b=boxes[i],c=controls[i];
          if(b.left<bounds.left-1||b.right>bounds.right+1)failures.push('Clipped control '+JSON.stringify(section.dataset));
          if(b.height<43.9||b.width<43.9)failures.push('Small target '+JSON.stringify(section.dataset));
          if(!c.getAttribute('aria-label')&&!c.textContent.trim())failures.push('Unlabelled control');
          const walker=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);
          while(walker.nextNode()) {
            if(!walker.currentNode.textContent.trim())continue;
            // Installed ListItem intentionally ellipsizes data labels and retains the
            // full text in its accessible button name. Verify the row bounds above;
            // the unpainted tail of a text range is not a clipped action label.
            if(getComputedStyle(walker.currentNode.parentElement).textOverflow==='ellipsis')continue;
            const range=document.createRange();range.selectNodeContents(walker.currentNode);
            for(const r of range.getClientRects())if(r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1)failures.push('Clipped button label '+c.textContent+' '+JSON.stringify(section.dataset));
          }
          for(let j=i+1;j<boxes.length;j++)if(boxes[j].left<b.right-1&&boxes[j].right>b.left+1&&boxes[j].top<b.bottom-1&&boxes[j].bottom>b.top+1)failures.push('Overlapping controls');
        }
        evidence.push({...section.dataset,controls:boxes.map(b=>({width:b.width,height:b.height})),disabled:controls.filter(c=>c.disabled||c.getAttribute('aria-disabled')==='true').length});
      }
      document.getElementById('result').textContent=JSON.stringify({failures,evidence});
    }));</script></html>`;
  const directory=await mkdtemp(path.join(tmpdir(),"xgent-branch-review-layout-")),artifacts=path.resolve("../../.ci-artifacts/autonomy-mobile-health-reads-layout");
  try {
    await mkdir(artifacts,{recursive:true});const file=path.join(directory,"review.html");await writeFile(file,html);
    const result=JSON.parse(await imageBrowserCompletion(annotationBrowser,pathToFileURL(file).href,directory,{
      screenshotPath:path.join(artifacts,"review.png"),screenshotSelector:'.fixture[data-width="320"][data-scale="1.5"][data-locale="zh-CN"][data-variant="health-choices"]',isolateScreenshot:true,
    }));
    await writeFile(path.join(artifacts,"measurements.json"),JSON.stringify(result,null,2));
    assert.deepEqual(result.failures,[]);assert.equal(result.evidence.length,400);
  } finally {await rm(directory,{recursive:true,force:true});}
});
