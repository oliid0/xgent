import type {
  MentionComposerDraft,
  MentionComposerDraftSegment,
  MentionComposerHandle,
} from "../components/chat/MentionComposer";
import { type PromptHistorySession, stepPromptHistory } from "../components/chat/promptHistory";
import { buildTextFromComposerDraft, createTextComposerDraft } from "../lib/chat/composerDraft";
import { isLargePasteText, largePasteRules, makeLargePaste } from "../lib/chat/largePaste";
import { normalizeLogicalLineEndings } from "../lib/chat/messages/composerText";
import {
  codeMentionTokenLabel,
  createFileMentionReference,
  fileMentionDisplayName,
} from "../lib/chat/messages/mentionReferences";
import { createUuid } from "../lib/shared/id";

export type ComposerAtomicKey = "left" | "right" | "backspace" | "delete";
export type NativeComposerReference = {
  id: string;
  location: number;
  length: number;
  label: string;
  icon: string;
};

type NativeComposerSnapshot = {
  text: string;
  references: Pick<NativeComposerReference, "id" | "location" | "length">[];
  pastes?: { id: string }[];
};

/** The native editor implements the existing composer contract, including queued rich drafts. */
export function createNativeComposerStore() {
  let draft = createTextComposerDraft("");
  let focusRevision = 0;
  let version = 0;
  let typingGeneration = 0;
  let selection = { location: 0, length: 0 };
  let historySession: PromptHistorySession<never, MentionComposerDraft> | null = null;
  const referenceScope = createUuid();
  let referenceSequence = 0;
  let largePasteSequence = 0;
  const referenceIds = new Map<string, string>();
  const referenceValues = new Map<
    string,
    { segment: MentionComposerDraftSegment; text: string; fingerprint: string }
  >();
  const listeners = new Set<() => void>();
  const changed = () => {
    version++;
    for (const listener of listeners) listener();
  };
  const setDraft = (next: MentionComposerDraft) => {
    typingGeneration++;
    historySession = null;
    draft = structuredClone(next);
    largePasteSequence = Math.max(largePasteSequence, draft.largePastes.length);
    selection = { location: draft.text.length, length: 0 };
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
  const getAtomicRanges = () => {
    let location = 0;
    return draft.segments.flatMap((segment) => {
      const length = buildTextFromComposerDraft({ ...draft, segments: [segment] }).length;
      const range = { location, length };
      location += length;
      return segment.type !== "text" && length > 0 ? [range] : [];
    });
  };
  const getInlineReferences = (): NativeComposerReference[] => {
    let location = 0;
    const live = new Set<string>();
    const result = draft.segments.flatMap((segment) => {
      const text = buildTextFromComposerDraft({ ...draft, segments: [segment] });
      const length = text.length;
      const position = { location, length };
      location += length;
      if (length === 0 || segment.type === "text") return [];
      const fingerprint = JSON.stringify(segment);
      let id = referenceIds.get(fingerprint);
      if (!id) {
        id = `${referenceScope}:${++referenceSequence}`;
        referenceIds.set(fingerprint, id);
        referenceValues.set(id, { segment: structuredClone(segment), text, fingerprint });
      }
      live.add(id);
      const range = { ...position, id };
      switch (segment.type) {
        case "fileMention":
          return [
            {
              ...range,
              label: fileMentionDisplayName(segment.reference),
              icon: segment.reference.kind === "dir" ? "folder" : "doc",
            },
          ];
        case "skillMention":
          return [{ ...range, label: `/${segment.skill.name}`, icon: "sparkles" }];
        case "largePaste":
          return [{ ...range, label: segment.paste.label, icon: "doc.on.clipboard" }];
        case "commitMention":
          return [
            {
              ...range,
              label:
                `${segment.commit.shortSha || segment.commit.sha.slice(0, 7)} ${segment.commit.subject}`.trim(),
              icon: "point.3.connected.trianglepath.dotted",
            },
          ];
        case "gitFileMention":
          return [
            {
              ...range,
              label: `${segment.file.refName || segment.file.shortSha || segment.file.commitSha.slice(0, 7)}: ${segment.file.path}`,
              icon: "doc.badge.clock",
            },
          ];
        case "codeMention":
          return [
            { ...range, label: codeMentionTokenLabel(segment.reference), icon: "curlybraces" },
          ];
      }
      return [];
    });
    // Keep live references and a bounded archive for native undo. Old identifiers
    // are never reused: an expired undo fails validation instead of restoring
    // another file/Skill which happens to have the same display text.
    let archived = 0,
      bytes = 0;
    for (const [id, value] of [...referenceValues].reverse()) {
      if (live.has(id)) continue;
      bytes += value.fingerprint.length * 2;
      if (++archived > 4096 || bytes > 64 * 1024 * 1024) {
        referenceValues.delete(id);
        referenceIds.delete(value.fingerprint);
      }
    }
    return result;
  };
  const getHistoryCaretLine = () => {
    let location = 0,
      onFirstLine = true,
      onLastLine = true;
    for (const segment of draft.segments) {
      const text = buildTextFromComposerDraft({ ...draft, segments: [segment] });
      if (segment.type === "text") {
        const caret = Math.max(0, Math.min(text.length, selection.location - location));
        if (text.slice(0, caret).includes("\n")) onFirstLine = false;
        if (text.slice(caret).includes("\n")) onLastLine = false;
      }
      // The shared DOM editor treats every chip as an opaque inline unit; its
      // underlying pasted text can contain hundreds of undisplayed line breaks.
      location += text.length;
    }
    return { onFirstLine, onLastLine };
  };
  const decodeNativeSnapshot = (encoded: string): NativeComposerSnapshot | null => {
    let value: unknown;
    try {
      value = JSON.parse(encoded);
    } catch {
      return null;
    }
    if (!value || typeof value !== "object") return null;
    const snapshot = value as NativeComposerSnapshot;
    if (typeof snapshot.text !== "string" || !Array.isArray(snapshot.references)) return null;
    const pastes = new Set<string>();
    if (snapshot.pastes !== undefined && !Array.isArray(snapshot.pastes)) return null;
    for (const paste of snapshot.pastes ?? []) {
      if (
        !paste ||
        typeof paste !== "object" ||
        typeof paste.id !== "string" ||
        pastes.has(paste.id)
      )
        return null;
      const suffix = paste.id.slice(referenceScope.length);
      if (
        !paste.id.startsWith(referenceScope) ||
        !/^:paste-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(suffix)
      )
        return null;
      pastes.add(paste.id);
    }
    // Ranges refer to the submitted UTF-16 text. Do not normalize CRLF before
    // validation; native text views already submit the shared LF format.
    if (normalizeLogicalLineEndings(snapshot.text) !== snapshot.text) return null;
    let end = 0;
    for (const reference of snapshot.references) {
      if (
        !reference ||
        typeof reference !== "object" ||
        typeof reference.id !== "string" ||
        !Number.isSafeInteger(reference.location) ||
        !Number.isSafeInteger(reference.length) ||
        reference.location < end ||
        reference.length <= 0 ||
        reference.location > snapshot.text.length - reference.length
      )
        return null;
      const original = referenceValues.get(reference.id);
      const text = snapshot.text.slice(reference.location, reference.location + reference.length);
      if (pastes.has(reference.id)) {
        if (!isLargePasteText(text) || (original && original.segment.type !== "largePaste"))
          return null;
        pastes.delete(reference.id);
        if (!original) {
          end = reference.location + reference.length;
          continue;
        }
      }
      if (
        !original ||
        original.text !==
          snapshot.text.slice(reference.location, reference.location + reference.length)
      )
        return null;
      end = reference.location + reference.length;
    }
    if (pastes.size > 0) return null;
    return snapshot;
  };
  const replaceNativeSnapshot = (encoded: string) => {
    const snapshot = decodeNativeSnapshot(encoded);
    if (!snapshot) throw new Error("The composer references are no longer available.");
    const segments: MentionComposerDraftSegment[] = [];
    let offset = 0;
    for (const reference of snapshot.references) {
      if (reference.location > offset)
        segments.push({ type: "text", text: snapshot.text.slice(offset, reference.location) });
      let original = referenceValues.get(reference.id);
      if (!original) {
        const text = snapshot.text.slice(reference.location, reference.location + reference.length);
        const segment: MentionComposerDraftSegment = {
          type: "largePaste",
          paste: makeLargePaste(text, ++largePasteSequence, reference.id),
        };
        const fingerprint = JSON.stringify(segment);
        original = { segment, text, fingerprint };
        referenceValues.set(reference.id, original);
        referenceIds.set(fingerprint, reference.id);
      }
      if (!original) throw new Error("The composer references are no longer available.");
      segments.push(structuredClone(original.segment));
      offset = reference.location + reference.length;
    }
    if (offset < snapshot.text.length)
      segments.push({ type: "text", text: snapshot.text.slice(offset) });
    // Metadata-only changes also matter (two equal labels can own different paths).
    if (JSON.stringify(segments) !== JSON.stringify(draft.segments)) setSegments(segments);
    return draft.text;
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
    // The software keyboard and selection deletion do not emit hardware key
    // events. Removing any part of a noneditable reference removes its complete
    // segment, like Astryx's chip, rather than silently converting it to text.
    const deletedEnd = previous.length - suffix;
    if (deletedEnd > start && next.length - suffix === start) {
      let from = start,
        to = deletedEnd;
      for (const range of getAtomicRanges()) {
        const end = range.location + range.length;
        if (start < end && deletedEnd > range.location) {
          from = Math.min(from, range.location);
          to = Math.max(to, end);
        }
      }
      if (from !== start || to !== deletedEnd) {
        setSegments([...slice(0, from), ...slice(to, previous.length)]);
        selection = { location: from, length: 0 };
        handle.focus();
        return;
      }
    }
    // Rich mentions and large pastes outside the changed range keep their metadata.
    // Editing inside a token converts only that token's surviving text to plain text.
    setSegments([
      ...slice(0, start),
      { type: "text", text: next.slice(start, next.length - suffix) },
      ...slice(previous.length - suffix, previous.length),
    ]);
    selection = { location: next.length - suffix, length: 0 };
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
    acceptsNativeSnapshot: (value: string) => decodeNativeSnapshot(value) !== null,
    replaceNativeSnapshot,
    getSelection: () => ({ ...selection }),
    getSelectionRequest: () => JSON.stringify({ request: focusRevision, ...selection }),
    getAtomicRanges,
    getInlineReferences,
    getPasteRules: () =>
      JSON.stringify({ ...largePasteRules, scope: referenceScope, label: "Pasted text" }),
    applyAtomicKey(key: ComposerAtomicKey) {
      if (selection.length !== 0) return false;
      const backward = key === "left" || key === "backspace";
      const range = getAtomicRanges().find(({ location, length }) =>
        backward
          ? selection.location > location && selection.location <= location + length
          : selection.location >= location && selection.location < location + length,
      );
      if (!range) return false;
      if (key === "backspace" || key === "delete") {
        setSegments([
          ...slice(0, range.location),
          ...slice(range.location + range.length, draft.text.length),
        ]);
        selection = { location: range.location, length: 0 };
      } else {
        selection = { location: range.location + (backward ? 0 : range.length), length: 0 };
      }
      handle.focus();
      return true;
    },
    isRecallingHistory: () => historySession !== null,
    resetHistory() {
      historySession = null;
    },
    stepHistory(direction: "prev" | "next", loadEntries: () => readonly string[]) {
      if (selection.length !== 0) return false;
      const caret = getHistoryCaretLine();
      const step = stepPromptHistory<never, MentionComposerDraft>({
        direction,
        session: historySession,
        caretOnFirstLine: caret.onFirstLine,
        caretOnLastLine: caret.onLastLine,
        loadEntries,
        makeStash: handle.getDraft,
      });
      if (step.type === "pass") return false;
      if (step.type === "apply") {
        handle.setText(step.text);
        historySession = step.session;
        handle.focus();
      } else if (step.type === "restore") {
        handle.setDraft(step.stash);
        handle.focus();
      }
      return true;
    },
    reportSelection(value: { text: string; location: number; length: number }) {
      if (
        value.text !== draft.text ||
        !Number.isSafeInteger(value.location) ||
        !Number.isSafeInteger(value.length) ||
        value.location < 0 ||
        value.length < 0 ||
        value.location + value.length > draft.text.length
      )
        return false;
      if (selection.location === value.location && selection.length === value.length) return true;
      selection = { location: value.location, length: value.length };
      changed();
      return true;
    },
    replaceMention(
      context: { text: string; start: number; end: number },
      segment: MentionComposerDraftSegment,
    ) {
      if (
        context.text !== draft.text ||
        selection.length !== 0 ||
        selection.location !== context.end ||
        context.start < 0 ||
        context.start > context.end ||
        context.end > draft.text.length
      ) {
        throw new Error("The composer reference is no longer active.");
      }
      const before = slice(0, context.start),
        after = slice(context.end, draft.text.length);
      const token = buildTextFromComposerDraft({ ...draft, segments: [segment] });
      setSegments([...before, segment, { type: "text", text: " " }, ...after]);
      selection = { location: context.start + token.length + 1, length: 0 };
      handle.focus();
    },
    getSnapshot: () => version,
    getFocusRevision: () => focusRevision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
