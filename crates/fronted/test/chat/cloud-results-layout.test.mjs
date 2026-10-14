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

test("actual extracted cloud files and partial ZIP remain usable without overlap or clipping at narrow widths", {
  skip: annotationBrowser ? false : "A Chromium browser is required for layout evidence",
}, async () => {
  const vendor = {
    "@astryxdesign/core/theme": await import("@astryxdesign/core/theme"),
    "@astryxdesign/theme-neutral": await import("@astryxdesign/theme-neutral"),
    "@astryxdesign/core/DropdownMenu": await import("@astryxdesign/core/DropdownMenu"),
    "@astryxdesign/core/Link": await import("@astryxdesign/core/Link"),
    "@astryxdesign/core/Text": await import("@astryxdesign/core/Text"),
  };
  // Use production glyphs without starting the build-time icon import plugin.
  const glyphs = JSON.parse(readFileSync(new URL("../../node_modules/@iconify-json/material-icon-theme/icons.json", import.meta.url), "utf8"));
  const iconMocks = {};
  const icons = readFileSync(new URL("../../src/components/chat/fileTypeIcons.tsx", import.meta.url), "utf8");
  for (const [, specifier, name, raw] of icons.matchAll(/from "(~icons\/material-icon-theme\/([^?\"]+)(\?raw)?)"/g)) {
    let resolved = name;
    while (glyphs.aliases?.[resolved]) resolved = glyphs.aliases[resolved].parent;
    const glyph = glyphs.icons[resolved];
    assert.ok(glyph, `Missing glyph ${specifier}`);
    const viewBox = `0 0 ${glyph.width ?? glyphs.width ?? 24} ${glyph.height ?? glyphs.height ?? 24}`;
    iconMocks[specifier] = { __esModule: true, default: raw
      ? `<svg viewBox="${viewBox}">${glyph.body}</svg>`
      : props => React.createElement("svg", { ...props, viewBox, "aria-hidden": true, dangerouslySetInnerHTML: { __html: glyph.body } }) };
  }
  const { translations } = createTsModuleLoader().loadModule("src/i18n/config.ts");
  const Locale = React.createContext("en-US");
  const loader = createTsModuleLoader({ mocks: {
    ...vendor, ...iconMocks, react: React, "react/jsx-runtime": jsx,
    "../../i18n": { useLocale: () => { const locale = React.useContext(Locale); return { locale, t: key => translations[locale][key] ?? key }; } },
    "@xgent/runtime": { isTauriRuntime: () => false, invoke: () => assert.fail("SSR layout attempted a file operation") },
  } });
  const { GeneratedFilePreviewCard } = loader.loadModule("src/components/chat/GeneratedFilePreviewCard.tsx");
  const { CloudArtifactsCard } = loader.loadModule("src/components/chat/CloudArtifactsCard.tsx");
  const { collectCloudExtractedFiles, collectCloudArtifacts } = loader.loadModule("src/lib/chat/messages/cloudArtifacts.ts");
  const { xgentCompactTheme } = loader.loadModule("src/theme/xgentTheme.ts");
  const { Theme, generateThemeCSS } = vendor["@astryxdesign/core/theme"];
  const themeCss = generateThemeCSS(xgentCompactTheme);
  const css = readFileSync(new URL("../../src/index.css", import.meta.url), "utf8").replace(/^@import .*;$/gm, "");
  const vendorCss = readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css", import.meta.url), "utf8");
  const reset = readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")), "utf8");
  const sections = [];
  for (const width of [240, 320, 390, 768]) for (const scale of [1, 1.5]) for (const locale of ["en-US", "zh-CN"]) {
    const base = "product-documentation-and-implementation-plan-".repeat(2);
    const details = { kind: "cloud_task_manager", action: "extract_artifact", taskId: "task-layout", artifactId: 42,
      artifactName: "xgent-task-layout", localPath: "/original-device/project/cloud-results.zip", sizeBytes: 100, runConclusion: "failure",
      fileSource: { version: 1, hostId: "22222222-2222-4222-8222-222222222222", workdir: "/original-device/project" },
      files: ["docx", "html", "pptx"].map(ext => ({ path: `cloud-results-actual/${base}.${ext}`, bytes: 123, contentHash: "a".repeat(64) })) };
    const rounds = [{ blocks: [{ kind: "tool", item: { toolCall: { name: "CloudTaskManager", id: "one-import", arguments: { action: "extract_artifact" } }, toolResult: { isError: false, details } } }] }];
    const previewedFiles = collectCloudExtractedFiles(rounds), artifacts = collectCloudArtifacts(rounds);
    sections.push(React.createElement(Locale.Provider, { value: locale, key: `${width}-${scale}-${locale}` },
      React.createElement("section", { className: "fixture", "data-width": width, "data-scale": scale, "data-locale": locale,
        style: { width, fontSize: `${15 * scale}px`, "--text-label-size": `${15 * scale}px` } },
      React.createElement(GeneratedFilePreviewCard, { paths: [], previewedFiles, onOpenFileLink() {} }),
      React.createElement(CloudArtifactsCard, { artifacts, onOpenFileLink() {} }))));
  }
  const markup = renderToStaticMarkup(React.createElement(Theme, { theme: xgentCompactTheme, mode: "light" }, ...sections));
  const html = `<!doctype html><html data-theme="light" data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><style>${reset}\n${vendorCss}\n${css}\n@layer reset {${themeCss.prose}}\n@layer astryx-theme {${themeCss.component}}
    :root {--spacing-1:4px;--spacing-2:8px;--size-element-sm:32px;--size-element-md:40px;--size-element-lg:44px;}
    .fixture {margin:16px;} .fixture * {box-sizing:border-box;} #result {display:none;}
    </style>${markup}<pre id="result"></pre><script>
    addEventListener('load', () => requestAnimationFrame(() => {
      const failures=[], evidence=[];
      for(const section of document.querySelectorAll('.fixture')) {
        const cards=[...section.querySelectorAll('.generated-file-card')];
        if(cards.length!==3) failures.push('Missing source card');
        for(const card of cards) {
          const bounds=card.getBoundingClientRect(), controls=[...card.querySelectorAll('button')], boxes=controls.map(c=>c.getBoundingClientRect());
          if(card.scrollWidth>card.clientWidth+1) failures.push('Card overflow '+section.dataset.width);
          for(const box of boxes) if(box.left<bounds.left-1 || box.right>bounds.right+1) failures.push('Clipped control '+section.dataset.width);
          if(boxes[0].right>boxes[1].left+1 && boxes[0].bottom>boxes[1].top+1 && boxes[1].bottom>boxes[0].top+1) failures.push('Overlapping controls '+section.dataset.width);
          if(Number(section.dataset.width)<=420 && boxes[0].width<bounds.width/2) failures.push('Compressed filename '+section.dataset.width);
          for(const box of boxes) if(box.width<44-0.1 || box.height<44-0.1) failures.push('Small action target '+section.dataset.width);
          evidence.push({width:section.dataset.width,scale:section.dataset.scale,locale:section.dataset.locale,source:controls[0].title,disabled:controls[1].disabled,boxes:boxes.map(b=>({width:b.width,height:b.height}))});
        }
        if(new Set(cards.map(c=>c.querySelector('button strong').textContent)).size!==3) failures.push('Indistinguishable imported paths');
        const zip=section.querySelector('a');
        if(!zip || !zip.textContent.includes('cloud-results.zip')) failures.push('Missing actual ZIP link');
        if(section.scrollWidth>section.clientWidth+1) failures.push('Partial receipt overflow '+section.dataset.width);
        if(!section.textContent.includes('failure')) failures.push('Missing partial conclusion');
      }
      document.getElementById('result').textContent=JSON.stringify({failures,evidence});
    }));</script></html>`;
  const directory = await mkdtemp(path.join(tmpdir(), "xgent-cloud-results-layout-"));
  const artifacts = path.resolve("../../.ci-artifacts/autonomy-cloud-results-layout");
  try {
    await mkdir(artifacts, { recursive: true });
    const file = path.join(directory, "cards.html"); await writeFile(file, html);
    const result = JSON.parse(await imageBrowserCompletion(annotationBrowser, pathToFileURL(file).href, directory, {
      screenshotPath: path.join(artifacts, "cards.png"), screenshotSelector: '.fixture[data-width="320"][data-scale="1.5"][data-locale="zh-CN"]', isolateScreenshot: true,
    }));
    await writeFile(path.join(artifacts, "measurements.json"), JSON.stringify(result, null, 2));
    assert.deepEqual(result.failures, []);
    assert.equal(result.evidence.length, 48);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
