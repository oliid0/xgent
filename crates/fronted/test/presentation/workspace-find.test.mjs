import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { workspaceFind, workspaceFindDefaults, workspaceFindReplacement, applyWorkspaceFindEdit } = loader.loadModule("src/components/workspace-editor/workspaceFind.ts");
const { NativeWorkspaceFind, parseNativeWorkspaceFind } = loader.loadModule("src/presentation/nativeWorkspaceFind.ts");
const options = changes => ({ ...workspaceFindDefaults, ...changes });
const command = (content, changes = {}) => ({ kind: "workspaceFind", command: "query", content,
  query: "cat", replacement: "dog", options: options(), selections: [{ location: 0, length: 0 }], ...changes });

test("native find uses the installed Monaco Unicode/case/whole-word engine and raw UTF-16 ranges", () => {
  const source = "😀cat CAT scatter cat_ cat.\r\ncat\rcat";
  assert.deepEqual(workspaceFind(source, "cat", options({ wholeWord: true })).matches.map(({ location, length }) => [location, length]),
    [[6, 3], [23, 3], [29, 3], [33, 3]]);
  assert.deepEqual(workspaceFind(source, "cat", options()).matches[0], { location: 2, length: 3, captures: ["cat"] });
  assert.equal(workspaceFind(source, "cat", options({ matchCase: true })).matches.length, 6);
  const found = workspaceFind("😀a\r\nb\ra\nb", "a\\nb", options({ regex: true })).matches;
  assert.deepEqual(found.map(({ location, length }) => [location, length]), [[2, 4], [7, 3]]);
  assert.deepEqual(found[0].captures, ["a\nb"]);
  assert.equal(workspaceFind("😀x", "(?=.)", options({ regex: true })).matches.length, 2);
  assert.equal(workspaceFind("aaa", "[", options({ regex: true })).invalid, true);
});

test("native replacements share Monaco capture, case preservation and literal-dollar rules and retain CRLF", () => {
  const source = "cat CAT Cat\r\ncat", config = options({ preserveCase: true });
  const edit = workspaceFindReplacement(source, workspaceFind(source, "cat", config).matches, "dog", config);
  assert.equal(applyWorkspaceFindEdit(source, edit), "dog DOG Dog\r\ndog");
  const regex = options({ regex: true });
  const grouped = workspaceFindReplacement("cat:2\r\ncat:3", workspaceFind("cat:2\r\ncat:3", "(cat):(\\d)", regex).matches, "$2-\\U$1-$$-$0", regex);
  assert.equal(applyWorkspaceFindEdit("cat:2\r\ncat:3", grouped), "2-CAT-$-cat:2\r\n3-CAT-$-cat:3");
  const literal = workspaceFindReplacement("cat", workspaceFind("cat", "cat", options()).matches, "$1\\n", options());
  assert.equal(literal.text, "$1\\n");
});

test("selection ranges merge without duplicated replacements and replace-all reaches beyond highlighted limits", () => {
  assert.equal(workspaceFind("cat cat cat", "cat", options({ selection: true }), [{ location: 0, length: 7 }, { location: 4, length: 7 }]).matches.length, 3);
  assert.equal(workspaceFind("cat", "cat", options({ selection: true }), []).matches.length, 0);
  const source = "cat ".repeat(20050), find = new NativeWorkspaceFind();
  find.dispatch(command(source)); assert.equal(find.count, 19999); assert.equal(find.limited, true);
  find.dispatch(command(source, { command: "replaceAll" }));
  assert.equal(applyWorkspaceFindEdit(source, find.edit), "dog ".repeat(20050));
  find.dispatch(command(source, { command: "next", selections: [{ location: 79992, length: 3 }] }));
  assert.equal(find.reveal.location, 79996);
});

test("find controller owns acknowledgements, adjusts selection scope, advances after replacement and keeps newer input", () => {
  const find = new NativeWorkspaceFind(), source = "cat cat cat";
  find.dispatch(command(source, { command: "openReplace", options: options({ selection: true }), selections: [{ location: 4, length: 7 }] }));
  assert.equal(find.count, 2); assert.equal(find.reveal.location, 4);
  find.dispatch(command(source, { command: "replace", replacement: "elephant", options: options({ selection: true }), selections: [{ location: 4, length: 3 }] }));
  const edit = find.edit, after = applyWorkspaceFindEdit(source, edit);
  find.refresh(after); // The real text delegate arrives before its acknowledgement.
  assert.equal(find.dispatch(command(after, { command: "ack", editRequest: edit.request + 1, applied: true })), false);
  assert.equal(find.dispatch(command(after, { command: "ack", editRequest: edit.request, applied: true })), true);
  assert.equal(find.reveal.location, 13); assert.equal(find.count, 1);
  assert.deepEqual(find.scopes, [{ location: 4, length: 12 }]);
  find.dispatch(command(after, { command: "replace", replacement: "dog", options: options({ selection: true }), selections: [{ location: 13, length: 3 }] }));
  const pending = find.edit; find.refresh(after + " later");
  find.dispatch(command(after + " later", { command: "ack", editRequest: pending.request, applied: false }));
  assert.equal(find.rejected, true); assert.equal(find.edit, null);
});

test("find envelopes reject malformed options, out-of-bounds selections and forged acknowledgements", () => {
  assert.ok(parseNativeWorkspaceFind(JSON.stringify(command("cat"))));
  assert.equal(parseNativeWorkspaceFind(JSON.stringify(command("cat", { options: { regex: true } }))), null);
  assert.equal(parseNativeWorkspaceFind(JSON.stringify(command("cat", { selections: [{ location: 3, length: 1 }] }))), null);
  assert.equal(parseNativeWorkspaceFind(JSON.stringify(command("cat", { command: "ack" }))), null);
  const find = new NativeWorkspaceFind(); find.dispatch(command("cat"));
  const revision = find.revision;
  assert.equal(find.dispatch(command("cat", { command: "ack", editRequest: 10, applied: true })), false);
  assert.equal(find.revision, revision);
});

test("native decorations retain all highlighted UTF-16 matches, exact source and tracked selection scopes", () => {
  const find = new NativeWorkspaceFind();
  find.dispatch(command("😀cat\r\ncat cat"));
  let metadata = find.metadata("file:1");
  assert.deepEqual(metadata.decorations.matches, [{ location: 2, length: 3 }, { location: 7, length: 3 }, { location: 11, length: 3 }]);
  assert.equal(metadata.decorations.source, "😀cat\r\ncat cat");
  assert.deepEqual(metadata.decorations.scopes, []);
  const before = metadata.decorations.revision;
  find.refresh("😀dog\r\ncat cat");
  metadata = find.metadata("file:1");
  assert.equal(metadata.decorations.source, "😀dog\r\ncat cat");
  assert.ok(metadata.decorations.revision > before);
  assert.deepEqual(metadata.decorations.matches, [{ location: 7, length: 3 }, { location: 11, length: 3 }]);
  find.dispatch(command("😀dog\r\ncat cat", { options: options({ selection: true }), selections: [{ location: 7, length: 7 }] }));
  assert.deepEqual(find.metadata("file:1").decorations.scopes, [{ location: 7, length: 7 }]);
  find.refresh("prefix 😀dog\r\ncat cat");
  assert.deepEqual(find.metadata("file:1").decorations.scopes, [{ location: 14, length: 7 }]);
  assert.deepEqual(find.metadata("file:1").decorations.matches, [{ location: 14, length: 3 }, { location: 18, length: 3 }]);
});

test("invalid, closed and empty find panels clear decorations while count limiting never truncates replace-all", () => {
  const find = new NativeWorkspaceFind(), source = "cat ".repeat(20000);
  find.dispatch(command(source));
  assert.equal(find.metadata("large").decorations.matches.length, 19999);
  find.dispatch(command(source, { command: "replaceAll" }));
  assert.equal(applyWorkspaceFindEdit(source, find.edit), "dog ".repeat(20000));
  find.dispatch(command(source, { command: "close" }));
  assert.equal(find.metadata("large").decorations, null);
  find.dispatch(command("cat", { query: "[", options: options({ regex: true }) }));
  assert.equal(find.metadata("large").decorations, null);
  find.dispatch(command("cat", { query: "missing" }));
  assert.equal(find.metadata("large").decorations, null);
  find.dispatch(command("cat", { query: "missing", options: options({ selection: true }), selections: [{ location: 0, length: 3 }] }));
  assert.deepEqual(find.metadata("large").decorations.scopes, [{ location: 0, length: 3 }]);
  assert.deepEqual(find.metadata("large").decorations.matches, []);
});
