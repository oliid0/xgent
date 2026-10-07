import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "crates/fronted");

/** Check only state/action compatibility. This never creates UI or chooses components. */
export function validateNativeContracts({ protocol, swiftProtocol, types, model }) {
  const kinds = [...protocol.matchAll(/^  ([A-Z][A-Za-z]+): \{ events:/gm)].map(match => match[1]).sort();
  const swiftKinds = [...swiftProtocol.matchAll(/^    case [a-z][A-Za-z]+ = "([A-Z][A-Za-z]+)"/gm)].map(match => match[1]).sort();
  if (!kinds.length || new Set(kinds).size !== kinds.length || JSON.stringify(kinds) !== JSON.stringify(swiftKinds)) {
    throw new Error("Native state kinds differ between TypeScript and Swift");
  }
  const rawNames = new Map([...swiftProtocol.matchAll(/^    case ([a-z][A-Za-z]+) = "([A-Z][A-Za-z]+)"/gm)]
    .map(match => [match[1], match[2]]));
  const swiftEvents = new Map();
  const eventsBody = swiftProtocol.split("var eventSemantics: Set<String>")[1] ?? "";
  for (const match of eventsBody.matchAll(/case ([.a-zA-Z,\s]+):\s*return \[([^\]]*)\]/g)) {
    const events = [...match[2].matchAll(/"([A-Za-z]+)"/g)].map(value => value[1]).sort();
    for (const member of match[1].matchAll(/\.([a-z][A-Za-z]+)/g)) {
      const name = rawNames.get(member[1]);
      if (!name || swiftEvents.has(name)) throw new Error("Invalid native action event declaration");
      swiftEvents.set(name, events);
    }
  }
  for (const match of protocol.matchAll(/^  ([A-Z][A-Za-z]+): \{ events: \[([^\]]*)\]/gm)) {
    const events = [...match[2].matchAll(/"([A-Za-z]+)"/g)].map(value => value[1]).sort();
    if (JSON.stringify(events) !== JSON.stringify(swiftEvents.get(match[1]) ?? [])) {
      throw new Error(`Native action events differ between TypeScript and Swift: ${match[1]}`);
    }
  }
  const properties = [...(protocol.split("export const presentationNodeProperties = [")[1]?.split("] as const;")[0] ?? "").matchAll(/"([A-Za-z]+)"/g)].map(match => match[1]).sort();
  const wireProperties = [...(types.match(/export type PresentationNode = \{([\s\S]*?)\n\};/)?.[1] ?? "").matchAll(/^  ([A-Za-z]+)\??:/gm)]
    .map(match => match[1]).filter(name => name !== "id" && name !== "kind").sort();
  const swiftProperties = [...(model.match(/struct XgentNode: Decodable, Identifiable \{([\s\S]*?)\n\}/)?.[1] ?? "").matchAll(/^    let ([A-Za-z]+):/gm)]
    .map(match => match[1]).filter(name => name !== "id" && name !== "kind").sort();
  if (!properties.length || new Set(properties).size !== properties.length ||
      JSON.stringify(properties) !== JSON.stringify(wireProperties) || JSON.stringify(properties) !== JSON.stringify(swiftProperties)) {
    throw new Error("Native state properties differ between TypeScript and Swift");
  }
  return { kinds: kinds.length, properties: properties.length };
}

export function checkNativeContracts() {
  const read = relative => readFileSync(path.join(frontend, relative), "utf8");
  const result = validateNativeContracts({
    protocol: read("src/presentation/protocol.ts"),
    swiftProtocol: read("src-tauri/apple/PresentationProtocol.swift"),
    types: read("src/presentation/types.ts"),
    model: read("src-tauri/apple/PresentationModel.swift"),
  });
  for (const retired of ["presentation/astryx-swiftui.json", "src-tauri/apple/PresentationComponents.generated.swift"]) {
    if (existsSync(path.join(frontend, retired))) throw new Error(`Retired UI generation must stay removed: ${retired}`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkNativeContracts();
  console.log(`Native state/action contract passed: ${result.kinds} kinds, ${result.properties} properties; no UI generation`);
}
