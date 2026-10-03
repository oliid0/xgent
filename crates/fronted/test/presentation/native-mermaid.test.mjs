import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";
import { diagramsInBrowser, diagramBrowser } from "../helpers/native-diagram-browser.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { nativeDiagramRequest } = loader.loadModule("src/presentation/nativeMermaid.ts");
const { attachReadOnlySyntax, readOnlySyntaxPalette } = loader.loadModule("src/presentation/nativeReadOnlySyntax.ts");
const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");

test("diagrams have their own validated read-only action without changing code requests", () => {
  const handlers = new Map();
  const palette = readOnlySyntaxPalette({ customSettings: { appearance: { preset: "stone", customized: false } } }, false);
  const nodes = attachReadOnlySyntax([{ id: "answer", kind: "Markdown", text: "```mermaid\ngraph TD; A-->B\n```" },
    { id: "code", kind: "CodeBlock", language: "mermaid", text: "graph TD; A-->B" }], handlers, palette);
  assert.notEqual(nodes[0].action, nodes[0].diagramAction);
  assert.equal(nodes[1].diagramAction, undefined);
  const action = handlers.get(nodes[0].diagramAction);
  assert.equal(action.accepts(JSON.stringify({ source: "graph TD; A-->B", dark: false })), true);
  assert.equal(handlers.get(nodes[0].action).accepts(JSON.stringify({ source: "graph TD; A-->B", dark: false })), false);
  for (const value of [null, "invalid", JSON.stringify({ source: "", dark: false }),
    JSON.stringify({ source: "x".repeat(50001), dark: false }), JSON.stringify({ source: "graph TD", dark: "false" })]) {
    assert.equal(nativeDiagramRequest(value), undefined);
  }
  const document = { version: 1, surface: "chat", revision: 1, mode: "root", appearance: "light", title: "Chat", nodes };
  validatePresentationDocument(document, handlers);
  for (const replacement of [{ ...nodes[0], diagramAction: "missing" }, { ...nodes[1], diagramAction: nodes[0].diagramAction }]) {
    assert.throws(() => validatePresentationDocument({ ...document, nodes: [replacement] }, handlers), /diagram action/);
  }
});

test("the actual shared Mermaid engine preserves labels, paths and arrows across native light/dark diagrams", { skip: !diagramBrowser }, async () => {
  const samples = [
    'flowchart LR\n A["搜索资料<br/>输入"] --> B{审核}\n B -->|通过| C[完成]\n B -.重试.-> A',
    "sequenceDiagram\n participant A as App\n participant B as Rust\n A->>B: Request\n B-->>A: Result",
    "classDiagram\n class App\n class Backend\n App --> Backend : calls",
    "stateDiagram-v2\n [*] --> Running\n Running --> Done\n Done --> [*]",
    "pie title Work\n \"Complete\" : 90\n \"Remaining\" : 10",
  ];
  const requests = samples.flatMap(source => [{ source, dark: false }, { source, dark: true }]);
  requests.push({ source: "this is not a diagram", dark: false }, { source: samples[0], dark: false });
  const fixture = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><defs><marker id="arrow" viewBox="0 0 10 10" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0 L10 5 L0 10 z" fill="#123456"/></marker></defs><path d="M10 25 L90 25" stroke="#654321" marker-start="url(#arrow)" marker-end="url(#arrow)"/></svg>';
  const result = await diagramsInBrowser(requests, [fixture,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><foreignObject/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 1"/>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 70"><text x="50" y="20" text-anchor="middle" font-size="12"><tspan x="50" dy="0"><tspan>First line</tspan></tspan><tspan x="50" dy="18"><tspan>第二行</tspan></tspan></text></svg>']);
  assert.equal(result.remaining, 0, "Every temporary SVG layout surface must be retired");
  for (let i = 0; i < samples.length * 2; i++) {
    const diagram = result.diagrams[i];
    assert.equal(diagram.source, requests[i].source);
    assert.equal(diagram.dark, requests[i].dark);
    assert.equal(diagram.error, undefined, `${i}: ${diagram.error}`);
    assert.match(diagram.svg, /<svg[^>]+width="[\d.]+"[^>]+height="[\d.]+"/);
    assert.doesNotMatch(diagram.svg, /<foreignObject|<marker|<style|marker-(?:start|end)=/);
    assert.doesNotMatch(diagram.svg, /stroke-dasharray="[^"]*px/, "Native number lists must not retain CSS units");
    assert.doesNotMatch(diagram.svg, /<tspan\b/, "Nested labels must become independent positioned native text runs");
    if (i < 2) for (const label of ["搜索资料", "输入", "审核", "完成", "通过", "重试"])
      assert.ok(diagram.svg.includes(label), `Missing diagram label: ${label}`);
    for (const rectangle of diagram.svg.matchAll(/<rect\b([^>]*)>/g)) {
      assert.match(rectangle[1], /\bwidth="[^"]+"/);
      assert.match(rectangle[1], /\bheight="[^"]+"/);
    }
    assert.match(diagram.svg, /<(?:path|rect|circle)/);
    if (i < 8) assert.match(diagram.svg, /data-xgent-arrow="end"/, "Native rendering cannot drop arrowheads");
    assert.notEqual(result.diagrams[0].svg, result.diagrams[1].svg);
  }
  assert.ok(result.diagrams[10].error, "Invalid syntax must return a local error with its source");
  assert.ok(result.diagrams[11].svg, "A failed request must not stop later diagram rendering");
  assert.match(result.converted[0].svg, /data-xgent-arrow="start"[^>]+rotate\(180\)/);
  assert.match(result.converted[0].svg, /data-xgent-arrow="end"/);
  assert.ok(result.converted[1].error); assert.ok(result.converted[2].error);
  assert.match(result.converted[3].svg, />First line<\/text>/);
  assert.match(result.converted[3].svg, />第二行<\/text>/);
  for (const dimension of ["x", "y", "width", "height"])
    assert.ok(Math.abs(result.converted[3].bounds.source[dimension] - result.converted[3].bounds.native[dimension]) < 0.5,
      `Native text must preserve browser ${dimension}, including multiline baselines and anchoring`);
  if (process.env.XGENT_DIAGRAM_FIXTURE) writeFileSync(process.env.XGENT_DIAGRAM_FIXTURE,
    JSON.stringify(result.diagrams.slice(0, 10), null, 2));
});
