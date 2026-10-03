import {
  applyWorkspaceFindEdit,
  validWorkspaceFindRange,
  type WorkspaceFindEdit,
  type WorkspaceFindOptions,
  type WorkspaceFindRange,
  workspaceFind,
  workspaceFindDefaults,
  workspaceFindReplacement,
} from "../components/workspace-editor/workspaceFind";

export type NativeWorkspaceFindCommand = {
  kind: "workspaceFind";
  command:
    | "open"
    | "openReplace"
    | "query"
    | "next"
    | "previous"
    | "replace"
    | "replaceAll"
    | "close"
    | "ack";
  content: string;
  query: string;
  replacement: string;
  options: WorkspaceFindOptions;
  selections: WorkspaceFindRange[];
  editRequest?: number;
  applied?: boolean;
};
export function parseNativeWorkspaceFind(value: unknown): NativeWorkspaceFindCommand | null {
  if (typeof value !== "string") return null;
  try {
    const data = JSON.parse(value) as NativeWorkspaceFindCommand;
    return data?.kind === "workspaceFind" &&
      [
        "open",
        "openReplace",
        "query",
        "next",
        "previous",
        "replace",
        "replaceAll",
        "close",
        "ack",
      ].includes(data.command) &&
      typeof data.content === "string" &&
      typeof data.query === "string" &&
      typeof data.replacement === "string" &&
      data.options &&
      Object.keys(workspaceFindDefaults).every(
        (key) => typeof data.options[key as keyof WorkspaceFindOptions] === "boolean",
      ) &&
      Array.isArray(data.selections) &&
      data.selections.length <= 1000 &&
      data.selections.every((range) => validWorkspaceFindRange(range, data.content.length)) &&
      (data.command !== "ack" ||
        (Number.isSafeInteger(data.editRequest) && typeof data.applied === "boolean"))
      ? data
      : null;
  } catch {
    return null;
  }
}

export class NativeWorkspaceFind {
  open = false;
  replacing = false;
  query = "";
  replacement = "";
  options = { ...workspaceFindDefaults };
  scopes: WorkspaceFindRange[] = [];
  count = 0;
  current = 0;
  invalid = false;
  limited = false;
  rejected = false;
  revision = 0;
  reveal: (WorkspaceFindRange & { request: number; before: string }) | null = null;
  edit: (WorkspaceFindEdit & { request: number; before: string }) | null = null;
  private source = "";
  private matches: WorkspaceFindRange[] = [];
  private decorationRevision = 0;
  private replacingAll = false;

  refresh(source: string) {
    if (source !== this.source && this.scopes.length) {
      let start = 0,
        oldEnd = this.source.length,
        newEnd = source.length;
      while (start < oldEnd && start < newEnd && this.source[start] === source[start]) start++;
      while (oldEnd > start && newEnd > start && this.source[oldEnd - 1] === source[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      const delta = newEnd - oldEnd;
      this.scopes = this.scopes.map((range) => {
        const end = range.location + range.length;
        const location =
          range.location <= start
            ? range.location
            : range.location >= oldEnd
              ? range.location + delta
              : start;
        const nextEnd = end < start ? end : end >= oldEnd ? end + delta : newEnd;
        return { location, length: Math.max(0, nextEnd - location) };
      });
    }
    this.source = source;
    const result = workspaceFind(source, this.query, this.options, this.scopes);
    this.matches = result.matches.map(({ location, length }) => ({ location, length }));
    this.decorationRevision++;
    this.count = result.matches.length;
    this.invalid = result.invalid;
    this.limited = result.limited;
    this.current = this.reveal
      ? result.matches.findIndex(
          (match) =>
            match.location === this.reveal?.location && match.length === this.reveal?.length,
        ) + 1
      : 0;
  }
  dispatch(input: NativeWorkspaceFindCommand): boolean {
    if (input.command === "ack") {
      if (!this.edit || this.edit.request !== input.editRequest) return false;
      const edit = this.edit;
      this.rejected = !input.applied || input.content !== applyWorkspaceFindEdit(edit.before, edit);
      this.edit = null;
      this.refresh(input.content);
      this.revision++;
      if (!this.rejected && !this.replacingAll) {
        const matches = workspaceFind(
          input.content,
          this.query,
          this.options,
          this.scopes,
          1073741824,
        ).matches;
        const next =
          matches.find(
            (match) =>
              match.location >=
              edit.location + edit.text.length + (edit.length === 0 && !edit.text.length ? 1 : 0),
          ) ?? matches[0];
        if (next) {
          this.reveal = {
            location: next.location,
            length: next.length,
            request: this.revision,
            before: input.content,
          };
          this.current = matches.indexOf(next) + 1;
        }
      }
      return true;
    }
    this.refresh(input.content);
    const oldSelection = this.options.selection;
    const changed =
      this.query !== input.query || JSON.stringify(this.options) !== JSON.stringify(input.options);
    this.query = input.query;
    if ((input.command === "open" || input.command === "openReplace") && !this.query) {
      const range = input.selections[0];
      const selected = range
        ? input.content.slice(range.location, range.location + range.length)
        : "";
      if (selected && !/[\r\n]/.test(selected)) this.query = selected;
    }
    this.replacement = input.replacement;
    this.options = { ...input.options };
    if (!oldSelection && input.options.selection)
      this.scopes = input.selections
        .filter((range) => range.length > 0)
        .map((range) => ({ ...range }));
    if (input.command === "close") this.open = false;
    else this.open = true;
    if (input.command === "openReplace") this.replacing = true;
    if (input.command === "open") this.replacing = false;
    this.refresh(input.content);
    this.revision++;
    if (input.command === "close" || this.invalid || !this.query) return true;
    const result = workspaceFind(
      this.source,
      this.query,
      this.options,
      this.scopes,
      input.command === "query" || input.command === "open" || input.command === "openReplace"
        ? 19999
        : 1073741824,
    );
    if (!result.matches.length) {
      this.current = 0;
      return true;
    }
    const selection = input.selections[0] ?? { location: 0, length: 0 };
    const exact = result.matches.findIndex(
      (match) => match.location === selection.location && match.length === selection.length,
    );
    let index: number;
    if (input.command === "previous") {
      index = -1;
      for (let i = result.matches.length - 1; i >= 0; i--) {
        if (result.matches[i].location < selection.location) {
          index = i;
          break;
        }
      }
      if (index < 0) index = result.matches.length - 1;
    } else if (input.command === "next" && !changed && exact >= 0)
      index = (exact + 1) % result.matches.length;
    else {
      index = result.matches.findIndex((match) => match.location >= selection.location);
      if (index < 0) index = 0;
    }
    if ((input.command === "replace" || input.command === "replaceAll") && !this.edit) {
      // Replace-one first selects a match when the caret is not on a match.
      // A second invocation then replaces that exact selection, like Monaco.
      if (input.command === "replaceAll" || exact >= 0) {
        const edit = workspaceFindReplacement(
          this.source,
          input.command === "replaceAll" ? result.matches : [result.matches[exact]],
          this.replacement,
          this.options,
        );
        if (edit) {
          this.edit = { ...edit, request: this.revision, before: this.source };
          this.replacingAll = input.command === "replaceAll";
        }
      }
    }
    const match = result.matches[index];
    this.reveal = {
      location: match.location,
      length: match.length,
      request: this.revision,
      before: this.source,
    };
    this.current = index + 1;
    this.rejected = false;
    return true;
  }
  metadata(identity: string) {
    return {
      identity,
      open: this.open,
      replacing: this.replacing,
      query: this.query,
      replacement: this.replacement,
      options: this.options,
      count: this.count,
      current: this.current,
      invalid: this.invalid,
      limited: this.limited,
      rejected: this.rejected,
      hasSelection: this.scopes.some((range) => range.length > 0),
      revision: this.revision,
      reveal: this.reveal,
      edit: this.edit,
      decorations:
        this.open && !this.invalid && (this.matches.length > 0 || this.options.selection)
          ? {
              source: this.source,
              matches: this.matches,
              scopes: this.options.selection ? this.scopes : [],
              revision: this.decorationRevision,
            }
          : null,
    };
  }
}
