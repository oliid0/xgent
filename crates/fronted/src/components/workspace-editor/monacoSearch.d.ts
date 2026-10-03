declare module "monaco-editor/editor/common/model/textModelSearch.js" {
  export class SearchParams {
    constructor(query: string, regex: boolean, matchCase: boolean, separators: string | null);
    parseSearchRequest(): unknown | null;
  }
  export interface SearchRange {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    getStartPosition(): { lineNumber: number; column: number };
  }
  export interface SearchModel {
    getLineContent(line: number): string;
    getLineCount(): number;
    getLineMaxColumn(line: number): number;
    getValueInRange(range: SearchRange, preference: number): string;
    getOffsetAt(position: { lineNumber: number; column: number }): number;
    getPositionAt(offset: number): { lineNumber: number; column: number };
    getEOL(): string;
  }
  export class TextModelSearch {
    static findMatches(
      model: SearchModel,
      params: SearchParams,
      range: SearchRange,
      capture: boolean,
      limit: number,
    ): { range: SearchRange; matches: string[] | null }[];
  }
}
declare module "monaco-editor/editor/common/core/range.js" {
  export class Range {
    constructor(startLine: number, startColumn: number, endLine: number, endColumn: number);
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    getStartPosition(): { lineNumber: number; column: number };
  }
}
declare module "monaco-editor/editor/common/core/wordHelper.js" {
  export const USUAL_WORD_SEPARATORS: string;
}
declare module "monaco-editor/editor/contrib/find/browser/replacePattern.js" {
  export class ReplacePattern {
    static fromStaticValue(value: string): ReplacePattern;
    buildReplaceString(matches: string[] | null, preserveCase?: boolean): string;
  }
  export function parseReplaceString(value: string): ReplacePattern;
}
