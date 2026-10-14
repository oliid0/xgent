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

test("actual Home power source selection uses existing Astryx controls without explanatory text, clipping or overflow at mobile widths", {
  skip: annotationBrowser ? false : "Chromium is required for layout evidence",
}, async () => {
  const vendor = {};
  for (const name of ["Banner", "Button", "Layout", "Selector", "Switch", "Text", "TextInput", "theme"])
    vendor[`@astryxdesign/core/${name}`] = await import(`@astryxdesign/core/${name}`);
  vendor["@astryxdesign/theme-neutral"] = await import("@astryxdesign/theme-neutral");
  const { translations } = createTsModuleLoader().loadModule("src/i18n/config.ts");
  const peerId = "22222222-2222-4222-8222-222222222222";
  const fixtures = []; let theme;
  for (const width of [320, 375, 390, 430]) for (const scale of [1, 1.5]) for (const locale of ["zh-CN", "en-US"]) {
    const hooks = createReactHookHarness();
    const t = key => translations[locale][key] ?? key;
    const loader = createTsModuleLoader({ mocks: { ...vendor, react: { ...React, ...hooks.react }, "react/jsx-runtime": jsx,
      "../../i18n": { useLocale: () => ({ t }) },
      "../../lib/automation/useProactiveRules": { useProactiveRules: () => undefined },
      "../../runtime/applePresentation": { isApplePresentationRuntime: () => false },
      "../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
      "../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
      "../../presentation/NativeSurface": { NativeSurface: () => null },
      "../../presentation/NativeSettingsContent": { NativeSettingsContent: () => null },
    } });
    const { ProactiveRulesContent } = loader.loadModule("src/pages/settings/ProactiveRulesSection.tsx");
    theme = loader.loadModule("src/theme/xgentTheme.ts").xgentCompactTheme;
    const rules = { busy: false, ownerChanged: false, error: null, async refresh() {}, async apply() {},
      snapshot: { revision: 1, hostId: "actual-phone", hostTime: "2026-10-12T10:00:00-07:00", rules: [], deliveries: [],
        targets: [{ id: "target", name: "Home follow-up", type: "prompt", enabled: true }], homeEventHomes: [{ id: "11111111-1111-4111-8111-111111111111", name: "客厅家庭 / Actual authorized Home" }],
        executionPeers: [{ peerId, online: true, host: { hostId: peerId, platform: "macos", executorReady: true,
          acceptsBackgroundTasks: true, workspaceAvailable: true, inputSnapshotVersion: 1, sourceContextVersion: 1,
          sourceRoutingVersion: 1, deviceChannelVersion: 1, deviceActionsVersion: 1, workdir: "/actual",
          providers: [{ id: "actual", name: "Actual", models: ["actual"] }] } }] } };
    const render = () => hooks.render(() => ProactiveRulesContent({ rules, settings: { theme: "light" }, onBack() {} }));
    const flatten = value => !value ? [] : Array.isArray(value) ? value.flatMap(flatten) : [value, ...flatten(value.props?.children)];
    const select = (key, value) => {
      const control = flatten(render()).find(node => node.props?.label === t(key));
      assert.ok(control, key); control.props.onChange(value);
    };
    select("proactive.name", "Home follow-up"); select("proactive.target", "target"); select("proactive.executor", peerId);
    select("proactive.provider", "actual"); select("proactive.model", "actual"); select("proactive.event", "home_power_changed");
    select("proactive.home", "11111111-1111-4111-8111-111111111111");
    const tree = render(); const field = flatten(tree).find(node => node.props?.label === t("proactive.home"));
    assert.equal(field.props.value, "11111111-1111-4111-8111-111111111111"); assert.equal(field.props.isDisabled, false);
    assert.equal(field.props.presentation, "adaptive"); assert.equal(field.props.width, "100%");
    assert.equal(field.props.description, undefined); assert.equal(field.props.labelTooltip, undefined);
    fixtures.push(React.createElement("section", { key: `${width}-${scale}-${locale}`, className: "fixture",
      "data-width": width, "data-scale": scale, "data-locale": locale,
      style: { width, fontSize: `${15 * scale}px`, "--text-label-size": `${15 * scale}px` } }, tree));
  }
  const { Theme, generateThemeCSS } = vendor["@astryxdesign/core/theme"];
  const themeCss = generateThemeCSS(theme);
  const css = readFileSync("src/index.css", "utf8").replace(/@import[^;]+;/g, "");
  const reset = readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")), "utf8");
  const vendorCss = readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css", import.meta.url), "utf8");
  const markup = renderToStaticMarkup(React.createElement(Theme, { theme }, ...fixtures));
  assert.doesNotMatch(markup, /已有任务会继续|启用不会补跑|Existing tasks continue|Enabling does not replay/);
  const html = `<!doctype html><html data-theme="light" data-astryx-theme="${theme.name}"><meta charset="utf-8"><style>${reset}\n${vendorCss}\n${css}\n@layer reset {${themeCss.prose}} @layer astryx-theme {${themeCss.component}}\nbody{margin:0}.fixture{margin:8px;box-sizing:border-box}</style>${markup}<pre id="result"></pre><script>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const failures=[],evidence=[];
    for(const section of document.querySelectorAll('.fixture')) {
      const bounds=section.getBoundingClientRect();
      if(section.scrollWidth>Math.ceil(bounds.width)+1) failures.push('Overflow '+JSON.stringify(section.dataset));
      for(const button of section.querySelectorAll('button')) {
        const box=button.getBoundingClientRect();
        if(box.left<bounds.left-1||box.right>bounds.right+1) failures.push('Clipped control '+JSON.stringify(section.dataset));
        if(!button.textContent.trim()&&!button.getAttribute('aria-label')) failures.push('Unlabelled control');
      }
      evidence.push({...section.dataset,width:bounds.width,scrollWidth:section.scrollWidth});
    }
    document.getElementById('result').textContent=JSON.stringify({failures,evidence});
  }));</script></html>`;
  const directory = await mkdtemp(path.join(tmpdir(), "xgent-home-events-layout-"));
  const artifacts = path.resolve("../../.ci-artifacts/autonomy-home-events-layout");
  try {
    await mkdir(artifacts, { recursive: true }); const file = path.join(directory, "rules.html"); await writeFile(file, html);
    const result = JSON.parse(await imageBrowserCompletion(annotationBrowser, pathToFileURL(file).href, directory, {
      screenshotPath: path.join(artifacts, "review.png"), screenshotSelector: '.fixture[data-width="320"][data-scale="1.5"][data-locale="zh-CN"]', isolateScreenshot: true,
    }));
    await writeFile(path.join(artifacts, "measurements.json"), JSON.stringify(result, null, 2));
    assert.deepEqual(result.failures, []); assert.equal(result.evidence.length, 16);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
