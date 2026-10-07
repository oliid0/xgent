import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

test("native image previews retire old owners and keep successful and failed files independent", async () => {
  const hooks = createReactHookHarness();
  const reads = [];
  const { useNativeComposerImages } = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../lib/tools/fsBackend": { invokeFs: (command, args) => new Promise((resolve, reject) => reads.push({ command, args, resolve, reject })) },
  } }).loadModule("src/presentation/useNativeComposerImages.ts");
  const file = (relativePath, kind = "image") => ({ relativePath, kind });
  let uploads = [file("old.png"), file("notes.md", "text")], root = "/old";
  const render = () => hooks.render(() => useNativeComposerImages(uploads, root));
  assert.deepEqual(Object.keys(render()), []);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].command, "fs_read_workspace_image");
  uploads = [file("new.png"), file("broken.png")]; root = "/new";
  render();
  assert.deepEqual(reads[1].args, { workdir: "/new", path: "new.png" });
  reads[0].resolve({ mimeType: "image/png", data: "old" });
  reads[1].resolve({ mimeType: "image/png", data: "new" });
  reads[2].reject(new Error("Image was removed"));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(Object.keys(render()).sort(), ["broken.png", "new.png"]);
  assert.equal(render()["new.png"].source, "data:image/png;base64,new");
  assert.equal(render()["broken.png"].error, "Image was removed");
  uploads = [];
  assert.deepEqual(Object.keys(render()), []);
  hooks.unmount();
});
