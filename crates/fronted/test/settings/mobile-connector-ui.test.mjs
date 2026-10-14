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

const modules={Banner:["Banner"],Button:["Button"],IconButton:["IconButton"],Layout:["HStack","StackItem","VStack"],List:["List","ListItem"],Section:["Section"],SegmentedControl:["SegmentedControl","SegmentedControlItem"],Selector:["Selector"],Spinner:["Spinner"],StatusDot:["StatusDot"],Text:["Heading","Text"],TextInput:["TextInput"]};
const glyphs=JSON.parse(readFileSync(new URL("../../node_modules/@iconify-json/lucide/icons.json",import.meta.url),"utf8"));
const icons=Object.fromEntries(Object.entries({Activity:"activity",Camera:"camera",Check:"check",Calendar:"calendar",ChevronRight:"chevron-right",ContactRound:"contact-round",Cloud:"cloud",ImageIcon:"image",House:"house",Heart:"heart",ListChecks:"list-checks",Mic:"mic",RefreshCw:"refresh-cw",Shield:"shield",WifiOff:"wifi-off"}).map(([key,name])=>[key,()=>React.createElement("svg",{width:24,height:24,viewBox:"0 0 24 24","aria-hidden":true,dangerouslySetInnerHTML:{__html:glyphs.icons[name].body}})]));
const status={available:true,backend:"ios-native",healthAvailable:true,homeAvailable:false,permissionAliases:{calendar:"events-account",contacts:"address-book",reminders:"reminder-lists",health:"health-data"}};
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==="object"&&tree.props?[tree,...nodes(tree.props.children),...nodes(tree.props.endContent)]:[];
function sharedMocks() {return {"../../components/icons":icons,"../../lib/connectors/useMobileContacts":{useMobileContacts:()=>({query:"",busy:false,setQuery(){},search(){}})},"../../lib/connectors/useMobileHome":{useMobileHome:()=>({busy:false})},"./MobileScheduleSection":{MobileScheduleSection:()=>null},"./MobileHomeSection":{MobileHomeSection:()=>null}};}

test("connector rows request actual native aliases, retain denied scopes, filter and edit shared policies",async t=>{
  const hooks=createReactHookHarness(), calls=[];
  const oldWindow=globalThis.window,oldDocument=globalThis.document;
  globalThis.window=new EventTarget();globalThis.document=Object.assign(new EventTarget(),{visibilityState:"visible"});
  t.after(()=>{hooks.unmount();globalThis.window=oldWindow;globalThis.document=oldDocument;});
  const real=createTsModuleLoader().loadModule("src/lib/mobileAssistant.ts");
  const loader=createTsModuleLoader({mocks:{...sharedMocks(),react:{...hooks.react,Fragment:"Fragment"},"../../i18n":{useLocale:()=>({t:key=>key})},
    ...Object.fromEntries(Object.entries(modules).map(([name,exports])=>[`@astryxdesign/core/${name}`,Object.fromEntries(exports.map(key=>[key,key]))])),
    "../../lib/mobileAssistant":{...real,mobileAssistantStatus:async()=>status,checkMobileAssistantPermissions:async()=>({"events-account":"prompt","address-book":"granted","health-data":"requested"}),
      requestMobileAssistantPermission:async(alias)=>{calls.push(alias);return {"events-account":"granted","address-book":"granted","health-data":"requested"};},openMobileSystemSettings:async()=>calls.push("settings")},
  }});
  const {MobileAssistantSection}=loader.loadModule("src/pages/settings/MobileAssistantSection.tsx");
  const {getDefaultSettings}=loader.loadModule("src/lib/settings/index.ts");let settings=getDefaultSettings();
  settings.system.toolPolicies={"personal:contacts":"deny"};
  const render=()=>hooks.render(()=>MobileAssistantSection({settings,setSettings:update=>{settings=update(settings);}}));
  const catalog=()=>nodes(render()).filter(node=>node.type==="Section")[1];
  render();await tick();
  let rows=nodes(catalog()).filter(node=>node.type==="ListItem");
  assert.deepEqual(rows.map(row=>row.props.label),["settings.mobileAssistant.calendar","settings.mobileAssistant.reminders","settings.mobileAssistant.health","settings.mobileAssistant.home"]);
  assert.equal(nodes(rows.at(-1)).some(node=>node.type==="Button"),false,"unsupported Home has no fake Connect action");
  await rows[0].props.endContent.props.onClick();await tick();assert.deepEqual(calls,["events-account"]);
  rows=nodes(catalog()).filter(node=>node.type==="ListItem");
  await rows.find(row=>row.props.label==="settings.mobileAssistant.health").props.endContent.props.onClick();await tick();assert.deepEqual(calls,["events-account","settings"]);
  nodes(catalog()).find(node=>node.type==="SegmentedControl").props.onChange("connected");
  rows=nodes(catalog()).filter(node=>node.type==="ListItem");
  assert.deepEqual(rows.map(row=>row.props.label),["settings.mobileAssistant.calendar","settings.mobileAssistant.contacts"]);
  rows[1].props.onClick();let policy=nodes(catalog()).find(node=>node.type==="Selector");assert.equal(policy.props.value,"deny");
  policy.props.onChange("ask");assert.equal(settings.system.toolPolicies["personal:contacts"],"ask");
  nodes(catalog()).find(node=>node.type==="TextInput").props.onChange("no match");
  assert.equal(nodes(catalog()).filter(node=>node.type==="ListItem").length,0);
  assert.ok(nodes(catalog()).some(node=>node.props.children==="settings.connectors.empty"));
});

test("installed Astryx connector component stays concise and fits phone widths in both locales",{skip:annotationBrowser?false:"Chromium required"},async()=>{
  const vendor={};for(const name of [...Object.keys(modules),"theme"])vendor[`@astryxdesign/core/${name}`]=await import(`@astryxdesign/core/${name}`);
  const base=createTsModuleLoader();const {translations}=base.loadModule("src/i18n/config.ts"),{xgentCompactTheme}=base.loadModule("src/theme/xgentTheme.ts"),{getDefaultSettings}=base.loadModule("src/lib/settings/index.ts");
  const fixtures=[];
  for(const width of [320,390])for(const scale of [1,1.5])for(const locale of ["zh-CN","en-US"])for(const tab of ["available","connected"]){
    const loader=createTsModuleLoader({mocks:{...vendor,...sharedMocks(),react:{...React,useState:initial=>[initial==="available"?tab:initial,()=>{}]},"react/jsx-runtime":jsx,"../../i18n":{useLocale:()=>({t:key=>translations[locale][key]??key})},
      "./useMobileAssistantAccess":{useMobileAssistantAccess:()=>({status,permissions:{calendar:"prompt",contacts:"granted",reminders:"prompt",health:"requested"},busy:"",error:"",request(){},refresh(){}})}}});
    const {MobileAssistantSection}=loader.loadModule("src/pages/settings/MobileAssistantSection.tsx");
    fixtures.push(React.createElement("section",{className:"fixture",key:`${width}-${scale}-${locale}-${tab}`,"data-width":width,"data-scale":scale,"data-locale":locale,"data-tab":tab,style:{width,"--text-label-size":`${15*scale}px`}},React.createElement(MobileAssistantSection,{settings:getDefaultSettings(),setSettings(){}})));
  }
  const {Theme,generateThemeCSS}=vendor["@astryxdesign/core/theme"],css=generateThemeCSS(xgentCompactTheme);
  const appCss=readFileSync(new URL("../../src/index.css",import.meta.url),"utf8").replace(/^@import .*;$/gm,"");
  const vendorCss=readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css",import.meta.url),"utf8"),reset=readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")),"utf8");
  const markup=renderToStaticMarkup(React.createElement(Theme,{theme:xgentCompactTheme},...fixtures));
  const directory=await mkdtemp(path.join(tmpdir(),"xgent-connectors-")),artifacts=path.resolve("../../.ci-artifacts/autonomy-connectors-layout");
  try{
    await mkdir(artifacts,{recursive:true});const file=path.join(directory,"connectors.html");
    await writeFile(file,`<!doctype html><html data-theme="light" data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><style>${reset}\n${vendorCss}\n${appCss}\n@layer reset{${css.prose}}@layer astryx-theme{${css.component}}.fixture{margin:16px}.fixture *{box-sizing:border-box}#result{display:none}</style>${markup}<pre id="result"></pre><script>requestAnimationFrame(()=>requestAnimationFrame(()=>{const failures=[];for(const section of document.querySelectorAll('.fixture')){const r=section.getBoundingClientRect();if(section.scrollWidth>section.clientWidth+1)failures.push('Overflow '+JSON.stringify(section.dataset));for(const c of section.querySelectorAll('button,input')){const b=c.getBoundingClientRect();if(!b.height)continue;if(b.left<r.left-1||b.right>r.right+1)failures.push('Clipped '+JSON.stringify(section.dataset));if(b.height<43.9)failures.push('Small target '+JSON.stringify(section.dataset));}if(/Description|description|Scope|scope/.test(section.textContent))failures.push('Explanatory text');}document.getElementById('result').textContent=JSON.stringify({failures,fixtures:document.querySelectorAll('.fixture').length});}));</script></html>`);
    await writeFile(path.join(artifacts,"connectors.html"),readFileSync(file));
    const result=JSON.parse(await imageBrowserCompletion(annotationBrowser,pathToFileURL(file).href,directory,{screenshotPath:path.join(artifacts,"available.png"),screenshotSelector:'.fixture[data-width="390"][data-scale="1"][data-locale="zh-CN"][data-tab="available"] .connector-catalog',isolateScreenshot:true}));
    await writeFile(path.join(artifacts,"measurements.json"),JSON.stringify(result,null,2));assert.deepEqual(result.failures,[]);assert.equal(result.fixtures,16);
  }finally{await rm(directory,{recursive:true,force:true});}
});
