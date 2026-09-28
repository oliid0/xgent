import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const drag = createTsModuleLoader().loadModule("src/lib/chat/workspacePathDrag.ts");
const source = {
  projectPathKey: "c:/workspace",
  cwd: "C:\\Workspace\\",
  relativePath: "src\\main.ts",
  entryKind: "file",
};

function transfer(types = []) {
  const data = new Map();
  return {
    types,
    setData(type, value) { data.set(type, value); this.types.push(type); },
    getData(type) { return data.get(type) ?? ""; },
  };
}

test.afterEach(() => drag.clearActiveWorkspacePathDrag());

test("workspace references round-trip with canonical Windows project identity", () => {
  const data = transfer();
  assert.equal(drag.writeWorkspacePathDragPayload(data, source), true);
  assert.equal(data.effectAllowed, "copy");
  assert.equal(data.getData("text/plain"), "src/main.ts");
  const payload = drag.readWorkspacePathDragPayload(data);
  assert.equal(payload.label, "main.ts");
  assert.equal(drag.workspacePathDragMatchesProject(payload, "C:\\WORKSPACE"), true);
  assert.equal(drag.workspacePathDragMatchesProject(payload, "C:/other"), false);
});

test("untrusted transfers reject absolute/traversing paths and mismatched origins", () => {
  for (const relativePath of ["", "/etc/passwd", "../secret", "src/../secret", "src//file", "C:secret", "C:/secret", "src/\u0000file"]) {
    assert.equal(drag.createWorkspacePathDragPayload({ ...source, relativePath }), null, relativePath);
  }
  for (const invalid of [null, [], {}, { ...source, cwd: "C:/other" }, { ...source, entryKind: "link" }]) {
    assert.equal(drag.createWorkspacePathDragPayload(invalid), null);
  }
  const data = transfer();
  data.setData(drag.WORKSPACE_PATH_DRAG_MIME, "{broken");
  assert.equal(drag.readWorkspacePathDragPayload(data), null);
});

test("DOM dragend preserves native handoff without stealing OS file uploads", () => {
  drag.writeWorkspacePathDragPayload(transfer(), source);
  drag.finishWorkspacePathDrag();
  assert.ok(drag.getActiveWorkspacePathDrag());
  assert.equal(drag.hasWorkspacePathDragPayload(transfer(["Files"])), false);
  assert.equal(drag.hasWorkspacePathDragPayload(transfer()), true);
});

test("native hover leaves the old zone and a native drop is consumed once", () => {
  const first = new EventTarget();
  const second = new EventTarget();
  let target = first;
  let leaves = 0;
  let inserts = 0;
  first.addEventListener(drag.WORKSPACE_PATH_NATIVE_DRAG_LEAVE_EVENT, () => leaves++);
  for (const zone of [first, second]) {
    zone.addEventListener(drag.WORKSPACE_PATH_NATIVE_DRAG_OVER_EVENT, event => {
      assert.equal(drag.readNativeWorkspacePathDragOver(event).relativePath, "src/main.ts");
      event.preventDefault();
    });
  }
  second.addEventListener(drag.WORKSPACE_PATH_NATIVE_DROP_EVENT, event => {
    assert.equal(drag.readNativeWorkspacePathDrop(event).relativePath, "src/main.ts");
    inserts++;
    event.preventDefault();
  });
  const options = { document: { elementFromPoint: () => target } };
  drag.writeWorkspacePathDragPayload(transfer(), source);
  assert.equal(drag.dispatchActiveWorkspacePathNativeHover({ x: 10, y: 20 }, options), true);
  target = second;
  assert.equal(drag.dispatchActiveWorkspacePathNativeHover({ x: 30, y: 40 }, options), true);
  assert.equal(leaves, 1);
  assert.equal(drag.dispatchActiveWorkspacePathDrop({ x: 30, y: 40 }, options), true);
  assert.equal(drag.dispatchActiveWorkspacePathDrop({ x: 30, y: 40 }, options), false);
  assert.equal(inserts, 1);
  assert.equal(drag.getActiveWorkspacePathDrag(), null);
});

test("releasing outside a native target clears the pending reference", () => {
  drag.writeWorkspacePathDragPayload(transfer(), source);
  assert.equal(drag.dispatchActiveWorkspacePathDrop({ x: 0, y: 0 }, {
    document: { elementFromPoint: () => null },
  }), false);
  assert.equal(drag.getActiveWorkspacePathDrag(), null);
});
