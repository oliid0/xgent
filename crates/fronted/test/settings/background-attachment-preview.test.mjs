import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const source = { version: 1, workdir: "/phone/source", path: "/phone/source/image.png", bytes: 5, contentHash: "a".repeat(64) };
const file = { relativePath: "uploads/peer/image.png", absolutePath: "C:\\peer\\image.png", fileName: "image.png", kind: "image", sizeBytes: 5, localSource: source };

function hookHarness() {
  const state = [], effects = [], calls = [], waiting = [];
  let cursor = 0;
  const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useEffect(effect, deps) { const index = cursor++; if (!same(state[index]?.deps, deps)) effects.push(() => {
      state[index]?.cleanup?.(); state[index] = { deps, cleanup: effect() };
    }); },
  };
  const loader = createTsModuleLoader({ mocks: { react, "@xgent/runtime": { invoke(command, args) {
    calls.push({ command, args }); const promise = Promise.withResolvers(); waiting.push(promise); return promise.promise;
  } } } });
  const module = loader.loadModule("src/pages/chat/transcript/uploadedImagePreview.ts");
  const render = (selected = file, root = "C:\\peer") => {
    cursor = 0; const location = module.getUploadedImagePreviewSource(root, selected);
    const result = module.useUploadedImagePreview(location?.absolutePath, location?.workspaceRoot);
    for (const effect of effects.splice(0)) effect(); return result;
  };
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return { ...module, render, settle, calls, waiting };
}

test("preview reads the pinned local source and keeps legacy paths for attachments without provenance", () => {
  const f = hookHarness();
  assert.deepEqual(f.getUploadedImagePreviewSource("C:\\peer", file), { workspaceRoot: source.workdir, absolutePath: source.path });
  assert.deepEqual(f.getUploadedImagePreviewSource("/legacy", { absolutePath: "/legacy/image.png" }), { workspaceRoot: "/legacy", absolutePath: "/legacy/image.png" });
  assert.equal(f.getUploadedImagePreviewSource("C:\\peer", { ...file, localSource: null }), null);
});

test("actual thumbnail loading and caching use the source device's workspace even after peer selection changes", async () => {
  const f = hookHarness(); f.render(); assert.equal(f.render().isLoading, true);
  assert.deepEqual(f.calls[0], { command: "system_read_uploaded_image_preview", args: { workdir: source.workdir, absolute_path: source.path } });
  f.waiting[0].resolve({ mimeType: "image/png", data: "aW1hZ2U=" }); await f.settle();
  assert.equal(f.render(file, "D:\\different-peer").imageSrc, "data:image/png;base64,aW1hZ2U=");
  assert.equal(f.calls.length, 1);
});

test("invalid local provenance and preview failure never fall back to a peer path or leave a loading spinner", async () => {
  const f = hookHarness(); assert.equal(f.render({ ...file, localSource: null }).imageSrc, null);
  assert.equal(f.calls.length, 0);
  f.render(); f.waiting[0].reject(new Error("Local copy removed")); await f.settle();
  const result = f.render(); assert.equal(result.imageSrc, null); assert.equal(result.isLoading, false);
  assert.equal(f.calls.length, 1);
});

test("source-aware preview invalidation re-reads the actual local path rather than retaining the peer cache key", async () => {
  const f = hookHarness(); f.render(); f.waiting[0].resolve({ mimeType: "image/png", data: "aW1hZ2U=" }); await f.settle();
  f.invalidateUploadedImagePreviewCache("C:\\peer", file);
  f.render({ absolutePath: "/other/image.png" }, "/other");
  f.render(); assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2].args.absolute_path, source.path);
});

test("attachment card thumbnail, copy, save and system-open actions keep the same local source while removal uses the displayed attachment identity", async () => {
  const preview = hookHarness(), calls = [], state = []; let cursor = 0;
  const loader = createTsModuleLoader({ mocks: {
    react: { useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; }, useMemo: fn => fn() },
    "@astryxdesign/core/Icon": { Icon: "Icon" }, "@astryxdesign/core/IconButton": { IconButton: "IconButton" },
    "@astryxdesign/core/Layout": { HStack: "HStack", VStack: "VStack" }, "@astryxdesign/core/List": { List: "List", ListItem: "ListItem" },
    "@astryxdesign/core/Thumbnail": { Thumbnail: "Thumbnail" },
    "../../../components/chat/ImagePreview": { ImagePreview: "ImagePreview" }, "../../../components/icons": { FileText: "FileText" },
    "../../../i18n": { useLocale: () => ({ t: key => key }) },
    "./uploadedImagePreview": { getUploadedImagePreviewSource: preview.getUploadedImagePreviewSource,
      useUploadedImagePreview: (path, root) => { calls.push(["thumbnail", path, root]); return { imageSrc: "data:image/png;base64,aW1hZ2U=", isLoading: false }; } },
    "../../../lib/system/imagePreview": { supportsDirectUploadedImageCopy: true, supportsSystemImageOpen: true,
      prepareUploadedImagePreviewCopy: args => calls.push(["prepare", args]), copyUploadedImagePreview: args => calls.push(["copy", args]),
      openUploadedImageInSystemViewer: args => calls.push(["open", args]), saveImagePreviewSource: (...args) => calls.push(["save", ...args]) },
  } });
  const { UserAttachmentCards } = loader.loadModule("src/pages/chat/transcript/UserAttachmentCards.tsx");
  const tree = UserAttachmentCards({ files: [file], workspaceRoot: "C:\\peer", onRemove: path => calls.push(["remove", path]) });
  const attachment = tree.props.children[0].props.children[0];
  const render = () => { cursor = 0; return attachment.type(attachment.props); };
  let card = render(); const thumbnail = card.props.children[0];
  assert.equal(thumbnail.props.alt, "image.png"); assert.equal(thumbnail.props.label, "chat.upload.previewImage: image.png");
  thumbnail.props.onRemove(); thumbnail.props.onClick(); card = render();
  const slide = card.props.children[1].props.slides[0];
  slide.onPrepare(); await slide.onCopy(); await slide.onOpen(); await slide.onSave();
  assert.deepEqual(calls.find(call => call[0] === "thumbnail"), ["thumbnail", source.path, source.workdir]);
  for (const action of ["prepare", "copy", "open"]) assert.deepEqual(calls.find(call => call[0] === action)[1], { workdir: source.workdir, absolutePath: source.path });
  assert.deepEqual(calls.find(call => call[0] === "remove"), ["remove", file.relativePath]);
  assert.deepEqual(calls.find(call => call[0] === "save"), ["save", slide.src, file.fileName]);
});
