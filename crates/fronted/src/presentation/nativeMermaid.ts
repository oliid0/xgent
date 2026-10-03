import { nativeDiagramSvg } from "./nativeDiagramSvg";
import type { PresentationValue } from "./types";

export function nativeDiagramRequest(
  value: PresentationValue,
): { source: string; dark: boolean } | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const request = JSON.parse(value);
    if (
      typeof request?.source === "string" &&
      request.source.trim() &&
      request.source.length <= 50_000 &&
      typeof request.dark === "boolean"
    )
      return request;
  } catch {
    /* Read-only diagram requests have no side effect. */
  }
  return undefined;
}

let nextId = 0;
let pending = Promise.resolve();

export function renderNativeDiagram(source: string, dark: boolean): Promise<string> {
  // Mermaid owns global configuration. Serialize light/dark rendering requests.
  const result = pending.then(async () => {
    const { mermaid } = await import("@streamdown/mermaid");
    const renderer = mermaid.getMermaid({
      theme: dark ? "dark" : "default",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      securityLevel: "strict",
      suppressErrorRendering: true,
    });
    try {
      const { svg } = await renderer.render(`xgent-native-diagram-${++nextId}`, source);
      return JSON.stringify({ source, dark, svg: nativeDiagramSvg(svg) });
    } catch (error) {
      return JSON.stringify({
        source,
        dark,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  pending = result.then(
    () => {},
    () => {},
  );
  return result;
}
