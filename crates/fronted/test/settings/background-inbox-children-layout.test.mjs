import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir,mkdtemp,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { annotationBrowser } from "../helpers/document-annotation-browser.mjs";
import { imageBrowserCompletion } from "../helpers/image-browser-completion.mjs";

test("actual Astryx child disclosures fit compact widths/text scales/locales using the shared native nodes",{skip:annotationBrowser?false:"Chromium required"},async()=>{
  const glyphs=JSON.parse(readFileSync(new URL("../../node_modules/@iconify-json/lucide/icons.json",import.meta.url),"utf8"));
  const icons=Object.fromEntries(Object.entries({Check:"check",Circle:"circle",MoreHorizontal:"ellipsis",RefreshCw:"refresh-cw",ChevronDown:"chevron-down",ChevronRight:"chevron-right"}).map(([name,id])=>[name,()=>React.createElement("svg",{width:24,height:24,viewBox:"0 0 24 24","aria-hidden":true,dangerouslySetInnerHTML:{__html:glyphs.icons[id].body}})]));
  const vendor={react:React,"react/jsx-runtime":jsx,"../../components/icons":icons,"@xgent/runtime":{},"../../i18n":{},"../../lib/automation/backend":{},"../../lib/automation/backgroundInboxSnapshot":{},"../../lib/automation/backgroundInboxArtifacts":{},"../../lib/automation/useInboxChildren":{},"../../lib/runtimePlatform":{},"../../runtime/applePresentation":{},"../../presentation/nativeTheme":{},"../../presentation/NativeSurface":{},"../../presentation/NativeSettingsContent":{},"./mobileBranchReviewNodes":{},"./useMobileBranchReview":{}};
  for(const name of ["Banner","Button","DropdownMenu","Icon","IconButton","Layout","List","Spinner","Text","TextInput","theme"])vendor[`@astryxdesign/core/${name}`]=await import(`@astryxdesign/core/${name}`);
  const loader=createTsModuleLoader({mocks:vendor}),{backgroundInboxNodeRenderer}=loader.loadModule("src/pages/settings/BackgroundInboxSection.tsx"),{inboxChildNodes}=loader.loadModule("src/presentation/inboxChildNodes.ts"),{presentationControls}=loader.loadModule("src/presentation/controls.ts"),{translations}=loader.loadModule("src/i18n/config.ts"),{validatePresentationDocument}=loader.loadModule("src/presentation/validateDocument.ts"),{xgentCompactTheme}=loader.loadModule("src/theme/xgentTheme.ts");
  const {Theme,generateThemeCSS}=vendor["@astryxdesign/core/theme"],theme=generateThemeCSS(xgentCompactTheme),fixtures=[],noop=()=>{};
  const child={callId:"actual",requestId:"child",peerId:"pc",accepted:true,state:"waiting",success:false,terminalConfirmed:false,cancelRequested:false,cancelAcknowledged:false,lastError:null},parent={requestId:"root",hostId:"owner",children:[child,{...child,callId:"website",name:"产品官网",state:"leased"},{...child,callId:"video",name:"宣传视频",accepted:false,state:null}]};
  for(const locale of ["zh-CN","en-US"])for(const scale of [1,1.5])for(const width of [240,390,768])for(const mode of ["list","detail","loading","error"]){
    const c=presentationControls(),t=key=>translations[locale][key]??key;
    const view={selected:mode==="list"?null:child,detail:mode==="detail"?{child,result:{name:locale==="zh-CN"?"公司资料与产品官网实施方案":"Company documents and product website implementation",run:{output:locale==="zh-CN"?"资料已整理，实施方案和汇报已生成。":"Documents reviewed; implementation plan and presentation generated."},artifacts:[{id:"file",relativePath:"产品说明书.docx",bytes:4096}]}}:null,busy:mode==="loading",error:mode==="error"?"Original execution host unavailable":"",open:noop,close:noop};
    const nodes=inboxChildNodes(c,parent,view,t,true);validatePresentationDocument({version:1,surface:"inbox",revision:1,mode:"sheet",title:t("backgroundInbox.children"),nodes},c.handlers);
    const render=backgroundInboxNodeRenderer(c);fixtures.push(React.createElement("section",{key:`${locale}:${scale}:${width}:${mode}`,className:"fixture","data-width":width,"data-scale":scale,"data-locale":locale,"data-mode":mode,style:{width,fontSize:`${15*scale}px`,"--text-label-size":`${15*scale}px`,"--text-supporting-size":`${13*scale}px`}},React.createElement(vendor["@astryxdesign/core/Layout"].VStack,{width:"100%",gap:3,className:"autonomy-settings"},...nodes.map(node=>render(node)))));
  }
  const css=readFileSync(new URL("../../src/index.css",import.meta.url),"utf8").replace(/^@import .*;$/gm,""),core=readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css",import.meta.url),"utf8"),reset=readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")),"utf8");
  const html=`<!doctype html><html data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><style>${reset}\n${core}\n${css}\n@layer reset{${theme.prose}} @layer astryx-theme{${theme.component}}body{margin:0}.fixture{box-sizing:border-box;margin:8px;padding:20px;background:var(--color-background);color:var(--color-text)}#result{display:none}</style>${renderToStaticMarkup(React.createElement(Theme,{theme:xgentCompactTheme},...fixtures))}<pre id="result"></pre><script>requestAnimationFrame(()=>requestAnimationFrame(()=>{const failures=[];for(const f of document.querySelectorAll('.fixture')){const b=f.getBoundingClientRect();if(f.scrollWidth>Math.ceil(b.width)+1)failures.push('overflow '+JSON.stringify(f.dataset));for(const action of f.querySelectorAll('button,[role="button"]')){const a=action.getBoundingClientRect();if(a.width<43.9||a.height<43.9)failures.push('target '+action.textContent);}}document.getElementById('result').textContent=JSON.stringify({failures,fixtures:document.querySelectorAll('.fixture').length});}));</script></html>`;
  const directory=await mkdtemp(path.join(tmpdir(),"xgent-child-layout-")),artifacts=path.resolve("../../.ci-artifacts/autonomy-compound-children-layout");
  try{await mkdir(artifacts,{recursive:true});const file=path.join(directory,"review.html");await writeFile(file,html);await writeFile(path.join(artifacts,"review.html"),html);const measured=JSON.parse(await imageBrowserCompletion(annotationBrowser,pathToFileURL(file).href,directory,{screenshotPath:path.join(artifacts,"review.png"),screenshotSelector:'.fixture[data-width="390"][data-scale="1"][data-locale="zh-CN"][data-mode="detail"]',isolateScreenshot:true}));await writeFile(path.join(artifacts,"measurements.json"),JSON.stringify(measured,null,2));assert.deepEqual(measured.failures,[]);assert.equal(measured.fixtures,48);}
  finally{await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
