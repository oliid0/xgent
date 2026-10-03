import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript-transpile";
import { annotationBrowser } from "./document-annotation-browser.mjs";
import { imageBrowserCompletion } from "./image-browser-completion.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
export { annotationBrowser as diagramBrowser };

export async function diagramsInBrowser(requests, svgFixtures = []) {
  if (!annotationBrowser) throw new Error("Native diagram verification requires a real browser DOM");
  const temporaryRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, "xgent-native-diagram-test-"));
  const relative = path.relative(temporaryRoot, path.resolve(directory));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Diagram fixture escaped its temporary directory");
  try {
    const lower = source => ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    const pluginPath = fileURLToPath(import.meta.resolve("@streamdown/mermaid"));
    const mermaidPath = require.resolve("mermaid", { paths: [path.dirname(pluginPath)] });
    const vendor = pathToFileURL(path.join(path.dirname(mermaidPath), "mermaid.min.js")).href;
    const module = name => lower(readFileSync(path.join(root, "src/presentation", name), "utf8"));
    const input = JSON.stringify({ requests, svgFixtures }).replaceAll("<", "\\u003c");
    const html = `<!doctype html><meta charset="utf-8"><pre id="result"></pre>
<script src="${vendor}"></script><script>
const modules = {};
function require(name) { if (name === "mermaid") return window.mermaid; if (modules[name]) return modules[name]; throw new Error(name); }
function load(name, source) { const exports = {}; new Function("require", "exports", source)(require, exports); modules[name] = exports; }
load("@streamdown/mermaid", ${JSON.stringify(lower(readFileSync(pluginPath, "utf8")))});
load("./nativeDiagramSvg", ${JSON.stringify(module("nativeDiagramSvg.ts"))});
load("./nativeMermaid", ${JSON.stringify(module("nativeMermaid.ts"))});
(async () => { let result; try {
  const input = ${input};
  const diagrams = await Promise.all(input.requests.map(request => modules["./nativeMermaid"].renderNativeDiagram(request.source, request.dark).then(JSON.parse)));
  const bounds = source => {
    const host = document.createElement("div"); host.style.cssText = "position:fixed;left:-9999px;opacity:0";
    host.innerHTML = source; document.body.append(host);
    try { const box = host.querySelector("svg").getBBox(); return { x: box.x, y: box.y, width: box.width, height: box.height }; }
    finally { host.remove(); }
  };
  const converted = input.svgFixtures.map(source => { try {
    const svg = modules["./nativeDiagramSvg"].nativeDiagramSvg(source);
    return { svg, bounds: { source: bounds(source), native: bounds(svg) } };
  } catch(error) { return { error: error.message }; } });
  result = { diagrams, converted, remaining: document.querySelectorAll("div[style*='-100000px']").length };
} catch(error) { result = { error: String(error?.stack ?? error) }; }
const bytes = new TextEncoder().encode(JSON.stringify(result)); let encoded = "";
for (let i = 0; i < bytes.length; i += 32768) encoded += String.fromCharCode(...bytes.subarray(i, i + 32768));
document.getElementById("result").textContent = btoa(encoded);
})();</script>`;
    const file = path.join(directory, "test.html");
    await writeFile(file, html);
    const encoded = await imageBrowserCompletion(annotationBrowser, pathToFileURL(file).href, directory);
    const result = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (result.error) throw new Error(result.error);
    return result;
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}
