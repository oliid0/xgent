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

test("actual proactive form and receipts fit narrow screens, enlarged text and both locales", {
  skip: annotationBrowser ? false : "Chromium is required for layout evidence",
}, async () => {
  const vendor = {};
  for (const name of ["Banner", "Button", "Layout", "Selector", "Switch", "Text", "TextInput", "theme"])
    vendor[`@astryxdesign/core/${name}`] = await import(`@astryxdesign/core/${name}`);
  vendor["@astryxdesign/theme-neutral"] = await import("@astryxdesign/theme-neutral");
  const { translations } = createTsModuleLoader().loadModule("src/i18n/config.ts");
  const Context = React.createContext("en-US");
  const HealthMode = React.createContext(false);
  const loader = createTsModuleLoader({ mocks: { ...vendor, react: {...React,useState:initial=>{
    const health=React.useContext(HealthMode);return React.useState(health && initial==="run_succeeded"?"health_updated":initial);
  }}, "react/jsx-runtime": jsx,
    "../../i18n": { useLocale: () => { const locale = React.useContext(Context); return { t: key => translations[locale][key] ?? key }; } },
    "../../lib/automation/useProactiveRules": { useProactiveRules: () => undefined },
    "../../runtime/applePresentation": { isApplePresentationRuntime: () => false },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
    "../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../presentation/NativeSurface": { NativeSurface: () => null },
    "../../presentation/NativeSettingsContent": { NativeSettingsContent: () => null },
  } });
  const { ProactiveRulesContent } = loader.loadModule("src/pages/settings/ProactiveRulesSection.tsx");
  const { xgentCompactTheme } = loader.loadModule("src/theme/xgentTheme.ts");
  const { Theme, generateThemeCSS } = vendor["@astryxdesign/core/theme"];
  const themeCss = generateThemeCSS(xgentCompactTheme);
  const css = readFileSync(new URL("../../src/index.css", import.meta.url), "utf8").replace(/^@import .*;$/gm, "");
  const vendorCss = readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css", import.meta.url), "utf8");
  const reset = readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")), "utf8");
  const id = "11111111-1111-4111-8111-111111111111", fixtures = [];
  for (const width of [240, 320]) for (const scale of [1, 1.5]) for (const locale of ["en-US", "zh-CN"]) for (const state of ["ready", "busy", "empty", "error", "health", "remote"]) {
    const rules = { busy: state === "busy", error: state === "error" ? "The execution device is offline; reconnect and explicitly refresh the current owner" : null, ownerChanged: false, refresh() {}, apply() {},
      snapshot: state === "error" ? null : { revision: 0, hostId: id, hostTime: "2026-10-10T10:00:00-07:00", targets: [{ id, name: "Actual follow-up task", type: "prompt", enabled: true }],
        healthEventMetrics: state==="health"?["heart_rate","weight"]:[],
        executionPeers: state==="remote"?[{peerId:"22222222-2222-4222-8222-222222222222",online:true,
          host:{hostId:"22222222-2222-4222-8222-222222222222",platform:"macos",executorReady:true,
            acceptsBackgroundTasks:true,workspaceAvailable:true,inputSnapshotVersion:1,sourceContextVersion:1,workdir:"/actual/workspace",
            providers:[{id:"original-provider",name:"Actual provider",models:["actual-model"]}]}}]:[],
        rules: state === "empty" ? [] : [{ id, enabled: false, config: { name: "An unusually long rule name with 连续规则名称测试".repeat(3), targetTaskId: id, sourceTaskId: null, eventKind: "run_succeeded", cooldownMinutes: 5, maxAgeMinutes: 60, quietStart: 1320, quietEnd: 420 }, lastQueuedAt: null, lastError: "target_changed" }],
        deliveries: state === "empty" ? [] : [{ ruleId: id, eventSequence: 1, state: "queued", runState: state==="remote"?null:"pending", runSuccess: false, reason: state==="remote"?"delivery_pending":"accepted", sourceTaskId: id, sourceExecutionId: id, executionId: id, updatedAt: 1234,
          ...(state==="remote"?{remoteRequestId:id,deliveryError:"Original paired execution device remains offline; original task is retained for delivery."}:{}) }],
      } };
    fixtures.push(React.createElement(Context.Provider, { key: `${width}-${scale}-${locale}-${state}`, value: locale }, React.createElement(HealthMode.Provider,{value:state==="health"},React.createElement("section", {
      className: "fixture", "data-width": width, "data-scale": scale, "data-locale": locale, "data-state": state,
      style: { width, fontSize: `${15 * scale}px`, "--text-label-size": `${15 * scale}px` },
    }, React.createElement(ProactiveRulesContent, { rules, settings: { theme: "light" }, onBack() {} })))));
  }
  const markup = renderToStaticMarkup(React.createElement(Theme, { theme: xgentCompactTheme }, ...fixtures));
  const html = `<!doctype html><html data-theme="light" data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><style>${reset}\n${vendorCss}\n${css}\n@layer reset {${themeCss.prose}} @layer astryx-theme {${themeCss.component}}\nbody{margin:0}.fixture{margin:8px;box-sizing:border-box}</style>${markup}<pre id="result"></pre><script>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const failures=[],evidence=[];
    for(const section of document.querySelectorAll('.fixture')) {
      const bounds=section.getBoundingClientRect();
      if(section.scrollWidth>Math.ceil(bounds.width)+1) failures.push('Overflow '+JSON.stringify(section.dataset));
      for(const button of section.querySelectorAll('button')) {
        const box=button.getBoundingClientRect();
        if(box.left<bounds.left-1||box.right>bounds.right+1) failures.push('Clipped control '+JSON.stringify(section.dataset));
        if(!button.textContent.trim()&&!button.getAttribute('aria-label')) failures.push('Unlabelled control');
      }
      const button=section.querySelector('button'),box=button.getBoundingClientRect();
      if(box.width<44||box.height<43.9) failures.push('Small refresh target');
      evidence.push({...section.dataset,width:bounds.width,scrollWidth:section.scrollWidth,buttonWidth:box.width,buttonHeight:box.height,disabled:button.disabled});
    }
    document.getElementById('result').textContent=JSON.stringify({failures,evidence});
  }));</script></html>`;
  const directory = await mkdtemp(path.join(tmpdir(), "xgent-proactive-layout-"));
  const artifacts = path.resolve("../../.ci-artifacts/autonomy-proactive-layout");
  try {
    await mkdir(artifacts, { recursive: true }); const file = path.join(directory, "rules.html"); await writeFile(file, html);
    const result = JSON.parse(await imageBrowserCompletion(annotationBrowser, pathToFileURL(file).href, directory, {
      screenshotPath: path.join(artifacts, "health-rule.png"), screenshotSelector: '.fixture[data-width="320"][data-scale="1.5"][data-locale="zh-CN"][data-state="health"]', isolateScreenshot: true,
    }));
    await writeFile(path.join(artifacts, "measurements.json"), JSON.stringify(result, null, 2));
    assert.deepEqual(result.failures, []); assert.equal(result.evidence.length, 48);
    assert.ok(result.evidence.filter(e => e.state === "busy").every(e => e.disabled));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
