import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript-transpile";
import { annotationBrowser } from "./document-annotation-browser.mjs";
import { imageBrowserCompletion } from "./image-browser-completion.mjs";

export async function verifyPdfHighlightsInBrowser(bytes) {
  if (!annotationBrowser) throw new Error("PDF selection checks require a real browser");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const temporaryRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, "xgent-pdf-highlight-"));
  const relative = path.relative(temporaryRoot, path.resolve(directory));
  if (relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(directory).startsWith("xgent-pdf-highlight-")) throw new Error("PDF test escaped its temporary root");
  try {
    const lower = name => ts.transpileModule(readFileSync(path.join(root, "src/components/workspace-editor", name), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const url = name => pathToFileURL(path.join(root, "node_modules", name)).href;
    const css = readFileSync(path.join(root, "src/index.css"), "utf8");
    const geometryCss = css.slice(css.indexOf(".workspace-pdf-preview {"), css.indexOf(".generated-file-cards {"));
    const html = `<!doctype html><meta charset="utf-8"><style>${geometryCss}</style>
<pre id="result"></pre><div class="workspace-document-pages"><div class="workspace-pdf-page"><canvas></canvas><div class="workspace-pdf-text"></div></div></div>
<script src="${url("pdf-lib/dist/pdf-lib.min.js")}"></script>
<script type="module">
import { getDocument, GlobalWorkerOptions, TextLayer } from ${JSON.stringify(url("pdfjs-dist/build/pdf.mjs"))};
GlobalWorkerOptions.workerSrc = ${JSON.stringify(url("pdfjs-dist/build/pdf.worker.mjs"))};
function load(source, require) { const exports = {}; new Function("exports", "require", source)(exports, require); return exports; }
const imagePreview = load(${JSON.stringify(lower("workspaceImagePreview.ts"))}, () => { throw new Error("Unexpected import"); });
const highlights = load(${JSON.stringify(lower("workspacePdfHighlights.ts"))}, name => name === "pdf-lib" ? PDFLib : imagePreview);
const selectionModule = load(${JSON.stringify(lower("workspacePdfSelection.ts"))}, () => { throw new Error("Unexpected import"); });
const bytes = Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytes).toString("base64"))}), c => c.charCodeAt(0));
const options = data => ({ data: data.slice(), useSystemFonts: true, standardFontDataUrl: ${JSON.stringify(url("pdfjs-dist/standard_fonts/"))} });
function encode(bytes) { let result = ""; for (let offset = 0; offset < bytes.length; offset += 32768) result += String.fromCharCode(...bytes.subarray(offset, offset + 32768)); return btoa(result); }
(async () => { let result; try {
  const pdfTask = getDocument(options(bytes)); const pdf = await pdfTask.promise;
  const page = await pdf.getPage(1), content = await page.getTextContent(), results = [];
  const layer = document.querySelector(".workspace-pdf-text"), canvas = document.querySelector("canvas"), wrapper = document.querySelector(".workspace-pdf-page");
  for (const rotation of [0, 90, 180, 270]) for (const scale of [0.75, 1.5]) {
    const viewport = page.getViewport({ rotation, scale });
    wrapper.style.width = viewport.width + "px"; wrapper.style.height = viewport.height + "px";
    canvas.width = viewport.width; canvas.height = viewport.height;
    canvas.style.width = viewport.width + "px"; canvas.style.height = viewport.height + "px";
    await page.render({ canvas, viewport }).promise;
    layer.replaceChildren(); layer.style.setProperty("--total-scale-factor", String(viewport.scale));
    await new TextLayer({ textContentSource: content, container: layer, viewport }).render();
    const span = Array.from(layer.querySelectorAll("span")).find(span => span.textContent.includes("Original"));
    if (!span) throw new Error("Actual PDF text layer is empty");
    const range = document.createRange(); range.selectNodeContents(span);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const rects = selectionModule.pdfSelectionRectangles(layer, viewport, selection);
    if (!rects.length) throw new Error("Selected text has no PDF coordinates");
    const [x, y, width, height] = rects[0];
    if (Math.abs(x - 30) > 2 || Math.abs(y - 70) > 20 || width < 50 || height < 5 || height > 30) throw new Error("Text layer geometry diverged: " + JSON.stringify({ rotation, scale, rects }));
    const output = await highlights.writePdfHighlights(bytes, [{ id: "browser-" + rotation + "-" + String(scale).replace(".", "-"), pageIndex: 0, rects, color: "yellow" }]);
    const savedTask = getDocument(options(output)); const saved = await savedTask.promise;
    const savedPage = await saved.getPage(1), annotations = await savedPage.getAnnotations();
    if (!annotations.some(annotation => annotation.subtype === "Highlight")) throw new Error("Saved PDF has no readable highlight");
    const target = document.createElement("canvas"), savedViewport = savedPage.getViewport({ scale: 1 });
    target.width = savedViewport.width; target.height = savedViewport.height;
    await savedPage.render({ canvas: target, viewport: savedViewport }).promise;
    const before = document.createElement("canvas"), originalViewport = page.getViewport({ scale: 1, rotation: 0 });
    before.width = originalViewport.width; before.height = originalViewport.height;
    await page.render({ canvas: before, viewport: originalViewport }).promise;
    const afterPixels = target.getContext("2d").getImageData(0, 0, target.width, target.height).data;
    const beforePixels = before.getContext("2d").getImageData(0, 0, before.width, before.height).data;
    let changed = 0; for (let index = 0; index < afterPixels.length; index += 4) if (afterPixels[index + 2] !== beforePixels[index + 2]) changed++;
    if (changed < 100) throw new Error("Saved highlight is invisible in the actual rendered PDF");
    selection.removeAllRanges(); await savedTask.destroy(); results.push({ rotation, scale, rects, changed });
  }
  await pdfTask.destroy(); result = { ok: true, results };
} catch (error) { result = { ok: false, error: String(error?.stack ?? error) }; }
document.getElementById("result").textContent = encode(new TextEncoder().encode(JSON.stringify(result)));
})();</script>`;
    const file = path.join(directory, "pdf-selection.html"); await writeFile(file, html);
    const encoded = await imageBrowserCompletion(annotationBrowser, pathToFileURL(file).href, directory);
    const result = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (!result.ok) throw new Error(result.error);
    return result.results;
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}
