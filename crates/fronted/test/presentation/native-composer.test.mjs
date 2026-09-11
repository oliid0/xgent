import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { createNativeComposerStore } = loader.loadModule("src/presentation/composerStore.ts");

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
