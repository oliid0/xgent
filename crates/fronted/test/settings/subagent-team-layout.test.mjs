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

test("actual team form/list/error controls fit narrow screens, enlarged text and both locales", { skip: annotationBrowser ? false : "Chromium required" }, async () => {
  const vendor = {};
  for (const name of ["Button", "Layout", "List", "Selector", "Switch", "Text", "TextArea", "TextInput", "theme"]) vendor[`@astryxdesign/core/${name}`] = await import(`@astryxdesign/core/${name}`);
  const Context = React.createContext("en-US");
  const { translations } = createTsModuleLoader().loadModule("src/i18n/config.ts");
  const loader = createTsModuleLoader({ mocks: { ...vendor, react: React, "react/jsx-runtime": jsx,
    "../../i18n": { useLocale: () => { const locale = React.useContext(Context); return { t: k => translations[locale][k] ?? k }; } },
  } });
  const { SubagentTeamContent } = loader.loadModule("src/pages/settings/SubagentTeamSettings.tsx");
  const { SchedulingBudgetContent } = loader.loadModule("src/pages/settings/SchedulingBudgetSettings.tsx");
  const { xgentCompactTheme } = loader.loadModule("src/theme/xgentTheme.ts");
  const { Theme, generateThemeCSS } = vendor["@astryxdesign/core/theme"];
  const theme = generateThemeCSS(xgentCompactTheme);
  const css = readFileSync(new URL("../../src/index.css", import.meta.url), "utf8").replace(/^@import .*;$/gm, "");
  const vendorCss = readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css", import.meta.url), "utf8");
  const reset = readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")), "utf8");
  const fixtures = [];
  for (const width of [240, 320]) for (const scale of [1, 1.5]) for (const locale of ["en-US", "zh-CN"]) for (const state of ["empty", "list", "edit", "error"]) {
    const template = { id: "coder", name: "Coder and document reviewer with a long descriptive name", description: "Inspect documents, implement code and verify every requested artifact", prompt: "Inspect the repository, deliver usable files, report verified evidence", enabled: true, modelValue: "provider-account-with-a-long-identifier::shared-model", requiredSkills: ["coding", "research"] };
    const editor = { team: state === "empty" ? [] : [template], draft: state === "edit" || state === "error" ? { template, original: template, skills: "coding, research" } : null,
      options: [{ value: template.modelValue, label: "Same display name / shared-model (provider-account-with-a-long-identifier)" }], error: state === "error" ? "subagentTeam.unavailable" : null,
      open() {}, patch() {}, cancel() {}, save() {}, remove() {}, scope: "fixture" };
    fixtures.push(React.createElement(Context.Provider, { key: `${width}-${scale}-${locale}-${state}`, value: locale }, React.createElement("section", { className: "fixture", "data-width": width, "data-scale": scale, "data-locale": locale, "data-state": state, style: { width, fontSize: `${15 * scale}px`, "--text-label-size": `${15 * scale}px` } }, React.createElement(SubagentTeamContent, { editor }))));
  }
  for (const width of [240,320]) for (const scale of [1,1.5]) for (const locale of ["en-US","zh-CN"]) for (const state of ["budget-list","budget-edit","budget-error"]) {
    const editor={config:{maxModelRequests:128,maxToolCalls:256,lifetimeMinutes:90},draft:state==="budget-list"?null:{requests:"128",tools:"256",minutes:"90"},error:state==="budget-error"?"schedulingBudget.invalid":null,open(){},patch(){},save(){},cancel(){}};
    fixtures.push(React.createElement(Context.Provider,{key:`${width}-${scale}-${locale}-${state}`,value:locale},React.createElement("section",{className:"fixture","data-width":width,"data-scale":scale,"data-locale":locale,"data-state":state,style:{width,fontSize:`${15*scale}px`,"--text-label-size":`${15*scale}px`}},React.createElement(SchedulingBudgetContent,{editor}))));
  }
  const markup = renderToStaticMarkup(React.createElement(Theme, { theme: xgentCompactTheme }, ...fixtures));
  const html = `<!doctype html><html data-theme="light" data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><style>${reset}\n${vendorCss}\n${css}\n@layer reset {${theme.prose}} @layer astryx-theme {${theme.component}}\nbody{margin:0}.fixture{margin:8px;box-sizing:border-box}</style>${markup}<pre id="result"></pre><script>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const failures=[],evidence=[];
    for(const section of document.querySelectorAll('.fixture')) {
      const bounds=section.getBoundingClientRect();
      if(section.scrollWidth>Math.ceil(bounds.width)+1) failures.push('Overflow '+JSON.stringify(section.dataset));
      for(const control of section.querySelectorAll('button,input,textarea')) {
        const box=control.getBoundingClientRect();
        if(box.left<bounds.left-1||box.right>bounds.right+1) failures.push('Clipped control '+JSON.stringify(section.dataset));
        if(control.tagName==='BUTTON'&&!control.textContent.trim()&&!control.getAttribute('aria-label')) failures.push('Unlabelled button');
      }
      const save=Array.from(section.querySelectorAll('button')).find(b=>b.textContent.trim()===(section.dataset.locale==='zh-CN'?'保存':'Save'));
      evidence.push({...section.dataset,width:bounds.width,scrollWidth:section.scrollWidth,saveDisabled:save?.disabled??null});
    }
    document.getElementById('result').textContent=JSON.stringify({failures,evidence});
  }));</script></html>`;
  const directory = await mkdtemp(path.join(tmpdir(), "xgent-team-layout-")), artifacts = path.resolve("../../.ci-artifacts/autonomy-scheduling-budget-layout");
  try {
    await mkdir(artifacts, { recursive: true }); const file = path.join(directory, "team.html"); await writeFile(file, html);
    const result = JSON.parse(await imageBrowserCompletion(annotationBrowser, pathToFileURL(file).href, directory, { screenshotPath: path.join(artifacts, "review.png"), screenshotSelector: '.fixture[data-width="320"][data-scale="1.5"][data-locale="zh-CN"][data-state="budget-edit"]', isolateScreenshot: true }));
    await writeFile(path.join(artifacts, "measurements.json"), JSON.stringify(result, null, 2));
    assert.deepEqual(result.failures, []); assert.equal(result.evidence.length, 56);
    assert.ok(result.evidence.filter(e => e.state === "error"||e.state==="budget-error").every(e => e.saveDisabled === true));
    assert.ok(result.evidence.filter(e => e.state === "edit"||e.state==="budget-edit").every(e => e.saveDisabled === false));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
