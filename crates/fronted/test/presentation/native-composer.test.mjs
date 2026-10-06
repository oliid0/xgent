import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { createNativeComposerStore } = loader.loadModule("src/presentation/composerStore.ts");

test("a native clipboard paste creates shared metadata, preserves neighboring references and remains undoable", () => {
  const composer = createNativeComposerStore();
  composer.handle.insertSkillMention({ name: "review", path: "/skills/review" });
  const original = composer.handle.getText(), references = composer.getInlineReferences();
  const { scope } = JSON.parse(composer.getPasteRules());
  const id = `${scope}:paste-${crypto.randomUUID()}`, text = "😀 ".repeat(3000);
  const payload = JSON.stringify({ text: original + text, references: [...references, { id, location: original.length, length: text.length }], pastes: [{ id }] });
  assert.equal(composer.acceptsNativeSnapshot(payload), true);
  composer.replaceNativeSnapshot(payload);
  const paste = composer.handle.getDraft().largePastes[0];
  assert.equal(paste.label, "Pasted text 1");
  assert.equal(paste.text, text);
  assert.equal(paste.charCount, text.length);
  assert.equal(composer.handle.getDraft().textWithoutLargePastes, original);
  assert.equal(composer.getInlineReferences().at(-1).id, id);
  composer.replaceNativeSnapshot(JSON.stringify({ text: original, references }));
  assert.deepEqual(composer.handle.getDraft().largePastes, []);
  composer.replaceNativeSnapshot(payload);
  assert.deepEqual(composer.handle.getDraft().largePastes, [paste], "Redo restores the original paste without incrementing its number");
  assert.equal(composer.handle.getDraft().skillMentions[0].path, "/skills/review");
});

test("native paste metadata cannot forge files, use another editor's scope or bypass the shared threshold", () => {
  const composer = createNativeComposerStore(), foreign = createNativeComposerStore();
  const { scope } = JSON.parse(composer.getPasteRules());
  const id = `${scope}:paste-${crypto.randomUUID()}`, text = "x".repeat(8000);
  const snapshot = { text, references: [{ id, location: 0, length: text.length }], pastes: [{ id }] };
  const variants = [
    { ...snapshot, pastes: [] }, { ...snapshot, pastes: {} }, { ...snapshot, pastes: [null] },
    { ...snapshot, pastes: [{ id }, { id }] }, { ...snapshot, references: [] },
    { text: "short", references: [{ id, location: 0, length: 5 }], pastes: [{ id }] },
    { ...snapshot, references: [{ id: `${scope}:paste-not-a-uuid`, location: 0, length: text.length }], pastes: [{ id: `${scope}:paste-not-a-uuid` }] },
  ];
  for (const value of variants) assert.equal(composer.acceptsNativeSnapshot(JSON.stringify(value)), false);
  assert.equal(foreign.acceptsNativeSnapshot(JSON.stringify(snapshot)), false);
  assert.equal(composer.handle.getText(), "");
  assert.deepEqual(composer.handle.getDraft().largePastes, []);
});

test("history ignores undisplayed newlines inside a pasted-text card and restores its full rich draft", () => {
  const composer = createNativeComposerStore();
  const { scope } = JSON.parse(composer.getPasteRules());
  const id = `${scope}:paste-${crypto.randomUUID()}`, text = "line\n".repeat(200);
  composer.replaceNativeSnapshot(JSON.stringify({ text, references: [{ id, location: 0, length: text.length }], pastes: [{ id }] }));
  const stash = composer.handle.getDraft();
  assert.equal(composer.stepHistory("prev", () => ["Older prompt"]), true, "The displayed card occupies one logical line");
  assert.equal(composer.handle.getText(), "Older prompt");
  assert.equal(composer.stepHistory("next", () => []), true);
  assert.deepEqual(composer.handle.getDraft(), stash);
  composer.handle.insertText("\nsecond line");
  assert.equal(composer.stepHistory("prev", () => ["Older prompt"]), false, "A real text newline still blocks first-line recall");
});

test("inline reference identities preserve different Skills with identical labels across deletion and undo", () => {
  const composer = createNativeComposerStore();
  composer.handle.insertSkillMention({ name: "review", path: "/project-a/review" });
  composer.handle.insertSkillMention({ name: "review", path: "/project-b/review" });
  const text = composer.handle.getText(), references = composer.getInlineReferences();
  assert.equal(references[0].label, references[1].label);
  assert.notEqual(references[0].id, references[1].id);
  const undo = JSON.stringify({ text, references });
  const remaining = { ...references[1], location: 1 };
  composer.replaceNativeSnapshot(JSON.stringify({ text: " /review ", references: [remaining] }));
  assert.deepEqual(composer.handle.getDraft().skillMentions, [{ name: "review", path: "/project-b/review" }]);
  composer.replaceNativeSnapshot(undo);
  assert.deepEqual(composer.handle.getDraft().skillMentions.map(skill => skill.path), ["/project-a/review", "/project-b/review"]);
  assert.deepEqual(composer.getInlineReferences(), references, "Undo restores the original stable identities");
});

test("native snapshots carry exact UTF-16 positions and survive literal text edits around all reference types", () => {
  const composer = createNativeComposerStore();
  composer.handle.setText("😀 ");
  composer.handle.insertFileMention("docs/报告.md", "file");
  composer.handle.insertSkillMention({ name: "review", path: "/skills/review" });
  composer.handle.insertCommitMention({ sha: "1234567890", shortSha: "1234567", subject: "Fix editor" });
  composer.handle.insertGitFileMention({ path: "src/app.ts", commitSha: "abcdefg123", shortSha: "abcdefg", refName: "main" });
  composer.handle.insertCodeMention({ path: "src/app.ts", kind: "code", startLine: 1, endLine: 2 });
  const draft = composer.handle.getDraft();
  const references = composer.getInlineReferences();
  assert.deepEqual(references.map(reference => ({ location: reference.location, length: reference.length })), composer.getAtomicRanges());
  assert.equal(references[0].location, 3);
  assert.equal(references[0].label, "报告.md");
  assert.equal(references[1].label, "/review");
  const prefix = "👩‍💻 ", suffix = "\nContinue";
  composer.replaceNativeSnapshot(JSON.stringify({ text: prefix + draft.text + suffix, references: references.map(reference => ({ ...reference, location: reference.location + prefix.length })) }));
  const edited = composer.handle.getDraft();
  for (const key of ["skillMentions", "commitMentions", "gitFileMentions", "codeMentions"]) assert.deepEqual(edited[key], draft[key]);
  assert.equal(edited.text, prefix + draft.text + suffix);
});

test("same plain text can replace rich metadata, and a pasted reference label remains literal", () => {
  const composer = createNativeComposerStore();
  composer.handle.insertSkillMention({ name: "review", path: "/skills/review" });
  const text = composer.handle.getText(), references = composer.getInlineReferences();
  composer.replaceNativeSnapshot(JSON.stringify({ text, references: [] }));
  assert.deepEqual(composer.handle.getDraft().skillMentions, []);
  composer.replaceNativeSnapshot(JSON.stringify({ text, references }));
  assert.equal(composer.handle.getDraft().skillMentions[0].path, "/skills/review");
});

test("a multiline large paste renders one reference and keeps its exact content through native undo", () => {
  const composer = createNativeComposerStore();
  const paste = { id: "large-paste", label: "Pasted text", text: "Long first line\nSecond line 😀" };
  const draft = composer.handle.getDraft();
  composer.handle.setDraft({ ...draft, text: paste.text, textWithoutLargePastes: "", isEmpty: false, segments: [{ type: "largePaste", paste }], largePastes: [paste] });
  const references = composer.getInlineReferences();
  assert.equal(references[0].label, "Pasted text");
  assert.equal(references[0].length, paste.text.length);
  composer.replaceNativeSnapshot(JSON.stringify({ text: "", references: [] }));
  assert.deepEqual(composer.handle.getDraft().largePastes, []);
  composer.replaceNativeSnapshot(JSON.stringify({ text: paste.text, references }));
  assert.deepEqual(composer.handle.getDraft().largePastes, [paste]);
  assert.equal(composer.handle.getDraft().textWithoutLargePastes, "");
});

test("native reference validation rejects foreign identities, stale substrings and malformed ranges without mutating a draft", () => {
  const composer = createNativeComposerStore(), foreign = createNativeComposerStore();
  for (const store of [composer, foreign]) store.handle.insertSkillMention({ name: "review", path: "/skills/review" });
  const text = composer.handle.getText(), [reference] = composer.getInlineReferences();
  const variants = [foreign.getInlineReferences()[0], { ...reference, id: "unknown" }, { ...reference, location: -1 }, { ...reference, location: 0.5 }, { ...reference, length: 999 }, { ...reference, length: 0 }, { ...reference, location: 1 }, null];
  const previous = composer.handle.getDraft();
  for (const item of variants) {
    const encoded = JSON.stringify({ text, references: [item] });
    assert.equal(composer.acceptsNativeSnapshot(encoded), false);
    assert.throws(() => composer.replaceNativeSnapshot(encoded), /references/);
    assert.deepEqual(composer.handle.getDraft(), previous);
  }
  for (const payload of ["bad json", "[]", "null", "{}", JSON.stringify({ text: text + "\r\n", references: [reference] }), JSON.stringify({ text, references: [reference, reference] })]) assert.equal(composer.acceptsNativeSnapshot(payload), false);
});

test("reference arrows and deletion operate on complete tokens after an emoji, preserving unrelated metadata", () => {
  const composer = createNativeComposerStore();
  composer.handle.setText("😀 ");
  composer.handle.insertSkillMention({ name: "review", path: "/skills/review" });
  composer.handle.insertFileMention("docs/report.md", "file");
  composer.handle.insertText(" continue");
  const text = composer.handle.getText();
  const [skill, file] = composer.getAtomicRanges();
  assert.deepEqual(skill, { location: 3, length: 7 });
  const caret = (location, length = 0) => composer.reportSelection({ text: composer.handle.getText(), location, length });
  caret(skill.location);
  assert.equal(composer.applyAtomicKey("right"), true);
  assert.deepEqual(composer.getSelection(), { location: skill.location + skill.length, length: 0 });
  assert.equal(composer.handle.getText(), text);
  assert.equal(composer.applyAtomicKey("left"), true);
  assert.equal(composer.getSelection().location, 3);
  assert.equal(composer.applyAtomicKey("left"), false, "Ordinary emoji movement remains native");
  caret(file.location, 2);
  assert.equal(composer.applyAtomicKey("delete"), false, "Selected text remains native selection editing");
  caret(skill.location + skill.length);
  assert.equal(composer.applyAtomicKey("backspace"), true);
  assert.equal(composer.handle.getDraft().skillMentions.length, 0);
  assert.ok(composer.handle.getDraft().segments.some(segment => segment.type === "fileMention"));
  assert.equal(composer.getSelection().location, 3);
  const remainingFile = composer.getAtomicRanges()[0];
  caret(remainingFile.location);
  assert.equal(composer.applyAtomicKey("delete"), true);
  assert.deepEqual(composer.getAtomicRanges(), []);
  assert.equal(composer.handle.getText(), "😀    continue");
});

test("software keyboard deletion inside a reference removes the complete token and leaves adjacent references intact", () => {
  for (const deletedOffset of [0, 2, 6]) {
    const composer = createNativeComposerStore();
    composer.handle.setText("😀 ");
    composer.handle.insertSkillMention({ name: "review", path: "/skills/review" });
    composer.handle.insertSkillMention({ name: "test", path: "/skills/test" });
    const text = composer.handle.getText(), [token] = composer.getAtomicRanges();
    const offset = token.location + deletedOffset;
    composer.replaceEditorText(text.slice(0, offset) + text.slice(offset + 1));
    assert.equal(composer.handle.getText(), "😀  /test ");
    assert.deepEqual(composer.handle.getDraft().skillMentions.map(skill => skill.name), ["test"]);
    assert.deepEqual(composer.getSelection(), { location: 3, length: 0 });
    assert.ok(composer.getFocusRevision() > 0, "The corrected draft and caret return to the native field");
  }
});

test("deletion crossing multiple references retains only the unaffected draft segments", () => {
  const composer = createNativeComposerStore();
  composer.handle.insertSkillMention({ name: "review", path: "/skills/review" });
  composer.handle.insertSkillMention({ name: "test", path: "/skills/test" });
  composer.handle.insertText("keep");
  const text = composer.handle.getText();
  composer.replaceEditorText(text.slice(0, 2) + text.slice(11));
  assert.equal(composer.handle.getText(), " keep");
  assert.deepEqual(composer.handle.getDraft().skillMentions, []);
  assert.equal(composer.getSelection().location, 0);
});

test("deleting a pasted-text token releases its draft metadata without altering a following Skill", () => {
  const composer = createNativeComposerStore();
  const paste = { id: "paste", label: "Pasted text", text: "Long pasted text\nwith another line" };
  const draft = composer.handle.getDraft();
  composer.handle.setDraft({ ...draft, text: paste.text, textWithoutLargePastes: "", isEmpty: false,
    segments: [{ type: "largePaste", paste }], largePastes: [paste] });
  composer.handle.insertSkillMention({ name: "review", path: "/skills/review" });
  const [token] = composer.getAtomicRanges();
  composer.reportSelection({ text: composer.handle.getText(), location: token.length, length: 0 });
  assert.equal(composer.applyAtomicKey("backspace"), true);
  assert.deepEqual(composer.handle.getDraft().largePastes, []);
  assert.deepEqual(composer.handle.getDraft().skillMentions.map(skill => skill.name), ["review"]);
  assert.equal(composer.handle.getText(), "/review ");
});

test("native typing preserves untouched rich mentions and draft snapshots are isolated", () => {
  const composer = createNativeComposerStore();
  const skill = { name: "review", path: "/skills/review", description: "Review code" };
  composer.handle.setText("Please ");
  composer.handle.insertSkillMention(skill);
  composer.handle.insertText("these changes");
  assert.equal(composer.handle.getText(), "Please /review these changes");
  composer.replaceEditorText("Please /review these changes carefully");
  const snapshot = composer.handle.getDraft();
  assert.equal(snapshot.skillMentions[0].name, "review");
  assert.equal(snapshot.segments.some((item) => item.type === "skillMention"), true);
  snapshot.skillMentions[0].name = "different";
  assert.equal(composer.handle.getDraft().skillMentions[0].name, "review");
});

test("editing inside a rich mention removes its metadata while retaining other mentions", () => {
  const composer = createNativeComposerStore();
  composer.handle.insertSkillMention({ name: "review", path: "/review" });
  composer.handle.insertSkillMention({ name: "test", path: "/test" });
  composer.replaceEditorText("/reviews /test ");
  assert.deepEqual(composer.handle.getDraft().skillMentions.map((item) => item.name), ["review", "test"]);
  composer.replaceEditorText("/revised /test ");
  assert.deepEqual(composer.handle.getDraft().skillMentions.map((item) => item.name), ["test"]);
  assert.equal(composer.handle.getText(), "/revised /test ");
});

test("changing conversations cancels typewriter work without stealing focus or replacing the new draft", async () => {
  const composer = createNativeComposerStore();
  const typing = composer.handle.typeText("A long response which spans several animation frames.");
  composer.handle.setText("Different conversation");
  await typing;
  assert.equal(composer.handle.getText(), "Different conversation");
  assert.equal(composer.getFocusRevision(), 0);
  composer.handle.clear();
  assert.equal(composer.handle.hasContent(), false);
});

test("native edits use the shared newline model and subscriptions stop after removal", () => {
  const composer = createNativeComposerStore();
  let changes = 0;
  const unsubscribe = composer.subscribe(() => { changes++; });
  composer.replaceEditorText("one\r\ntwo\rthree");
  assert.equal(composer.handle.getText(), "one\ntwo\nthree");
  assert.equal(changes, 1);
  unsubscribe();
  composer.handle.setText("new");
  assert.equal(changes, 1);
});

test("native prompt recall freezes shared history and restores the complete rich draft", () => {
  const composer = createNativeComposerStore();
  composer.handle.setText("Unsaved 😀 ");
  composer.handle.insertSkillMention({ name: "review", path: "/skills/review" });
  composer.handle.insertFileMention("docs/report.md", "file");
  const stash = composer.handle.getDraft();
  let entries = ["old", "", "new", "old", "new"];
  const load = () => entries;
  assert.equal(composer.stepHistory("next", load), false);
  assert.equal(composer.stepHistory("prev", load), true);
  assert.equal(composer.handle.getText(), "new");
  assert.equal(composer.isRecallingHistory(), true);
  entries = ["arrived during recall"];
  assert.equal(composer.stepHistory("prev", load), true);
  assert.equal(composer.handle.getText(), "old");
  const focus = composer.getFocusRevision();
  assert.equal(composer.stepHistory("prev", load), true);
  assert.equal(composer.getFocusRevision(), focus, "Oldest prompt consumes the key without changing focus");
  composer.stepHistory("next", load);
  assert.equal(composer.handle.getText(), "new");
  composer.stepHistory("next", load);
  assert.deepEqual(composer.handle.getDraft(), stash);
  assert.equal(composer.isRecallingHistory(), false);
  assert.deepEqual(composer.getSelection(), { location: stash.text.length, length: 0 });
});

test("native recall respects logical lines and selections; accepted edits and owner resets retire the stash", () => {
  const composer = createNativeComposerStore();
  const load = () => ["first\nsecond"];
  composer.handle.setText("draft\nlast");
  assert.equal(composer.stepHistory("prev", load), false);
  composer.reportSelection({ text: composer.handle.getText(), location: 0, length: 1 });
  assert.equal(composer.stepHistory("prev", load), false);
  composer.reportSelection({ text: composer.handle.getText(), location: 0, length: 0 });
  assert.equal(composer.stepHistory("prev", load), true);
  composer.reportSelection({ text: composer.handle.getText(), location: 0, length: 0 });
  assert.equal(composer.stepHistory("next", load), false);
  composer.reportSelection({ text: composer.handle.getText(), location: 12, length: 0 });
  assert.equal(composer.stepHistory("next", load), true);
  composer.reportSelection({ text: composer.handle.getText(), location: 0, length: 0 });
  composer.stepHistory("prev", load);
  composer.replaceEditorText("edited recalled prompt");
  assert.equal(composer.isRecallingHistory(), false);
  assert.equal(composer.stepHistory("next", load), false);
  composer.stepHistory("prev", load);
  composer.resetHistory();
  assert.equal(composer.stepHistory("next", load), false);
  assert.equal(composer.handle.getText(), "first\nsecond");
  composer.handle.clear();
  assert.equal(composer.stepHistory("prev", () => ["", "   "]), false);
});
