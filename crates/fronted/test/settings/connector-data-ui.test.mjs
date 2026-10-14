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
import { connectorIcons } from "../helpers/connector-icons.mjs";
import { annotationBrowser } from "../helpers/document-annotation-browser.mjs";
import { imageBrowserCompletion } from "../helpers/image-browser-completion.mjs";

const loader = createTsModuleLoader();
const { mobileContactRows, mobileScheduleRows, connectorObservationTime } = loader.loadModule("src/lib/connectors/connectorDataView.ts");
const { mobileHomeRows } = loader.loadModule("src/lib/connectors/mobileHomeView.ts");
const { translations } = loader.loadModule("src/i18n/config.ts");
const translate = locale => key => { assert.ok(key in translations[locale], key); return translations[locale][key]; };
const homeId = "11111111-1111-4111-8111-111111111111";
const home = { source:"homekit", observedAtMs:1791664740000, truncated:false, records:[
  { kind:"home", id:homeId, homeId, name:"我的家" },
  { kind:"room", id:"room-key", homeId, name:"客厅" },
  { kind:"accessory", id:"light-key", homeId, roomId:"room-key", name:"落地灯", reachable:false },
  { kind:"scene", id:"scene-key", homeId, name:"晚安" },
] };
const contacts = { accessLimited:false, truncated:false, contacts:[
  { id:"private-contact-id", name:"林晓", phones:["+86 138 0000 0000"], emails:["lin@example.test"] },
  { id:"private-unnamed-id", name:"", phones:[], emails:[] },
] };
const records = [{ id:"private-event-id", title:"产品汇报", time:1791664740000, source:"工作日历" }, { id:"private-reminder-id", title:"健身", time:null, source:"提醒事项" }];

test("device record display preserves identities while hiding unnamed IDs, separating Home namespaces and using app locale", () => {
  const t = translate("zh-CN");
  const people = mobileContactRows(contacts,t);
  assert.equal(people[1].id,contacts.contacts[1].id);
  assert.equal(people[1].label,"未命名联系人");
  assert.equal(people[0].description,"+86 138 0000 0000 · lin@example.test");
  const collision = { ...home, records:[...home.records,{ kind:"room",id:homeId,homeId,name:"同 ID 房间" }] };
  const light = mobileHomeRows(collision,t).find(row=>row.id==="accessory:light-key");
  assert.match(light.description,/我的家.*客厅.*不可达/);
  const unnamed = mobileHomeRows({ ...home, records:[{ ...home.records[0], name:"" }] },t)[0];
  assert.equal(unnamed.id,`home:${homeId}`); assert.equal(unnamed.label,"家庭"); assert.ok(!unnamed.description.includes(homeId));
  const schedule = mobileScheduleRows(records,"reminder",t,"zh-CN");
  assert.equal(schedule[0].id,"private-event-id:0"); assert.equal(schedule[0].icon,"reminders");
  assert.equal(schedule[1].description,"提醒事项"); assert.match(schedule[0].description,/年/);
  assert.notEqual(connectorObservationTime(records[0].time,"zh-CN"),connectorObservationTime(records[0].time,"en-US"));
  assert.equal(connectorObservationTime(NaN,"en-US"),"—");
});

test("SwiftUI documents and installed Astryx lists render identical observed names and metadata without dead controls", async () => {
  const vendor = { react:React,"react/jsx-runtime":jsx,"../../components/icons":connectorIcons };
  for (const name of ["List","Text","Button","Layout"]) vendor[`@astryxdesign/core/${name}`] = await import(`@astryxdesign/core/${name}`);
  const { ConnectorDataList } = createTsModuleLoader({ mocks:vendor }).loadModule("src/pages/settings/ConnectorDataList.tsx");
  const { connectorDataNodes } = loader.loadModule("src/presentation/connectorDataNodes.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  for (const locale of ["zh-CN","en-US"]) {
    const t=translate(locale), rows=[...mobileContactRows(contacts,t),...mobileScheduleRows(records,"event",t,locale),...mobileHomeRows(home,t)];
    const nodes=connectorDataNodes("observed-data",rows);
    validatePresentationDocument({ version:1,surface:"device-data",revision:1,mode:"sheet",title:"Device",nodes:[nodes] },new Map());
    const markup=renderToStaticMarkup(React.createElement(ConnectorDataList,{rows}));
    for (let i=0;i<rows.length;i++) {
      assert.equal(nodes.children[i].label,rows[i].label); assert.equal(nodes.children[i].text,rows[i].description);
      assert.ok(markup.includes(rows[i].label)); assert.equal(nodes.children[i].action,undefined);
    }
    assert.ok(!/<button|<a\b|role="button"/.test(markup)); assert.ok(!markup.includes("private-contact-id")); assert.ok(!markup.includes(homeId));
    assert.equal((markup.match(/connector-data-row/g)??[]).length,rows.length);
  }
});

test("actual connector data rows fit small screens, large text and both appearances, with updated review image", { skip:annotationBrowser?false:"Chromium required" }, async () => {
  const vendor = { react:React,"react/jsx-runtime":jsx,"../../components/icons":connectorIcons };
  for (const name of ["List","Text","Button","Layout","theme"]) vendor[`@astryxdesign/core/${name}`] = await import(`@astryxdesign/core/${name}`);
  const uiLoader=createTsModuleLoader({ mocks:vendor }),{ ConnectorDataList }=uiLoader.loadModule("src/pages/settings/ConnectorDataList.tsx");
  const { xgentCompactTheme }=uiLoader.loadModule("src/theme/xgentTheme.ts"),{ Theme,generateThemeCSS }=vendor["@astryxdesign/core/theme"];
  const theme=generateThemeCSS(xgentCompactTheme),css=readFileSync(new URL("../../src/index.css",import.meta.url),"utf8").replace(/^@import .*;$/gm,"");
  const core=readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css",import.meta.url),"utf8"),reset=readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")),"utf8");
  const fixtures=[];
  for (const width of [240,320,390,768]) for (const scale of [1,1.5]) for (const locale of ["zh-CN","en-US"]) for (const appearance of ["light","dark"]) {
    const t=translate(locale), groups=[
      [t("settings.connectors.contactResults"),mobileContactRows(contacts,t)],
      [t("settings.connectors.scheduleRecords"),mobileScheduleRows(records,"reminder",t,locale)],
      [t("settings.mobileAssistant.home"),mobileHomeRows(home,t)],
    ];
    fixtures.push(React.createElement("section",{ key:`${width}-${scale}-${locale}-${appearance}`,className:"fixture","data-width":width,"data-scale":scale,"data-locale":locale,"data-appearance":appearance,style:{width,fontSize:`${15*scale}px`,"--text-label-size":`${15*scale}px`,"--text-supporting-size":`${13*scale}px`,colorScheme:appearance} },
      React.createElement("div",{className:"review"},...groups.map(([title,rows])=>React.createElement(React.Fragment,{key:title},React.createElement("h3",null,title),React.createElement(ConnectorDataList,{rows})))),
      React.createElement(ConnectorDataList,{rows:[{id:"long",label:"Long continuous record 连续名称".repeat(6),description:"email.with.a.long.name@example.test ".repeat(5),icon:"contacts"}]})));
  }
  const markup=renderToStaticMarkup(React.createElement(Theme,{theme:xgentCompactTheme},...fixtures));
  const html=`<!doctype html><html data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><style>${reset}\n${core}\n${css}\n@layer reset{${theme.prose}} @layer astryx-theme{${theme.component}} body{margin:0}.fixture{margin:8px;padding:16px;box-sizing:border-box;background:var(--color-background);color:var(--color-text)}h3{font-size:1.1333em;font-weight:600;margin:24px 0 12px}#result{display:none}</style>${markup}<pre id="result"></pre><script>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const failures=[];for(const fixture of document.querySelectorAll('.fixture')){
      const bounds=fixture.getBoundingClientRect();if(fixture.scrollWidth>Math.ceil(bounds.width)+1)failures.push('overflow '+JSON.stringify(fixture.dataset));
      for(const row of fixture.querySelectorAll('.connector-data-row')){const box=row.getBoundingClientRect();if(box.height<69.9||box.left<bounds.left-1||box.right>bounds.right+1)failures.push('row bounds');if(row.scrollWidth>Math.ceil(box.width)+1)failures.push('row overflow');if(row.querySelector('button,a'))failures.push('dead action');}
    }document.getElementById('result').textContent=JSON.stringify({failures,fixtures:document.querySelectorAll('.fixture').length});}));</script></html>`;
  const directory=await mkdtemp(path.join(tmpdir(),"xgent-connector-data-")),artifacts=path.resolve("../../.ci-artifacts/autonomy-connector-data-layout");
  try {
    await mkdir(artifacts,{recursive:true});const file=path.join(directory,"review.html");await writeFile(file,html);await writeFile(path.join(artifacts,"review.html"),html);
    const result=JSON.parse(await imageBrowserCompletion(annotationBrowser,pathToFileURL(file).href,directory,{ screenshotPath:path.join(artifacts,"review.png"),screenshotSelector:'.fixture[data-width="390"][data-scale="1"][data-locale="zh-CN"][data-appearance="light"] .review',isolateScreenshot:true }));
    await writeFile(path.join(artifacts,"measurements.json"),JSON.stringify(result,null,2));assert.deepEqual(result.failures,[]);assert.equal(result.fixtures,32);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
