import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "crates/fronted");

function sourceFiles(directory, pattern = /\.[cm]?[jt]sx?$/) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file, pattern);
    return pattern.test(entry.name) ? [file] : [];
  });
}

/** Generates SwiftUI declarations from the checked-in Astryx presentation mapping. */
export function generateNativeComponents(registry) {
  if (!registry || registry.version !== 2 || !Array.isArray(registry.components) || !registry.components.length) {
    throw new Error("Unsupported or empty native mapping");
  }
  if (typeof registry.astryxVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(registry.astryxVersion)) {
    throw new Error("The mapping must declare its verified Astryx version");
  }
  const requiredMetadata = {
    rendering: ["applicationUI", "webContent", "businessState", "liquidGlass", "transportWebView"],
    templates: ["mobileChat", "mobileSidebar", "mobileMore", "activityStrip", "settings", "workspaceFile", "browser", "confirmation"],
    frameworks: ["SwiftUI", "WebKit", "PDFKit", "AVKit", "PhotosUI", "UniformTypeIdentifiers", "EventKit", "Speech", "HealthKit", "UserNotifications", "CloudKit", "MessageUI"],
    tokens: ["--color-accent", "--color-background-body", "--color-background-surface", "--color-text-primary", "--color-text-secondary", "--color-border", "--radius-element", "--radius-container", "--radius-page", "--radius-chat", "--spacing-4", "--size-element-md", "--font-size-base", "--duration-medium", "--ease-standard", "--astryx-theme-xgent-glass-material-surface-opacity"],
  };
  for (const [section, keys] of Object.entries(requiredMetadata)) {
    const values = registry[section];
    if (!values || typeof values !== "object" || keys.some((key) => values[key] == null)) {
      throw new Error(`Incomplete native mapping metadata: ${section}`);
    }
  }
  const contractKeys = ["schema", "unknownComponent", "unknownProperty", "missingRenderer", "stateOwnership", "actionOwnership", "webBoundary"];
  if (!registry.contract || contractKeys.some((key) => typeof registry.contract[key] !== "string" || !registry.contract[key].trim())) {
    throw new Error("Incomplete native mapping contract");
  }
  const nodeProperties = [
    "label", "text", "value", "action", "disabled", "destructive", "prominent", "secure",
    "secondary", "spacing", "padding", "indent", "fill", "alignment", "width", "minWidth",
    "maxWidth", "height", "minHeight", "maxHeight", "maxLines", "wrap", "variant", "size",
    "icon", "selected", "role", "status", "language", "minimum", "maximum", "step", "current",
    "total", "options", "accessibilityLabel", "accessibilityHint", "accessibilityValue", "children",
  ];
  if (!registry.propertyMappings || nodeProperties.some((key) => {
    const entry = registry.propertyMappings[key];
    return typeof entry?.wireType !== "string" || typeof entry?.swift !== "string";
  })) throw new Error("Incomplete native property mappings");
  const tokenTypes = new Set(["color", "length", "duration", "timingFunction", "percentage", "number"]);
  const targets = new Set();
  for (const [name, entry] of Object.entries(registry.tokens)) {
    if (!name.startsWith("--") || typeof entry?.target !== "string" || !entry.target ||
        !tokenTypes.has(entry.type) || !Array.isArray(entry.fallback) || entry.fallback.length !== 2 ||
        targets.has(entry.target)) {
      throw new Error(`Invalid native token mapping: ${name}`);
    }
    targets.add(entry.target);
  }
  const expectedPlatforms = {
    ios: ["SwiftUI", "mobile", false],
    macos: ["SwiftUI", "desktop", true],
    android: ["Astryx", "mobile", false],
    windows: ["Astryx", "desktop", true],
    linux: ["Astryx", "desktop", true],
  };
  for (const [platform, [renderer, formFactor, desktopOnlyFeatures]] of Object.entries(expectedPlatforms)) {
    const entry = registry.platforms?.[platform];
    if (entry?.renderer !== renderer || entry?.formFactor !== formFactor || entry?.desktopOnlyFeatures !== desktopOnlyFeatures) {
      throw new Error(`Invalid native platform mapping: ${platform}`);
    }
  }
  const allowedCatalogKinds = new Set(["primitive", "modifier", "container", "composed", "template", "desktopOnly", "nonVisual"]);
  if (!registry.astryxCatalog || typeof registry.astryxCatalog !== "object" ||
      Object.keys(registry.astryxCatalog).length === 0) {
    throw new Error("Missing Astryx catalog mapping");
  }
  for (const [moduleName, entry] of Object.entries(registry.astryxCatalog)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(moduleName) || typeof entry?.swiftUI !== "string" || !entry.swiftUI.trim() || !allowedCatalogKinds.has(entry.kind)) {
      throw new Error(`Invalid Astryx catalog mapping: ${moduleName}`);
    }
  }
  const kinds = new Set();
  const cases = new Set();
  for (const entry of registry.components) {
    if (!entry || !/^[A-Z][A-Za-z]+$/.test(entry.kind) || !/^[a-z][A-Za-z]+$/.test(entry.swiftCase) ||
        typeof entry.astryx !== "string" || !/^[A-Z][A-Za-z]+\/[A-Z][A-Za-z]+$/.test(entry.astryx) ||
        typeof entry.declaration !== "string" || !entry.declaration.trim()) {
      throw new Error("Invalid native component mapping");
    }
    if (kinds.has(entry.kind) || cases.has(entry.swiftCase)) throw new Error(`Duplicate mapping: ${entry.kind}`);
    kinds.add(entry.kind);
    cases.add(entry.swiftCase);
  }
  const strategyByKind = new Map();
  for (const [strategy, descriptor] of Object.entries(registry.renderStrategies ?? {})) {
    if (!/^[a-z][A-Za-z]+$/.test(strategy) || typeof descriptor?.policy !== "string" ||
        !Array.isArray(descriptor.kinds)) {
      throw new Error(`Invalid native render strategy: ${strategy}`);
    }
    for (const kind of descriptor.kinds) {
      if (!kinds.has(kind) || strategyByKind.has(kind)) {
        throw new Error(`Invalid render strategy kind: ${kind}`);
      }
      strategyByKind.set(kind, strategy);
    }
  }
  if ([...kinds].some((kind) => !strategyByKind.has(kind))) {
    throw new Error("Incomplete native render strategy coverage");
  }
  const eventsByKind = new Map([...kinds].map((kind) => [kind, []]));
  for (const [event, descriptor] of Object.entries(registry.eventMappings ?? {})) {
    if (!/^[a-z][A-Za-z]+$/.test(event) || typeof descriptor?.payload !== "string" ||
        !Array.isArray(descriptor.kinds)) {
      throw new Error(`Invalid native event mapping: ${event}`);
    }
    for (const kind of descriptor.kinds) {
      if (!eventsByKind.has(kind)) throw new Error(`Invalid event mapping kind: ${kind}`);
      eventsByKind.get(kind).push(event);
    }
  }
  const header = "// Generated by scripts/generate-native-ui.mjs from presentation/astryx-swiftui.json.\n// Edit the mapping, not this file.\n";
  const swift = `${header}import SwiftUI\n\nenum XgentRenderStrategy: String {\n${Object.keys(registry.renderStrategies).map((strategy) => `    case ${strategy}`).join("\n")}\n}\n\nenum XgentMappedProperty: String, CaseIterable {\n${nodeProperties.map((property) => `    case ${property}`).join("\n")}\n}\n\nenum XgentNodeKind: String, Decodable {\n${registry.components.map((entry) =>
    `    case ${entry.swiftCase} = "${entry.kind}"`).join("\n")}\n}\n\nextension XgentNodeKind {\n    var renderStrategy: XgentRenderStrategy {\n        switch self {\n${Object.entries(registry.renderStrategies).map(([strategy, descriptor]) => `        case ${descriptor.kinds.map((kind) => `.${registry.components.find((entry) => entry.kind === kind).swiftCase}`).join(", ")}: return .${strategy}`).join("\n")}\n        }\n    }\n\n    var eventSemantics: Set<String> {\n        switch self {\n${registry.components.map((entry) => `        case .${entry.swiftCase}: return Set([${eventsByKind.get(entry.kind).map((event) => `"${event}"`).join(", ")}])`).join("\n")}\n        }\n    }\n}\n\nextension XgentNodeView {\n    @ViewBuilder var generatedContent: some View {\n        switch node.kind {\n${registry.components.map((entry) =>
    `        case .${entry.swiftCase}:\n${entry.declaration.split("\n").map((line) => `            ${line}`).join("\n")}`).join("\n")}\n        }\n    }\n}\n`;
  const types = `${header}export type PresentationKind =\n${registry.components.map((entry) => `  | "${entry.kind}"`).join("\n")};\n\nexport type PresentationRenderStrategy = ${Object.keys(registry.renderStrategies).map((strategy) => `"${strategy}"`).join(" | ")};\n\nexport const presentationMappedProperties = [\n${nodeProperties.map((property) => `  "${property}",`).join("\n")}\n] as const;\n\nexport const presentationComponentContracts: Record<\n  PresentationKind,\n  { strategy: PresentationRenderStrategy; events: readonly string[] }\n> = {\n${registry.components.map((entry) => `  ${entry.kind}: { strategy: "${strategyByKind.get(entry.kind)}", events: [${eventsByKind.get(entry.kind).map((event) => `"${event}"`).join(", ")}] },`).join("\n")}\n};\n`;
  const tokens = `${header}export const presentationTokenMappings = {\n${Object.entries(registry.tokens).map(([name, entry]) => `  "${name}": {\n    target: ${JSON.stringify(entry.target)},\n    type: ${JSON.stringify(entry.type)},\n    fallback: [${entry.fallback.map((value) => JSON.stringify(value)).join(", ")}],\n  },`).join("\n")}\n} as const;\n\nexport type PresentationTokenName = keyof typeof presentationTokenMappings;\n`;
  return { swift, types, tokens };
}

export function runGeneration({ check = false } = {}) {
  const registry = JSON.parse(readFileSync(path.join(frontend, "presentation/astryx-swiftui.json"), "utf8"));
  const installed = JSON.parse(readFileSync(path.join(frontend, "node_modules/@astryxdesign/core/package.json"), "utf8"));
  if (installed.version !== registry.astryxVersion) {
    throw new Error(`Review the native mapping for Astryx ${installed.version}; it currently targets ${registry.astryxVersion}`);
  }
  const presentationTypes = readFileSync(path.join(frontend, "src/presentation/types.ts"), "utf8");
  const nodeType = presentationTypes.match(/export type PresentationNode = \{([\s\S]*?)\n\};/)?.[1] ?? "";
  const serializedProperties = [...nodeType.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\??:/gm)]
    .map((match) => match[1]).filter((name) => name !== "id" && name !== "kind");
  const mappedProperties = Object.keys(registry.propertyMappings);
  const missingProperties = serializedProperties.filter((name) => !mappedProperties.includes(name));
  const staleProperties = mappedProperties.filter((name) => !serializedProperties.includes(name));
  if (missingProperties.length || staleProperties.length) {
    throw new Error(`Presentation property mappings differ from the wire type: missing=${missingProperties.join(",")}; stale=${staleProperties.join(",")}`);
  }
  const importedModules = new Set(
    sourceFiles(path.join(frontend, "src")).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/@astryxdesign\/core\/([A-Za-z0-9_-]+)/g)].map((match) => match[1]),
    ),
  );
  const missingCatalogModules = [...importedModules].filter((moduleName) => !registry.astryxCatalog[moduleName]);
  if (missingCatalogModules.length) {
    throw new Error(`Astryx modules need SwiftUI mappings: ${missingCatalogModules.sort().join(", ")}`);
  }
  for (const moduleName of Object.keys(registry.astryxCatalog)) {
    if (!installed.exports?.[`./${moduleName}`]) throw new Error(`Astryx does not export catalog module ${moduleName}`);
  }
  for (const entry of registry.components) {
    const [moduleName, componentName] = entry.astryx.split("/");
    const exported = installed.exports?.[`./${moduleName}`];
    if (!exported?.types) throw new Error(`Astryx does not export ${moduleName}`);
    const declarations = readFileSync(path.join(frontend, "node_modules/@astryxdesign/core", exported.types), "utf8");
    const names = [...declarations.matchAll(/export\s*\{([^}]+)\}/g)].flatMap((match) =>
      match[1].split(",").map((name) => name.trim().replace(/^type\s+/, "")));
    if (!names.includes(componentName)) throw new Error(`Astryx does not export ${entry.astryx}`);
  }
  const swiftImplementations = sourceFiles(path.join(frontend, "src-tauri/native/apple-ui"), /\.swift$/)
    .filter((file) => !file.endsWith("PresentationComponents.generated.swift"))
    .map((file) => readFileSync(file, "utf8")).join("\n");
  for (const entry of registry.components) {
    if (/^[a-z][A-Za-z]+$/.test(entry.declaration) &&
        !new RegExp(`\\b(?:var|func)\\s+${entry.declaration}\\b`).test(swiftImplementations)) {
      throw new Error(`Missing SwiftUI renderer implementation: ${entry.declaration}`);
    }
  }
  const generated = generateNativeComponents(registry);
  for (const [relative, content] of [
    ["src-tauri/native/apple-ui/PresentationComponents.generated.swift", generated.swift],
    ["src/presentation/kinds.generated.ts", generated.types],
    ["src/presentation/tokens.generated.ts", generated.tokens],
  ]) {
    const file = path.join(frontend, relative);
    if (check) {
      if (readFileSync(file, "utf8").replaceAll("\r\n", "\n") !== content) throw new Error(`Stale native mapping: ${relative}`);
    } else { writeFileSync(file, content); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runGeneration({ check: process.argv.includes("--check") });
  console.log(process.argv.includes("--check") ? "Native component mapping is current" : "Generated native component declarations");
}
