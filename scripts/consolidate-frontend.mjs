import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiRoot = path.join(repoRoot, "crates", "agent-gui", "src");
const gatewayRoot = path.join(repoRoot, "crates", "agent-gateway", "web");
const webRoot = path.join(gatewayRoot, "src");
const platformRoot = path.join(guiRoot, "platforms", "web");
const runtimeRoot = path.join(platformRoot, "runtime");
const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css"];
const rewriteExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function assertInsideWorkspace(target, label) {
  const resolved = path.resolve(target);
  const prefix = `${repoRoot}${path.sep}`;
  if (resolved !== repoRoot && !resolved.startsWith(prefix)) {
    throw new Error(`${label} is outside the repository: ${resolved}`);
  }
}

for (const [target, label] of [
  [guiRoot, "GUI source root"],
  [webRoot, "Gateway source root"],
  [platformRoot, "Web platform target"],
]) {
  assertInsideWorkspace(target, label);
}

if (!existsSync(guiRoot) || !existsSync(webRoot)) {
  throw new Error("Expected both existing frontend source roots before consolidation");
}
if (existsSync(platformRoot)) {
  throw new Error(`Refusing to overwrite existing platform source: ${platformRoot}`);
}

function walkFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(root, absolute));
    else if (entry.isFile()) files.push(path.relative(root, absolute).replaceAll(path.sep, "/"));
  }
  return files.sort();
}

function digest(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const guiFiles = new Set(walkFiles(guiRoot));
const webFiles = walkFiles(webRoot);
const sharedFiles = new Set(
  webFiles.filter((relative) => {
    if (!guiFiles.has(relative)) return false;
    return digest(path.join(guiRoot, relative)) === digest(path.join(webRoot, relative));
  }),
);

function resolveLogicalImport(fromRelative, specifier) {
  const cleanSpecifier = specifier.split("?")[0];
  let base;
  if (cleanSpecifier.startsWith("@/")) {
    base = cleanSpecifier.slice(2);
  } else if (cleanSpecifier.startsWith(".")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRelative), cleanSpecifier));
  } else {
    return null;
  }

  const candidates = [];
  if (path.posix.extname(base)) candidates.push(base);
  else {
    candidates.push(base);
    for (const extension of sourceExtensions) candidates.push(`${base}${extension}`);
    for (const extension of sourceExtensions) candidates.push(path.posix.join(base, `index${extension}`));
  }
  return candidates.find((candidate) => webFiles.includes(candidate)) ?? null;
}

function withoutSourceExtension(relative) {
  const extension = path.posix.extname(relative);
  return sourceExtensions.includes(extension) ? relative.slice(0, -extension.length) : relative;
}

function rewriteSpecifier(fromRelative, specifier) {
  const queryIndex = specifier.indexOf("?");
  const query = queryIndex >= 0 ? specifier.slice(queryIndex) : "";
  const logicalTarget = resolveLogicalImport(fromRelative, specifier);
  if (logicalTarget && sharedFiles.has(logicalTarget)) {
    return `@xagent/shared/${withoutSourceExtension(logicalTarget)}${query}`;
  }
  if (specifier.startsWith("@/")) {
    return `@xagent/web/${specifier.slice(2)}`;
  }
  return specifier;
}

function rewriteModuleSpecifiers(relative, source) {
  const staticImports = /((?:from|import)\s*["'])([^"']+)(["'])/g;
  const dynamicImports = /(import\s*\(\s*["'])([^"']+)(["']\s*\))/g;
  const requires = /(require\s*\(\s*["'])([^"']+)(["']\s*\))/g;
  const replace = (_match, prefix, specifier, suffix) =>
    `${prefix}${rewriteSpecifier(relative, specifier)}${suffix}`;
  return source.replace(staticImports, replace).replace(dynamicImports, replace).replace(requires, replace);
}

mkdirSync(platformRoot, { recursive: true });
let platformFiles = 0;
for (const relative of webFiles) {
  if (sharedFiles.has(relative)) continue;
  const sourcePath = path.join(webRoot, relative);
  const targetPath = path.join(platformRoot, relative);
  assertInsideWorkspace(targetPath, "Platform source file");
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const extension = path.extname(relative).toLowerCase();
  if (rewriteExtensions.has(extension)) {
    const source = readFileSync(sourcePath, "utf8");
    writeFileSync(targetPath, rewriteModuleSpecifiers(relative, source), "utf8");
  } else {
    writeFileSync(targetPath, readFileSync(sourcePath));
  }
  platformFiles += 1;
}

const legacyRuntimeFiles = {
  "shims/tauriCore.ts": "gatewayInvoke.ts",
  "shims/tauriEvent.ts": "gatewayEvents.ts",
  "shims/tauriOpener.ts": "browserOpener.ts",
};
mkdirSync(runtimeRoot, { recursive: true });
for (const [legacyRelative, targetName] of Object.entries(legacyRuntimeFiles)) {
  const legacyPath = path.join(platformRoot, legacyRelative);
  if (!existsSync(legacyPath)) throw new Error(`Missing legacy runtime adapter: ${legacyRelative}`);
  const targetPath = path.join(runtimeRoot, targetName);
  writeFileSync(targetPath, readFileSync(legacyPath));
  rmSync(legacyPath);
}
const legacyShims = path.join(platformRoot, "shims");
if (existsSync(legacyShims) && readdirSync(legacyShims).length === 0) {
  rmSync(legacyShims, { recursive: true });
}

writeFileSync(
  path.join(runtimeRoot, "index.ts"),
  [
    'export { invoke } from "./gatewayInvoke";',
    'export { listen, type TauriEvent as RuntimeEvent } from "./gatewayEvents";',
    'export { openUrl } from "./browserOpener";',
    "",
  ].join("\n"),
  "utf8",
);

for (const relative of walkFiles(platformRoot)) {
  const file = path.join(platformRoot, relative);
  if (!rewriteExtensions.has(path.extname(file).toLowerCase())) continue;
  const before = readFileSync(file, "utf8");
  const after = before
    .replaceAll('from "@tauri-apps/api/core"', 'from "@xagent/runtime"')
    .replaceAll('from "@tauri-apps/api/event"', 'from "@xagent/runtime"')
    .replaceAll('from "@tauri-apps/plugin-opener"', 'from "@xagent/runtime"')
    .replaceAll("@tauri-apps/* imports", "@xagent/runtime imports");
  if (after !== before) writeFileSync(file, after, "utf8");
}

const thinEntry = [
  "// Gateway build entry only; all React source lives in agent-gui/src.",
  'import "../../../agent-gui/src/platforms/web/main";',
  "",
].join("\n");
rmSync(webRoot, { recursive: true });
mkdirSync(webRoot, { recursive: true });
writeFileSync(path.join(webRoot, "main.tsx"), thinEntry, "utf8");

console.log(
  JSON.stringify(
    {
      sharedFiles: sharedFiles.size,
      platformFiles,
      sourceFilesBefore: webFiles.length,
      gatewaySourceFilesAfter: walkFiles(webRoot).length,
    },
    null,
    2,
  ),
);
