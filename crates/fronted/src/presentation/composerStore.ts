import type {
  MentionComposerDraft,
  MentionComposerDraftSegment,
  MentionComposerHandle,
} from "../components/chat/MentionComposer";
import { buildTextFromComposerDraft, createTextComposerDraft } from "../lib/chat/composerDraft";
import { normalizeLogicalLineEndings } from "../lib/chat/messages/composerText";
import { createFileMentionReference } from "../lib/chat/messages/mentionReferences";

/** The native editor implements the existing composer contract, including queued rich drafts. */
export function createNativeComposerStore() {
  let draft = createTextComposerDraft("");
  let focusRevision = 0;
  let version = 0;
  let typingGeneration = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    version++;
    for (const listener of listeners) listener();
  };
  const setDraft = (next: MentionComposerDraft) => {
    typingGeneration++;
    draft = structuredClone(next);
    changed();
  };
  const setSegments = (segments: MentionComposerDraftSegment[]) => {
    const next = { ...draft, segments };
    const text = buildTextFromComposerDraft(next);
    setDraft({
      ...next,
      text,
      textWithoutLargePastes: buildTextFromComposerDraft({
        ...next,
        segments: segments.filter((item) => item.type !== "largePaste"),
      }),
      largePastes: segments.flatMap((item) => (item.type === "largePaste" ? [item.paste] : [])),
      skillMentions: segments.flatMap((item) => (item.type === "skillMention" ? [item.skill] : [])),
      commitMentions: segments.flatMap((item) =>
        item.type === "commitMention" ? [item.commit] : [],
      ),
      gitFileMentions: segments.flatMap((item) =>
        item.type === "gitFileMention" ? [item.file] : [],
      ),
      codeMentions: segments.flatMap((item) =>
        item.type === "codeMention" ? [item.reference] : [],
      ),
      isEmpty: !text.trim(),
    });
  };
  const append = (segment: MentionComposerDraftSegment) => {
    setSegments([
      ...draft.segments,
      segment,
      ...(segment.type === "text" ? [] : [{ type: "text" as const, text: " " }]),
    ]);
  };
  const replaceEditorText = (value: string) => {
    const next = normalizeLogicalLineEndings(value);
    const previous = draft.text;
    if (previous === next) return;
    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start])
      start++;
    let suffix = 0;
    while (
      suffix < previous.length - start &&
      suffix < next.length - start &&
      previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
    )
      suffix++;
    const slice = (from: number, to: number): MentionComposerDraftSegment[] => {
      let offset = 0;
      return draft.segments.flatMap((segment): MentionComposerDraftSegment[] => {
        const text = buildTextFromComposerDraft({ ...draft, segments: [segment] });
        const end = offset + text.length;
        const begin = offset;
        offset = end;
        if (from >= end || to <= begin) return [];
        if (from <= begin && to >= end) return [segment];
        return [{ type: "text", text: text.slice(Math.max(0, from - begin), to - begin) }];
      });
    };
    // Rich mentions and large pastes outside the changed range keep their metadata.
    // Editing inside a token converts only that token's surviving text to plain text.
    setSegments([
      ...slice(0, start),
      { type: "text", text: next.slice(start, next.length - suffix) },
      ...slice(previous.length - suffix, previous.length),
    ]);
  };
  const handle: MentionComposerHandle = {
    getText: () => draft.text,
    getDraft: () => structuredClone(draft),
    hasContent: () => !draft.isEmpty,
    setText: (text) => setDraft(createTextComposerDraft(text)),
    insertText: (text) => append({ type: "text", text }),
    setDraft,
    insertFileMention: (path, kind) => {
      const reference = createFileMentionReference(path, kind);
      if (!reference) throw new Error("Invalid workspace file reference.");
      append({ type: "fileMention", reference });
    },
    insertSkillMention: (skill) => append({ type: "skillMention", skill }),
    insertCommitMention: (commit) => append({ type: "commitMention", commit }),
    insertGitFileMention: (file) => append({ type: "gitFileMention", file }),
    insertCodeMention: (reference) => append({ type: "codeMention", reference }),
    clear: () => setDraft(createTextComposerDraft("")),
    focus: () => {
      focusRevision++;
      changed();
    },
    typeText: async (text) => {
      if (
        typeof matchMedia === "function" &&
        matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        handle.setText(text);
        handle.focus();
        return;
      }
      handle.setText("");
      const generation = typingGeneration;
      const characters = Array.from(text);
      for (let end = 0; end < characters.length; end += 12) {
        if (typingGeneration !== generation) return;
        draft = createTextComposerDraft(characters.slice(0, end + 12).join(""));
        changed();
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      if (typingGeneration === generation) handle.focus();
    },
  };
  return {
    handle,
    replaceEditorText,
    getSnapshot: () => version,
    getFocusRevision: () => focusRevision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
