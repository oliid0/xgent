import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {mkdir,mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import React from "react";
import * as jsx from "react/jsx-runtime";
import {renderToStaticMarkup} from "react-dom/server";
import {createTsModuleLoader} from "../helpers/load-ts-module.mjs";
import {annotationBrowser} from "../helpers/document-annotation-browser.mjs";
import {imageBrowserCompletion} from "../helpers/image-browser-completion.mjs";

test("real account controls fit mobile/desktop widths and scaled bilingual permission data",{skip:annotationBrowser?false:"Chromium required"},async()=>{
  const vendor={};for(const name of ["Banner","Button","Layout","List","Selector","StatusDot","Switch","Text","TextInput","Token","theme"])
    vendor[`@astryxdesign/core/${name}`]=await import(`@astryxdesign/core/${name}`);
  const Locale=React.createContext("en-US"),State=React.createContext("pending");
  const {translations}=createTsModuleLoader().loadModule("src/i18n/config.ts");
  const loader=createTsModuleLoader({mocks:{...vendor,react:React,"react/jsx-runtime":jsx,
    "../../i18n":{useLocale:()=>{const locale=React.useContext(Locale);return{t:key=>translations[locale][key]??key};}},
    "../../components/astryx/ConfirmActionPopover":{},
    "../../lib/connectors/useGitHubAuthorization":{useGitHubAuthorization:()=>{
      const state=React.useContext(State);return{status:{phase:state,account:state==="connected"?{login:"account-owner-with-a-long-name",scopes:["public_repo","read:user","workflow"]}:null,userCode:"ABCD-EFGH"},
        clientId:"registered-client-id",busy:"",error:state==="error"?"github-oauth-disabled":null,canStart:state!=="pending",setClientId(){},start(){},refresh(){},open(){},copy(){},cancel(){}};
    }},
  }});
  const {GitHubAuthorizationSection}=loader.loadModule("src/pages/settings/GitHubAuthorizationSection.tsx");
  const {xgentCompactTheme}=loader.loadModule("src/theme/xgentTheme.ts");
  const {Theme,generateThemeCSS}=vendor["@astryxdesign/core/theme"],theme=generateThemeCSS(xgentCompactTheme);
  const fixtures=[];
  for(const width of [280,960])for(const scale of [1,1.5])for(const locale of ["en-US","zh-CN"])for(const state of ["pending","connected","error"])
    fixtures.push(React.createElement(Locale.Provider,{key:`${width}-${scale}-${locale}-${state}`,value:locale},React.createElement(State.Provider,{value:state},React.createElement("section",{className:"fixture","data-width":width,"data-scale":scale,"data-locale":locale,"data-state":state,style:{width,fontSize:`${15*scale}px`,"--text-label-size":`${15*scale}px`}},React.createElement(GitHubAuthorizationSection,{enabled:true})))));
  const css=readFileSync(new URL("../../src/index.css",import.meta.url),"utf8").replace(/^@import .*;$/gm,"");
  const vendorCss=readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css",import.meta.url),"utf8"),reset=readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")),"utf8");
  const markup=renderToStaticMarkup(React.createElement(Theme,{theme:xgentCompactTheme},...fixtures));
  const html=`<!doctype html><html data-theme="light" data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><style>${reset}\n${vendorCss}\n${css}\n@layer reset{${theme.prose}}@layer astryx-theme{${theme.component}}body{margin:0}.fixture{margin:8px;box-sizing:border-box}</style>${markup}<pre id="result"></pre><script>requestAnimationFrame(()=>requestAnimationFrame(()=>{const failures=[],evidence=[];for(const section of document.querySelectorAll('.fixture')){const bounds=section.getBoundingClientRect();if(section.scrollWidth>Math.ceil(bounds.width)+1)failures.push('Overflow '+JSON.stringify(section.dataset));for(const control of section.querySelectorAll('button,input')){const box=control.getBoundingClientRect();if(box.left<bounds.left-1||box.right>bounds.right+1)failures.push('Clipped control '+JSON.stringify(section.dataset));if(control.tagName==='BUTTON'&&box.height<43)failures.push('Small action '+JSON.stringify(section.dataset));}evidence.push({...section.dataset,width:bounds.width,scrollWidth:section.scrollWidth});}document.getElementById('result').textContent=JSON.stringify({failures,evidence});}));</script></html>`;
  const directory=await mkdtemp(path.join(tmpdir(),"xgent-github-account-")),artifacts=path.resolve("../../.ci-artifacts/autonomy-github-authorization-layout");
  try{await mkdir(artifacts,{recursive:true});const file=path.join(directory,"account.html");await writeFile(file,html);
    const result=JSON.parse(await imageBrowserCompletion(annotationBrowser,pathToFileURL(file).href,directory,{screenshotPath:path.join(artifacts,"review.png"),screenshotSelector:'.fixture[data-width="280"][data-scale="1.5"][data-locale="zh-CN"][data-state="pending"]',isolateScreenshot:true}));
    await writeFile(path.join(artifacts,"measurements.json"),JSON.stringify(result,null,2));assert.deepEqual(result.failures,[]);assert.equal(result.evidence.length,24);
  }finally{await rm(directory,{recursive:true,force:true});}
});
