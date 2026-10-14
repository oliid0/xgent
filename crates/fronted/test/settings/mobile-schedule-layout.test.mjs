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

test("real schedule form keeps accessible controls inside narrow layouts in both locales and enlarged text", {
  skip: annotationBrowser ? false : "A Chromium browser is required for layout evidence",
}, async () => {
  const vendor = {};
  for (const name of ["Banner", "Button", "Layout", "List", "Section", "Selector", "Text", "TextInput", "theme"])
    vendor[`@astryxdesign/core/${name}`] = await import(`@astryxdesign/core/${name}`);
  vendor["@astryxdesign/theme-neutral"] = await import("@astryxdesign/theme-neutral");
  const { translations } = createTsModuleLoader().loadModule("src/i18n/config.ts");
  const Context = React.createContext({ locale: "en-US", variant: "ready" });
  const noop = () => {};
  const loader = createTsModuleLoader({ mocks: { ...vendor, react: React, "react/jsx-runtime": jsx, "../../components/icons": connectorIcons,
    "../../i18n": { useLocale: () => { const { locale } = React.useContext(Context); return { locale, t: key => { assert.ok(key in translations[locale], key); return translations[locale][key]; } }; } },
    "../../lib/connectors/useMobileSchedule": { useMobileSchedule: () => { const { variant } = React.useContext(Context); return {
      kind: "reminder", calendarId: "observed", calendars: { calendars: variant === "empty" ? [] : [{ id: "observed", title: "Work calendar", source: "work-account@example.test" }], truncated: false },
      title: "Exercise", day: "2099-10-09", time: "20:00", recurrence: "daily", duration: 30,
      records: [{ id: "record", title: "An existing fitness reminder", time: 4095198000000, source: "Work calendar" }],
      busy: variant === "busy", canSave: variant !== "unknown", error: variant === "unknown" ? "Provider reply lost. Inspect records before trying again." : "", receipt: null,
      ...Object.fromEntries(["setKind", "setCalendarId", "setTitle", "setDay", "setTime", "setRecurrence", "setDuration", "load", "save"].map(k => [k, noop])),
    }; } },
  } });
  const { MobileScheduleSection } = loader.loadModule("src/pages/settings/MobileScheduleSection.tsx");
  const { xgentCompactTheme } = loader.loadModule("src/theme/xgentTheme.ts");
  const { Theme, generateThemeCSS } = vendor["@astryxdesign/core/theme"];
  const themeCss = generateThemeCSS(xgentCompactTheme);
  const css = readFileSync(new URL("../../src/index.css", import.meta.url), "utf8").replace(/^@import .*;$/gm, "");
  const vendorCss = readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css", import.meta.url), "utf8");
  const reset = readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")), "utf8");
  const fixtures = [];
  for (const width of [240, 320, 390, 768]) for (const scale of [1, 1.5]) for (const locale of ["en-US", "zh-CN"]) for (const variant of ["ready", "busy", "empty", "unknown"])
    fixtures.push(React.createElement(Context.Provider, { key: `${width}-${scale}-${locale}-${variant}`, value: { locale, variant } },
      React.createElement("section", { className: "fixture", "data-width": width, "data-scale": scale, "data-locale": locale, "data-variant": variant,
        style: { width, fontSize: `${15 * scale}px`, "--text-label-size": `${15 * scale}px` } }, React.createElement(MobileScheduleSection))));
  const markup = renderToStaticMarkup(React.createElement(Theme, { theme: xgentCompactTheme }, ...fixtures));
  const html = `<!doctype html><html data-theme="light" data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><style>${reset}\n${vendorCss}\n${css}
    @layer reset {${themeCss.prose}} @layer astryx-theme {${themeCss.component}}
    :root {--spacing-1:4px;--spacing-2:8px;--size-element-sm:32px;--size-element-md:40px;--size-element-lg:44px;}
    .fixture {margin:16px;} .fixture * {box-sizing:border-box;} #result {display:none;}
    </style>${markup}<pre id="result"></pre><script>addEventListener('load', () => requestAnimationFrame(() => {
      const failures=[], evidence=[];
      for(const section of document.querySelectorAll('.fixture')) {
        const bounds=section.getBoundingClientRect();
        if(section.scrollWidth>section.clientWidth+1) failures.push('Overflow '+JSON.stringify(section.dataset));
        const controls=[...section.querySelectorAll('button,input,[role="combobox"]')].filter(c=>c.getBoundingClientRect().height>0);
        // Use the installed delegated click surface, as in astryx-narrow-layout.
        const boxes=controls.map(c=>(c.matches('input,.astryx-selector > button:first-of-type')
          ? c.closest('.astryx-text-input,.astryx-selector') ?? c : c).getBoundingClientRect());
        for(let i=0;i<boxes.length;i++) {
          const box=boxes[i],control=controls[i];
          if(box.left<bounds.left-1 || box.right>bounds.right+1) failures.push('Clipped control '+section.dataset.width);
          if(box.height<43.9 || box.width<43.9) failures.push('Small target '+control.outerHTML.slice(0,120));
          if(!control.getAttribute('aria-label') && !(control.labels?.length) && !control.textContent.trim() && !control.getAttribute('aria-labelledby')) failures.push('Unlabelled control');
          for(let j=i+1;j<boxes.length;j++) if(boxes[j].left<box.right-1 && boxes[j].right>box.left+1 && boxes[j].top<box.bottom-1 && boxes[j].bottom>box.top+1) failures.push('Overlapping controls');
        }
        evidence.push({...section.dataset,controls:boxes.map(b=>({width:b.width,height:b.height})),disabled:controls.filter(c=>c.disabled||c.getAttribute('aria-disabled')==='true').length});
      }
      document.getElementById('result').textContent=JSON.stringify({failures,evidence});
    }));</script></html>`;
  const directory = await mkdtemp(path.join(tmpdir(), "xgent-schedule-layout-"));
  const artifacts = path.resolve("../../.ci-artifacts/autonomy-schedule-layout");
  try {
    await mkdir(artifacts, { recursive: true }); const file = path.join(directory, "schedule.html"); await writeFile(file, html);
    const result = JSON.parse(await imageBrowserCompletion(annotationBrowser, pathToFileURL(file).href, directory, {
      screenshotPath: path.join(artifacts, "schedule.png"), screenshotSelector: '.fixture[data-width="320"][data-scale="1.5"][data-locale="zh-CN"][data-variant="ready"]', isolateScreenshot: true,
    }));
    await writeFile(path.join(artifacts, "measurements.json"), JSON.stringify(result, null, 2));
    assert.deepEqual(result.failures, []); assert.equal(result.evidence.length, 64);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
