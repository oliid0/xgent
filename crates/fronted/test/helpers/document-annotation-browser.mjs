import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import ts from "typescript-transpile";
import { imageBrowserCompletion } from "./image-browser-completion.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const execute = promisify(execFile);
const candidates = [process.env.CHROME_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
export const annotationBrowser = candidates.find(candidate => candidate && existsSync(candidate));
if (!annotationBrowser && process.env.XGENT_REQUIRE_BROWSER_TESTS === "true") {
  throw new Error("Document annotation tests require Chrome/Edge with a real XML DOM");
}

export const annotateInBrowser = (bytes, format, page, text) =>
  officeModuleInBrowser(bytes, "documentAnnotations.ts", "annotateDocument", [format, page, text]);
export const editSpreadsheetInBrowser = (bytes, edits) =>
  officeModuleInBrowser(bytes, "workspaceSpreadsheet.ts", "writeSpreadsheetEdits", [edits]);
export const rotateImageInBrowser = (bytes, mimeType, degrees, encoderFallback = false) =>
  officeModuleInBrowser(bytes, "workspaceImageOperations.ts", "rotateWorkspaceImage", [mimeType, degrees], encoderFallback);

/** Execute the production module with its real libraries and browser XML APIs. */
async function officeModuleInBrowser(bytes, module, operation, args, encoderFallback = false) {
  if (!annotationBrowser) throw new Error("No document annotation browser is available");
  const temporaryRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, "xgent-annotation-test-"));
  const relative = path.relative(temporaryRoot, path.resolve(directory));
  if (relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(directory).startsWith("xgent-annotation-test-")) {
    throw new Error("Document annotation test directory escaped its temporary root");
  }
  try {
    const source = readFileSync(path.join(root, "src/components/workspace-editor", module), "utf8");
    // This is the same test-only TS lowering as load-ts-module, not an app build.
    const lowered = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    const request = JSON.stringify({ data: Buffer.from(bytes).toString("base64"), operation, args, encoderFallback }).replaceAll("<", "\\u003c");
    const vendor = relative => pathToFileURL(path.join(root, relative)).href;
    const html = `<!doctype html><meta charset="utf-8"><pre id="result"></pre>
<script src="${vendor("node_modules/jszip/dist/jszip.min.js")}"></script>
<script src="${vendor("node_modules/pdf-lib/dist/pdf-lib.min.js")}"></script>
<script src="${vendor("node_modules/xlsx/dist/xlsx.full.min.js")}"></script>
<script>
const exports = {};
function require(name) { if (name === "jszip") return window.JSZip; if (name === "pdf-lib") return window.PDFLib; if (name === "xlsx") return window.XLSX; throw new Error(name); }
${lowered}
function encode(bytes) { let result = ""; for (let offset = 0; offset < bytes.length; offset += 32768) result += String.fromCharCode(...bytes.subarray(offset, offset + 32768)); return btoa(result); }
(async () => { let result; try {
  const request = ${request};
  if (request.encoderFallback) {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback) { original.call(this, callback, "image/png"); };
  }
  const bytes = Uint8Array.from(atob(request.data), character => character.charCodeAt(0));
  result = { ok: true, data: encode(await exports[request.operation](bytes, ...request.args)) };
} catch (error) { result = { ok: false, error: String(error?.message ?? error) }; }
document.getElementById("result").textContent = encode(new TextEncoder().encode(JSON.stringify(result)));
})();
</script>`;
    const file = path.join(directory, "test.html");
    await writeFile(file, html);
    let encoded;
    if (module === "workspaceImageOperations.ts") {
      encoded = await imageBrowserCompletion(annotationBrowser, pathToFileURL(file).href, directory);
    } else {
      const { stdout, stderr } = await execute(annotationBrowser, ["--headless", "--disable-gpu", "--no-first-run",
        "--no-default-browser-check", "--no-sandbox", "--allow-file-access-from-files",
        `--user-data-dir=${path.join(directory, "profile")}`, "--virtual-time-budget=5000", "--dump-dom", pathToFileURL(file).href],
      { windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
      encoded = /<pre id="result">([A-Za-z0-9+/=]+)<\/pre>/.exec(stdout)?.[1];
      if (!encoded) throw new Error(`Browser did not complete document annotation: ${stderr.slice(-500)}`);
    }
    const result = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (!result.ok) throw new Error(result.error);
    return new Uint8Array(Buffer.from(result.data, "base64"));
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

export async function presentationFixture(JSZip, options = {}) {
  const zip = new JSZip();
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
  zip.file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`);
  zip.file("ppt/presentation.xml", `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="256" r:id="first"/><p:sldId id="257" r:id="second"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`);
  const prefix = options.prefixedRelationships ? "pkg:" : "";
  const namespace = options.prefixedRelationships ? `xmlns:pkg="${pkg}"` : `xmlns="${pkg}"`;
  zip.file("ppt/_rels/presentation.xml.rels", `<${prefix}Relationships ${namespace}><${prefix}Relationship Id="first" Type="${r}/slide" Target="slides/slide1.xml"/><${prefix}Relationship Id="second" Type="${r}/slide" Target="${options.target ?? "slides/slide2.xml"}"${options.external ? ' TargetMode="External"' : ""}/></${prefix}Relationships>`);
  const slide = title => `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Group"/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="7" name="Original"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  zip.file("ppt/slides/slide1.xml", slide("First unchanged"));
  zip.file(options.slidePath ?? "ppt/slides/slide2.xml", slide("Second original"));
  zip.file("ppt/media/image1.bin", Uint8Array.from([1, 2, 3, 4, 250]));
  zip.file("ppt/slides/_rels/slide2.xml.rels", `<Relationships xmlns="${pkg}"><Relationship Id="image" Type="${r}/image" Target="../media/image1.bin"/></Relationships>`);
  zip.file("ppt/theme/theme1.xml", "<theme>untouched theme</theme>");
  return zip.generateAsync({ type: "uint8array" });
}
