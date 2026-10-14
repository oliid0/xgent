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
import { connectorIcons } from "../helpers/connector-icons.mjs";

test("real Home settings fits narrow screens, enlarged text, both locales and actual state layouts", {
  skip: annotationBrowser ? false : "Chromium is required for layout evidence",
}, async () => {
  const vendor = {};
  for (const name of ["Banner", "Button", "Layout", "List", "Section", "Text", "theme"])
    vendor[`@astryxdesign/core/${name}`] = await import(`@astryxdesign/core/${name}`);
  vendor["@astryxdesign/theme-neutral"] = await import("@astryxdesign/theme-neutral");
  const { translations } = createTsModuleLoader().loadModule("src/i18n/config.ts");
  const Context = React.createContext("en-US");
  const loader = createTsModuleLoader({ mocks: { ...vendor, react: React, "react/jsx-runtime": jsx, "../../components/icons": connectorIcons,
    "../../i18n": { useLocale: () => { const locale = React.useContext(Context); return { locale, t: key => { assert.ok(key in translations[locale], key); return translations[locale][key]; } }; } },
  } });
  const { MobileHomeSection } = loader.loadModule("src/pages/settings/MobileHomeSection.tsx");
  const { xgentCompactTheme } = loader.loadModule("src/theme/xgentTheme.ts");
  const { Theme, generateThemeCSS } = vendor["@astryxdesign/core/theme"];
  const themeCss = generateThemeCSS(xgentCompactTheme);
  const css = readFileSync(new URL("../../src/index.css", import.meta.url), "utf8").replace(/^@import .*;$/gm, "");
  const vendorCss = readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css", import.meta.url), "utf8");
  const reset = readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")), "utf8");
  const id = "11111111-1111-4111-8111-111111111111", fixtures = [];
  for (const width of [240, 320]) for (const scale of [1, 1.5]) for (const locale of ["en-US", "zh-CN"]) for (const state of ["ready", "power-busy", "unreachable", "busy", "empty", "error"]) {
    const home = { busy: ["busy","power-busy"].includes(state), error: state === "error" ? "HomeKit authorization or initial data loading timed out; retry explicitly" : "", refresh() {},
      setPower() {}, powerBusy:state === "power-busy", powerActionId:state === "power-busy" ? "home-power:33333333-3333-4333-8333-333333333333:on" : "",
      data: ["ready","power-busy","unreachable","empty"].includes(state) ? { source: "homekit", observedAtMs: 1234, truncated: state === "ready", records: state === "empty" ? [] : [
        { kind: "home", id, homeId: id, name: "An unusually long home name with 连续家庭名称测试".repeat(4) },
        { kind: "accessory", id: "22222222-2222-4222-8222-222222222222", homeId: id, name: "Living room light", reachable: state !== "unreachable", powerControls:[
          {id:"33333333-3333-4333-8333-333333333333", serviceId:"44444444-4444-4444-8444-444444444444",name:"Light"},
        ] },
      ] } : null };
    fixtures.push(React.createElement(Context.Provider, { key: `${width}-${scale}-${locale}-${state}`, value: locale }, React.createElement("section", {
      className: "fixture", "data-width": width, "data-scale": scale, "data-locale": locale, "data-state": state,
      style: { width, fontSize: `${15 * scale}px`, "--text-label-size": `${15 * scale}px` },
    }, React.createElement(MobileHomeSection, { home, disabled: false }))));
  }
  const markup = renderToStaticMarkup(React.createElement(Theme, { theme: xgentCompactTheme }, ...fixtures));
  const html = `<!doctype html><html data-theme="light" data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><style>${reset}\n${vendorCss}\n${css}\n@layer reset {${themeCss.prose}} @layer astryx-theme {${themeCss.component}}\nbody{margin:0}.fixture{margin:8px;box-sizing:border-box}</style>${markup}<pre id="result"></pre><script>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const failures=[],evidence=[];
    for(const section of document.querySelectorAll('.fixture')) {
      const bounds=section.getBoundingClientRect(), button=section.querySelector('button'), box=button.getBoundingClientRect();
      if(section.scrollWidth>Math.ceil(bounds.width)+1) failures.push('Overflow '+JSON.stringify(section.dataset));
      if(box.left<bounds.left-1||box.right>bounds.right+1) failures.push('Clipped button '+JSON.stringify(section.dataset));
      if(box.width<44||box.height<43.9) failures.push('Small target');
      if(!button.textContent.trim()&&!button.getAttribute('aria-label')) failures.push('Unlabelled button');
      for(const action of [...section.querySelectorAll('button')].slice(1)) {
        const a=action.getBoundingClientRect();
        if(a.left<bounds.left-1||a.right>bounds.right+1||a.width<44||a.height<43.9) failures.push('Invalid power target '+JSON.stringify({...section.dataset,x:a.left,right:a.right,width:a.width,height:a.height}));
        if(!action.getAttribute('aria-label')) failures.push('Unlabelled power target');
        if(['power-busy','unreachable'].includes(section.dataset.state)&&!action.disabled) failures.push('Active unavailable power target');
      }
      evidence.push({...section.dataset,width:bounds.width,scrollWidth:section.scrollWidth,buttonWidth:box.width,buttonHeight:box.height,disabled:button.disabled});
    }
    document.getElementById('result').textContent=JSON.stringify({failures,evidence});
  }));</script></html>`;
  const directory = await mkdtemp(path.join(tmpdir(), "xgent-home-layout-"));
  const artifacts = path.resolve("../../.ci-artifacts/autonomy-home-layout");
  try {
    await mkdir(artifacts, { recursive: true }); const file = path.join(directory, "home.html"); await writeFile(file, html);
    const result = JSON.parse(await imageBrowserCompletion(annotationBrowser, pathToFileURL(file).href, directory, {
      screenshotPath: path.join(artifacts, "home.png"), screenshotSelector: '.fixture[data-width="320"][data-scale="1.5"][data-locale="zh-CN"][data-state="ready"]', isolateScreenshot: true,
    }));
    await writeFile(path.join(artifacts, "measurements.json"), JSON.stringify(result, null, 2));
    assert.deepEqual(result.failures, []); assert.equal(result.evidence.length, 48);
    assert.ok(result.evidence.filter(e => e.state === "busy").every(e => e.disabled));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
