import { SYNC_TOKENIZE_THRESHOLD, tokenize, tokenizeAsync } from "@astryxdesign/core/CodeBlock";
import { syntaxTokenDefaults } from "@astryxdesign/core/theme/syntax";
import { resolveThemeTokens } from "@astryxdesign/core/theme/tokens";
import type { AppSettings } from "../lib/settings";
import { createAppearanceTheme } from "../theme/appearanceTheme";
import { cssColor } from "./nativeColor";
import type { PresentationHandler, PresentationNode, PresentationValue } from "./types";

type ColorPair = { light: string; dark: string };
type Palette = { styles: ColorPair[]; types: string[]; signature: string };
const identities = new Map<string, string>();
let nextIdentity = 0;

export function readOnlySyntaxPalette(settings: AppSettings, compact: boolean): Palette {
  const theme = createAppearanceTheme(settings.customSettings.appearance, compact);
  const light = resolveThemeTokens(theme, { mode: "light" });
  const dark = resolveThemeTokens(theme, { mode: "dark" });
  const names = Object.keys(syntaxTokenDefaults);
  const styles = names.map((name) => ({
    light: cssColor(light[name], "#000000"),
    dark: cssColor(dark[name], "#ffffff"),
  }));
  const key = JSON.stringify(styles);
  let signature = identities.get(key);
  if (!signature) {
    signature = `read-only-syntax-${++nextIdentity}`;
    identities.set(key, signature);
    if (identities.size > 32) identities.delete(identities.keys().next().value as string);
  }
  return { styles, types: names.map((name) => name.replace("--color-syntax-", "")), signature };
}

function request(value: PresentationValue): { source: string; language: string } | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    if (
      parsed &&
      typeof parsed.source === "string" &&
      typeof parsed.language === "string" &&
      parsed.language.length > 0 &&
      parsed.language.length <= 256
    )
      return parsed;
  } catch {
    /* Invalid read-only requests have no side effect. */
  }
  return undefined;
}

export async function readOnlySyntax(source: string, language: string, palette: Palette) {
  const lines =
    source.length <= SYNC_TOKENIZE_THRESHOLD
      ? tokenize(source, language)
      : await tokenizeAsync(source, language);
  const runs: number[][] = [];
  let offset = 0;
  for (const line of lines) {
    const end = source.indexOf("\n", offset);
    const lineEnd = end < 0 ? source.length : end;
    for (const token of line) {
      const style = palette.types.indexOf(token.type);
      // The actual CodeBlock range/span renderers clip each token to its
      // visible line. Multiline regex matches can otherwise overlap later rows.
      const start = Math.max(0, token.start);
      const finish = Math.min(token.end, lineEnd - offset);
      if (style >= 0 && finish > start) runs.push([offset + start, finish - start, style]);
    }
    offset = end < 0 ? source.length : end + 1;
  }
  return {
    source,
    language,
    theme: palette.signature,
    styles: palette.styles,
    runs,
    baseStyle: palette.types.indexOf("variable"),
    backgroundStyle: palette.types.indexOf("background"),
  };
}

export function attachReadOnlySyntax(
  nodes: PresentationNode[],
  handlers: Map<string, PresentationHandler>,
  palette: Palette,
): PresentationNode[] {
  return nodes.map((node) => {
    const children = node.children
      ? attachReadOnlySyntax(node.children, handlers, palette)
      : undefined;
    if (node.kind !== "Markdown" && node.kind !== "CodeBlock")
      return children ? { ...node, children } : node;
    const action = `${node.id}:highlight-code`;
    const policy = typeof node.value === "string" ? JSON.parse(node.value) : {};
    handlers.set(action, {
      enabled: true,
      accepts: (value) => request(value) !== undefined,
      run: async (value) => {
        const input = request(value);
        if (!input) throw new Error("Invalid code highlighting request.");
        return JSON.stringify(await readOnlySyntax(input.source, input.language, palette));
      },
      resultValue: (value) => {
        if (typeof value !== "string") throw new Error("Invalid code highlighting reply.");
        return value;
      },
    });
    return {
      ...node,
      children,
      action,
      value: JSON.stringify({
        ...policy,
        syntaxTheme: palette.signature,
        syntaxBackground: palette.styles[palette.types.indexOf("background")],
        syntaxComment: palette.styles[palette.types.indexOf("comment")],
        syntaxForeground: palette.styles[palette.types.indexOf("variable")],
      }),
    };
  });
}
