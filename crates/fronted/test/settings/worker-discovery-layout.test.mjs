import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("actual Astryx discovery list fits compact widths/text scales/locales and actionable loading/error/empty states", { skip: annotationBrowser ? false : "Chromium is required" }, async () => {
  const vendor = {};
  for (const name of ["Banner", "Button", "Grid", "Icon", "IconButton", "Layout", "List", "Text", "TextInput", "theme"]) vendor[`@astryxdesign/core/${name}`] = await import(`@astryxdesign/core/${name}`);
  vendor["@astryxdesign/theme-neutral"] = await import("@astryxdesign/theme-neutral");
  const icons = createTsModuleLoader({ mocks: { ...vendor, react: React, "react/jsx-runtime": jsx } }).loadModule("src/components/icons.tsx");
  const { translations } = createTsModuleLoader().loadModule("src/i18n/config.ts"), Context = React.createContext("en-US");
  const loader = createTsModuleLoader({ mocks: { ...vendor, react: React, "react/jsx-runtime": jsx, "../../components/icons": icons, "../../i18n": { useLocale: () => { const locale = React.useContext(Context); return { locale, t: key => { assert.ok(key in translations[locale], key); return translations[locale][key]; } }; } } } });
  const { WorkerPeersSection } = loader.loadModule("src/pages/settings/WorkerPeersSection.tsx"), { xgentCompactTheme } = loader.loadModule("src/theme/xgentTheme.ts");
  const { Theme, generateThemeCSS } = vendor["@astryxdesign/core/theme"], theme = generateThemeCSS(xgentCompactTheme);
  const reset = readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")), "utf8"), css = readFileSync(new URL("../../src/index.css", import.meta.url), "utf8"), vendorCss = readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css", import.meta.url), "utf8");
  const fixtures = [];
  for (const width of [240, 320, 390]) for (const scale of [1, 1.5]) for (const locale of ["en-US", "zh-CN"]) for (const state of ["ready", "busy", "empty", "error"]) {
    const workers = { peers: [], busy: state === "busy" ? "discover" : "", error: state === "error" ? "Local network permission denied" : "", registrationError: "", discover() {}, refresh() {}, discoveryAttempted: state !== "busy", hasDiscoveredEndpoint: () => true,
      discovered: state === "ready" ? Array.from({ length: 5 }, (_, i) => ({ hostId: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`, platform: i < 2 ? "macos" : "windows", urls: [`http://192.168.100.${100 + i}:28367`] })) : [] };
    fixtures.push(React.createElement(Context.Provider, { key: `${width}-${scale}-${locale}-${state}`, value: locale }, React.createElement("section", { className: "fixture", "data-width": width, "data-scale": scale, "data-locale": locale, "data-state": state, style: { width, fontSize: `${15 * scale}px`, "--text-label-size": `${15 * scale}px` } }, React.createElement(WorkerPeersSection, { workers, disabled: false, selectDiscovered() {} }))));
  }
  const markup = renderToStaticMarkup(React.createElement(Theme, { theme: xgentCompactTheme }, ...fixtures));
  const html = `<!doctype html><html data-theme="light" data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><style>${reset}\n${vendorCss}\n${css}\n@layer reset{${theme.prose}}@layer astryx-theme{${theme.component}}body{margin:0}.fixture{margin:8px;box-sizing:border-box}</style>${markup}<pre id="result"></pre><script>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const failures=[],evidence=[];
    for(const section of document.querySelectorAll('.fixture')){
      const bounds=section.getBoundingClientRect();if(section.scrollWidth>Math.ceil(bounds.width)+1)failures.push('overflow '+JSON.stringify(section.dataset));
      const buttons=[...section.querySelectorAll('button')];
      for(const button of buttons){const box=button.getBoundingClientRect();if(box.width<43.9||box.height<43.9)failures.push('small target '+JSON.stringify(section.dataset));if(box.left<bounds.left-1||box.right>bounds.right+1)failures.push('clipped target '+JSON.stringify(section.dataset));if(!button.textContent.trim()&&!button.getAttribute('aria-label'))failures.push('unlabelled target');}
      evidence.push({...section.dataset,buttons:buttons.length,disabled:buttons.filter(button=>button.disabled).length});
    }document.getElementById('result').textContent=JSON.stringify({failures,evidence});
  }));</script></html>`;
  const directory = await mkdtemp(path.join(tmpdir(), "xgent-discovery-layout-")), artifacts = path.resolve("../../.ci-artifacts/autonomy-worker-discovery-layout");
  try {
    await mkdir(artifacts, { recursive: true }); const file = path.join(directory, "discovery.html"); await writeFile(file, html);
    const result = JSON.parse(await imageBrowserCompletion(annotationBrowser, pathToFileURL(file).href, directory, { screenshotPath: path.join(artifacts, "review.png"), screenshotSelector: '.fixture[data-width="320"][data-scale="1.5"][data-locale="zh-CN"][data-state="ready"]', isolateScreenshot: true }));
    await writeFile(path.join(artifacts, "measurements.json"), JSON.stringify(result, null, 2));
    assert.deepEqual(result.failures, []); assert.equal(result.evidence.length, 48); assert.ok(result.evidence.filter(row => row.state === "ready").every(row => row.buttons === 7));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
