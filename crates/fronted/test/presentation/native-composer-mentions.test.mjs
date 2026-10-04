import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { detectNativeComposerMention: detect, decodeNativeComposerSelection: decode, createNativeMentionSearch } = loader.loadModule("src/presentation/nativeComposerMentions.ts");
const { createNativeComposerStore } = loader.loadModule("src/presentation/composerStore.ts");

test("native mention triggers follow the real caret, whitespace and filesystem rules", () => {
  for (const text of ["@", "Read @docs/a", "你好😀 /review"]) {
    const context = detect(text, { location: text.length, length: 0 }, true);
    assert.ok(context);
    assert.equal(context.trigger, text.includes("@") ? "file" : "skill");
  }
  for (const text of ["mail@example.com", "/usr/bin", "https://example.com", "some/review", "@docs/a "]) {
    assert.equal(detect(text, { location: text.length, length: 0 }, true), null);
  }
  assert.equal(detect("/review", { location: 7, length: 0 }, false), null);
  assert.equal(detect("@doc", { location: 4, length: 1 }, true), null);
  assert.equal(detect("@doc suffix", { location: 4, length: 0 }, true).query, "doc");
});

test("selection reports reject stale text and invalid UTF-16 offsets", () => {
  const composer = createNativeComposerStore();
  composer.handle.setText("😀 @doc suffix");
  assert.equal(composer.reportSelection({ text: "old", location: 0, length: 0 }), false);
  for (const value of [{ text: "abc", location: -1, length: 0 }, { text: "abc", location: 2, length: 4 }, { text: "abc", location: 1.5, length: 0 }]) {
    assert.equal(decode(JSON.stringify(value)), null);
  }
  const selection = { text: composer.handle.getText(), location: 7, length: 0 };
  assert.equal(composer.reportSelection(selection), true);
  assert.equal(detect(selection.text, composer.getSelection(), true).query, "doc");
});

test("choosing a skill in the middle replaces only its query and preserves other rich references", () => {
  const composer = createNativeComposerStore();
  const original = { name: "original", description: "", skillFile: "/skills/original/SKILL.md", baseDir: "/skills/original" };
  const chosen = { ...original, name: "review", skillFile: "/skills/review/SKILL.md" };
  composer.handle.insertSkillMention(original);
  composer.handle.insertText("Read /rev suffix 😀");
  const text = composer.handle.getText(), end = text.indexOf("/rev") + 4;
  composer.reportSelection({ text, location: end, length: 0 });
  const context = detect(text, composer.getSelection(), true);
  composer.replaceMention(context, { type: "skillMention", skill: chosen });
  const draft = composer.handle.getDraft();
  assert.deepEqual(draft.skillMentions, [original, chosen]);
  assert.ok(draft.text.endsWith(" suffix 😀"));
  assert.equal(draft.text.includes("/rev suffix"), false);
  assert.equal(composer.getFocusRevision(), 1);
  assert.ok(composer.getSelection().location < draft.text.length);
  assert.throws(() => composer.replaceMention(context, { type: "skillMention", skill: chosen }), /no longer active/);
});

test("an old file search cannot replace the next workspace's menu and cancellation retires late results", async () => {
  const waits = [];
  const search = createNativeMentionSearch((workdir, query) => new Promise(resolve => waits.push({ workdir, query, resolve })));
  const context = detect("@doc", { location: 4, length: 0 }, true);
  const first = search.search("first", "/one", context);
  const second = search.search("second", "/two", context);
  waits[1].resolve({ entries: [{ path: "docs/new.md", kind: "file" }] }); await second;
  waits[0].resolve({ entries: [{ path: "docs/old.md", kind: "file" }] }); await first;
  assert.equal(search.getSnapshot().key, "second");
  assert.equal(search.getSnapshot().entries[0].path, "docs/new.md");
  const third = search.search("third", "/three", context); search.cancel();
  waits[2].resolve({ entries: [{ path: "late.md", kind: "file" }] }); await third;
  assert.deepEqual(search.getSnapshot().entries, []);
});
