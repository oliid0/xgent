import { Range } from "monaco-editor/editor/common/core/range.js";
import { USUAL_WORD_SEPARATORS } from "monaco-editor/editor/common/core/wordHelper.js";
import {
  type SearchModel,
  SearchParams,
  TextModelSearch,
} from "monaco-editor/editor/common/model/textModelSearch.js";
import {
  parseReplaceString,
  ReplacePattern,
} from "monaco-editor/editor/contrib/find/browser/replacePattern.js";

export type WorkspaceFindRange = { location: number; length: number };
export type WorkspaceFindOptions = {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  selection: boolean;
  preserveCase: boolean;
};
export type WorkspaceFindMatch = WorkspaceFindRange & { captures: string[] | null };
export type WorkspaceFindEdit = WorkspaceFindRange & { text: string };
export const workspaceFindDefaults: WorkspaceFindOptions = {
  matchCase: false,
  wholeWord: false,
  regex: false,
  selection: false,
  preserveCase: false,
};

// Monaco owns matching, Unicode word boundaries and replacement expressions.
// This adapter translates its line/column ranges to the native editor's UTF-16
// offsets without rewriting the user's CRLF/CR text between replacements.
function searchModel(source: string) {
  const lines = source.split(/\r\n|\r|\n/),
    rawStarts = [0],
    starts = [0];
  const breaks = [...source.matchAll(/\r\n|\r|\n/g)];
  for (let i = 0; i < breaks.length; i++) {
    rawStarts.push(breaks[i].index + breaks[i][0].length);
    starts.push(starts[i] + lines[i].length + 1);
  }
  const canonical = lines.join("\n");
  function position(offset: number, offsets = starts) {
    let low = 0,
      high = offsets.length;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (offsets[mid] <= offset) low = mid;
      else high = mid;
    }
    return { lineNumber: low + 1, column: Math.min(offset - offsets[low], lines[low].length) + 1 };
  }
  const rawOffset = (line: number, column: number) => rawStarts[line - 1] + column - 1;
  const model: SearchModel = {
    getLineContent: (line) => lines[line - 1],
    getLineCount: () => lines.length,
    getLineMaxColumn: (line) => lines[line - 1].length + 1,
    getEOL: () => "\n",
    getOffsetAt: (value) => starts[value.lineNumber - 1] + value.column - 1,
    getPositionAt: (offset) => position(offset),
    getValueInRange: (range) =>
      canonical.slice(
        starts[range.startLineNumber - 1] + range.startColumn - 1,
        starts[range.endLineNumber - 1] + range.endColumn - 1,
      ),
  };
  return { model, rawOffset, rawPosition: (offset: number) => position(offset, rawStarts) };
}

export function validWorkspaceFindRange(value: unknown, size: number): value is WorkspaceFindRange {
  if (!value || typeof value !== "object") return false;
  const range = value as WorkspaceFindRange;
  return (
    Number.isSafeInteger(range.location) &&
    Number.isSafeInteger(range.length) &&
    range.location >= 0 &&
    range.length >= 0 &&
    range.location <= size &&
    range.length <= size - range.location
  );
}

export function workspaceFind(
  source: string,
  query: string,
  options: WorkspaceFindOptions,
  scopes: WorkspaceFindRange[] = [],
  limit = 19999,
): { matches: WorkspaceFindMatch[]; invalid: boolean; limited: boolean } {
  const params = new SearchParams(
    query,
    options.regex,
    options.matchCase,
    options.wholeWord ? USUAL_WORD_SEPARATORS : null,
  );
  if (!query) return { matches: [], invalid: false, limited: false };
  if (!params.parseSearchRequest()) return { matches: [], invalid: true, limited: false };
  const adapter = searchModel(source);
  const ranges = options.selection
    ? scopes.filter((range) => validWorkspaceFindRange(range, source.length) && range.length > 0)
    : [{ location: 0, length: source.length }];
  const sorted = ranges.map((range) => ({ ...range })).sort((a, b) => a.location - b.location);
  const merged: WorkspaceFindRange[] = [];
  for (const range of sorted) {
    const prior = merged.at(-1);
    if (prior && range.location <= prior.location + prior.length)
      prior.length =
        Math.max(prior.location + prior.length, range.location + range.length) - prior.location;
    else merged.push(range);
  }
  const matches: WorkspaceFindMatch[] = [];
  for (const range of merged) {
    const start = adapter.rawPosition(range.location),
      end = adapter.rawPosition(range.location + range.length);
    const found = TextModelSearch.findMatches(
      adapter.model,
      params,
      new Range(start.lineNumber, start.column, end.lineNumber, end.column),
      true,
      limit + 1 - matches.length,
    );
    for (const match of found) {
      const location = adapter.rawOffset(match.range.startLineNumber, match.range.startColumn);
      matches.push({
        location,
        length: adapter.rawOffset(match.range.endLineNumber, match.range.endColumn) - location,
        captures: match.matches,
      });
    }
    if (matches.length > limit) break;
  }
  return { matches: matches.slice(0, limit), invalid: false, limited: matches.length > limit };
}

export function workspaceFindReplacement(
  source: string,
  matches: WorkspaceFindMatch[],
  replacement: string,
  options: WorkspaceFindOptions,
): WorkspaceFindEdit | null {
  if (!matches.length) return null;
  const pattern = options.regex
    ? parseReplaceString(replacement)
    : ReplacePattern.fromStaticValue(replacement);
  const eol = source.match(/\r\n|\r|\n/)?.[0] ?? "\n";
  const first = matches[0],
    last = matches.at(-1) as WorkspaceFindMatch;
  let text = "",
    cursor = first.location;
  for (const match of matches) {
    text += source.slice(cursor, match.location);
    text += pattern
      .buildReplaceString(match.captures, options.preserveCase)
      .replace(/\r\n|\r|\n/g, eol);
    cursor = match.location + match.length;
  }
  return { location: first.location, length: last.location + last.length - first.location, text };
}

export function applyWorkspaceFindEdit(source: string, edit: WorkspaceFindEdit) {
  return source.slice(0, edit.location) + edit.text + source.slice(edit.location + edit.length);
}
