import { invokeFs } from "../lib/tools/fsBackend";

export type NativeComposerMention = {
  text: string;
  start: number;
  end: number;
  query: string;
  trigger: "file" | "skill";
};
export type NativeMentionFile = { path: string; kind: "file" | "dir" };

/** Match the web composer's word-boundary rules using native UTF-16 caret offsets. */
export function detectNativeComposerMention(
  text: string,
  selection: { location: number; length: number },
  skillsEnabled: boolean,
): NativeComposerMention | null {
  const end = selection.location;
  if (selection.length !== 0 || !Number.isSafeInteger(end) || end < 0 || end > text.length)
    return null;
  const boundary = (value: string) => /\s/.test(value) || value === "\u200B";
  for (let start = end - 1; start >= 0; start--) {
    const character = text[start];
    if (
      character === "@" ||
      (character === "/" && skillsEnabled && (start === 0 || boundary(text[start - 1])))
    ) {
      if (start > 0 && !boundary(text[start - 1])) return null;
      const query = text.slice(start + 1, end);
      if (character === "/" && query.includes("/")) return null;
      return { text, start, end, query, trigger: character === "@" ? "file" : "skill" };
    }
    if (boundary(character)) break;
  }
  return null;
}

export function decodeNativeComposerSelection(
  value: string,
): { text: string; location: number; length: number } | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const item = parsed as Record<string, unknown>;
    if (
      typeof item.text !== "string" ||
      typeof item.location !== "number" ||
      typeof item.length !== "number" ||
      !Number.isSafeInteger(item.location) ||
      !Number.isSafeInteger(item.length) ||
      item.location < 0 ||
      item.length < 0 ||
      item.location + item.length > item.text.length
    )
      return null;
    return { text: item.text, location: item.location, length: item.length };
  } catch {
    return null;
  }
}

export function nativeMentionSearchKey(
  conversation: string,
  workdir: string,
  context: NativeComposerMention | null,
): string {
  return JSON.stringify([conversation, workdir, context?.trigger, context?.query, context?.start]);
}

/** FileProvider/Rust searches can complete out of order; only the active menu owns a result. */
export function createNativeMentionSearch(
  load = (workdir: string, query: string) =>
    invokeFs<{ entries: NativeMentionFile[] }>("fs_mention_list", {
      workdir,
      query,
      max_results: 80,
    }),
) {
  let generation = 0;
  let snapshot: { key: string; loading: boolean; entries: NativeMentionFile[]; error: boolean } = {
    key: "",
    loading: false,
    entries: [],
    error: false,
  };
  const listeners = new Set<() => void>();
  const publish = (value: typeof snapshot) => {
    snapshot = value;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel() {
      generation++;
    },
    async search(key: string, workdir: string, context: NativeComposerMention | null) {
      const request = ++generation;
      if (context?.trigger !== "file" || !workdir.trim()) {
        publish({ key, loading: false, entries: [], error: false });
        return;
      }
      publish({ key, loading: true, entries: [], error: false });
      try {
        const result = await load(workdir, context.query);
        if (request !== generation) return;
        const entries = result.entries.filter(
          (item) => typeof item.path === "string" && (item.kind === "file" || item.kind === "dir"),
        );
        publish({ key, loading: false, entries: entries.slice(0, 12), error: false });
      } catch {
        if (request === generation) publish({ key, loading: false, entries: [], error: true });
      }
    },
  };
}
