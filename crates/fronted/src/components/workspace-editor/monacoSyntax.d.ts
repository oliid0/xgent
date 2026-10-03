declare module "monaco-editor/languages/definitions/*" {
  export const language: unknown;
}
declare module "monaco-editor/editor/standalone/common/monarch/monarchCompile.js" {
  export function compile(languageId: string, definition: unknown): unknown;
}
declare module "monaco-editor/editor/standalone/common/monarch/monarchLexer.js" {
  export interface SyntaxState {
    equals(other: SyntaxState): boolean;
    clone(): SyntaxState;
  }
  export type SyntaxToken = { offset: number; type: string; language: string };
  export interface SyntaxProvider {
    getInitialState(): SyntaxState;
    tokenize(
      line: string,
      hasEOL: boolean,
      state: SyntaxState,
    ): { tokens: SyntaxToken[]; endState: SyntaxState };
  }
  export class MonarchTokenizer implements SyntaxProvider {
    constructor(
      languageService: object,
      themeService: object,
      languageId: string,
      lexer: unknown,
      configurationService: object,
    );
    getInitialState(): SyntaxState;
    tokenize(
      line: string,
      hasEOL: boolean,
      state: SyntaxState,
    ): { tokens: SyntaxToken[]; endState: SyntaxState };
  }
}
declare module "monaco-editor/editor/common/languages.js" {
  import type { SyntaxProvider } from "monaco-editor/editor/standalone/common/monarch/monarchLexer.js";
  export const TokenizationRegistry: {
    register(languageId: string, support: SyntaxProvider): { dispose(): void };
  };
}
declare module "monaco-editor/languages/features/json/tokenization.js" {
  import type { SyntaxState } from "monaco-editor/editor/standalone/common/monarch/monarchLexer.js";
  export function createTokenizationSupport(comments: boolean): {
    getInitialState(): SyntaxState;
    tokenize(
      line: string,
      state: SyntaxState,
    ): { tokens: { startIndex: number; scopes: string }[]; endState: SyntaxState };
  };
}
declare module "monaco-editor/editor/standalone/common/themes.js" {
  export const vs: { rules: unknown[] };
  export const vs_dark: { rules: unknown[] };
}
declare module "monaco-editor/editor/common/languages/supports/tokenization.js" {
  export class TokenTheme {
    static createFromRawTokenTheme(rules: unknown[], colors: string[]): TokenTheme;
    match(languageId: number, token: string): number;
    getColorMap(): { toString(): string }[];
  }
}
declare module "monaco-editor/editor/common/encodedTokenAttributes.js" {
  export const TokenMetadata: {
    getForeground(metadata: number): number;
    getFontStyle(metadata: number): number;
  };
}
