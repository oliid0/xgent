import { TokenMetadata } from "monaco-editor/editor/common/encodedTokenAttributes.js";
import { TokenTheme } from "monaco-editor/editor/common/languages/supports/tokenization.js";
import type {
  SyntaxState,
  SyntaxToken,
} from "monaco-editor/editor/standalone/common/monarch/monarchLexer.js";
import { vs, vs_dark } from "monaco-editor/editor/standalone/common/themes.js";
import { workspaceSyntaxProvider } from "./workspaceSyntaxProviders";

export type WorkspaceSyntaxStyle = { color: string; fontStyle: number };
export type WorkspaceSyntax = {
  source: string;
  languageId: string;
  revision: number;
  styles: { light: WorkspaceSyntaxStyle; dark: WorkspaceSyntaxStyle }[];
  runs: [number, number, number][];
};
type Line = { content: string; offset: number };
type CachedLine = { content: string; state: SyntaxState; end: SyntaxState; tokens: SyntaxToken[] };
const light = TokenTheme.createFromRawTokenTheme(vs.rules, []);
const dark = TokenTheme.createFromRawTokenTheme(vs_dark.rules, []);
const lightColors = light.getColorMap(),
  darkColors = dark.getColorMap();
const styleCache = new Map<string, { light: WorkspaceSyntaxStyle; dark: WorkspaceSyntaxStyle }>();
function style(type: string) {
  let found = styleCache.get(type);
  if (found) return found;
  const appearance = (theme: TokenTheme, colors: { toString(): string }[]) => {
    const value = theme.match(0, type);
    return {
      color: colors[TokenMetadata.getForeground(value)].toString(),
      fontStyle: TokenMetadata.getFontStyle(value),
    };
  };
  found = { light: appearance(light, lightColors), dark: appearance(dark, darkColors) };
  styleCache.set(type, found);
  return found;
}
function lines(source: string): Line[] {
  const result: Line[] = [];
  let offset = 0;
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    result.push({ content: source.slice(offset, match.index), offset });
    offset = match.index + match[0].length;
  }
  result.push({ content: source.slice(offset), offset });
  return result;
}

/** Incremental lexical state belongs to one cached workspace file session. */
export class WorkspaceSyntaxController {
  private cached: CachedLine[] = [];
  private snapshot: WorkspaceSyntax | null = null;
  private revision = 0;
  // Exposed for regression evidence that unchanged suffixes are actually reused.
  tokenizedLines = 0;
  refresh(source: string, languageId: string): WorkspaceSyntax {
    if (this.snapshot?.source === source && this.snapshot.languageId === languageId)
      return this.snapshot;
    const sameLanguage = this.snapshot?.languageId === languageId;
    const previous = sameLanguage ? this.cached : [];
    const input = lines(source),
      provider = workspaceSyntaxProvider(languageId);
    const next: CachedLine[] = [];
    let prefix = 0,
      suffix = 0;
    while (
      prefix < input.length &&
      prefix < previous.length &&
      input[prefix].content === previous[prefix].content
    )
      prefix++;
    while (
      suffix < input.length - prefix &&
      suffix < previous.length - prefix &&
      input[input.length - 1 - suffix].content === previous[previous.length - 1 - suffix].content
    )
      suffix++;
    this.tokenizedLines = 0;
    if (provider) {
      let state = provider.getInitialState();
      for (let i = 0; i < input.length; i++) {
        const prior =
          i < prefix
            ? previous[i]
            : i >= input.length - suffix
              ? previous[i + previous.length - input.length]
              : undefined;
        if (prior && state.equals(prior.state)) {
          next.push(prior);
          state = prior.end;
          continue;
        }
        const result = provider.tokenize(input[i].content, true, state);
        next.push({
          content: input[i].content,
          state,
          end: result.endState,
          tokens: result.tokens,
        });
        state = result.endState;
        this.tokenizedLines++;
      }
    }
    const styles: WorkspaceSyntax["styles"] = [],
      runs: WorkspaceSyntax["runs"] = [];
    const ids = new Map<string, number>();
    for (let i = 0; i < input.length; i++) {
      const line = input[i],
        tokens = next[i]?.tokens ?? [];
      const add = (start: number, end: number, type: string) => {
        if (end <= start) return;
        const value = style(type),
          key = JSON.stringify(value);
        let id = ids.get(key);
        if (id === undefined) {
          id = styles.length;
          ids.set(key, id);
          styles.push(value);
        }
        const offset = line.offset + start,
          prior = runs.at(-1);
        if (prior && prior[2] === id && prior[0] + prior[1] === offset) prior[1] += end - start;
        else runs.push([offset, end - start, id]);
      };
      add(0, tokens[0]?.offset ?? line.content.length, "");
      for (let j = 0; j < tokens.length; j++)
        add(tokens[j].offset, tokens[j + 1]?.offset ?? line.content.length, tokens[j].type);
    }
    this.cached = next;
    this.snapshot = { source, languageId, revision: ++this.revision, styles, runs };
    return this.snapshot;
  }
}
