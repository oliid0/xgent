import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const normalized = { fileName: "photo.jpg", mimeType: "image/jpeg", contentBase64: "aW1hZ2U=" };
const photo = (name = "photo.heic", type = "image/heic") => new File(["selected bytes"], name, { type });

function harness(options = {}) {
  const calls = [], notices = [], errors = [], invalidations = [];
  let focused = 0;
  const frame = { state: [], effects: [], cursor: 0 };
  const same = (a, b) => a?.length === b?.length && a.every((item, index) => Object.is(item, b[index]));
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useState(initial) {
        const index = frame.cursor++;
        if (!(index in frame.state)) frame.state[index] = initial;
        return [frame.state[index], value => {
          const next = typeof value === "function" ? value(frame.state[index]) : value;
          if (!Object.is(next, frame.state[index])) { frame.state[index] = next; frame.dirty = true; }
        }];
      },
      useRef(initial) { const index = frame.cursor++; return frame.state[index] ??= { current: initial }; },
      useCallback(callback, deps) {
        const index = frame.cursor++;
        if (!same(frame.state[index]?.deps, deps)) frame.state[index] = { callback, deps };
        return frame.state[index].callback;
      },
      useEffect(effect, deps) {
        const index = frame.cursor++;
        if (!same(frame.state[index]?.deps, deps)) frame.effects.push(() => {
          frame.state[index]?.cleanup?.();
          frame.state[index] = { deps, cleanup: effect() };
        });
      },
    },
    "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => options.native !== false },
    "../transcript/uploadedImagePreview": { invalidateUploadedImagePreviewCache: (...args) => invalidations.push(args) },
    "@tauri-apps/api/core": {
      async invoke(command, args) {
        calls.push({ command, args });
        if (command.endsWith("|prepare_image_attachment")) return options.prepare ? options.prepare(args.request) : normalized;
        if (command === "system_import_uploaded_readable_files") {
          if (options.import) return options.import(args);
          return { files: args.files.map((file, index) => ({ fileName: file.fileName, kind: "image", sizeBytes: 5,
            relativePath: `uploads/${index}/${file.fileName}`, absolutePath: `${args.workdir}/uploads/${index}/${file.fileName}` })), skipped: [] };
        }
        throw new Error(`Unexpected command ${command}`);
      },
    },
  } });
  const { prepareReadableUploads } = loader.loadModule("src/pages/chat/hooks/readableUploadInput.ts");
  const { usePendingUploads } = loader.loadModule("src/pages/chat/hooks/usePendingUploads.ts");
  const params = {
    workdir: "/a", conversationId: "a", nativeMobileRuntime: true,
    currentConversationIdRef: { current: "a" }, composerRef: { current: { focus: () => focused++ } },
    setErrorMessage: value => errors.push(value), addNotify: (...args) => notices.push(args),
  };
  const render = () => {
    do {
      frame.dirty = false; frame.cursor = 0;
      frame.value = usePendingUploads(params);
      for (const effect of frame.effects.splice(0)) effect();
    } while (frame.dirty);
    return frame.value;
  };
  return { options, calls, notices, errors, invalidations, params, render, prepareReadableUploads,
    get focused() { return focused; } };
}

test("native HEIC and extension-only photos import normalized bytes through the real mobile IPC wrapper", async () => {
  for (const input of [photo(), photo("photo.HEIF", "")]) {
    const h = harness();
    const result = await h.prepareReadableUploads([input]);
    assert.deepEqual(result, { files: [normalized], skipped: [] });
    assert.equal(h.calls[0].command, "plugin:mobile-assistant|prepare_image_attachment");
    assert.equal(h.calls[0].args.request.fileName, input.name);
    assert.equal(h.calls[0].args.request.contentBase64, Buffer.from("selected bytes").toString("base64"));
  }
});

test("SVG, documents and browser uploads retain original bytes without a native decoder", async () => {
  for (const [input, native] of [[new File(["<svg/>"], "icon.svg", { type: "image/svg+xml" }), true],
    [new File(["PDF bytes"], "document.pdf", { type: "application/pdf" }), true], [photo(), false]]) {
    const h = harness({ native });
    const result = await h.prepareReadableUploads([input]);
    assert.equal(result.files[0].fileName, input.name);
    assert.equal(result.files[0].mimeType, input.type);
    assert.equal(result.files[0].contentBase64, Buffer.from(await input.arrayBuffer()).toString("base64"));
    assert.equal(h.calls.length, 0);
  }
});

test("one invalid photo does not drop healthy files or run decoders concurrently", async () => {
  const wait = Promise.withResolvers();
  const h = harness({ prepare: request => request.fileName === "bad.heic" ? wait.promise : normalized });
  const pending = h.prepareReadableUploads([photo("bad.heic"), photo("good.heic")]);
  await new Promise(setImmediate);
  assert.equal(h.calls.length, 1);
  wait.reject(new Error("Unsupported photo format"));
  const result = await pending;
  assert.equal(h.calls.length, 2);
  assert.deepEqual(result.files, [normalized]);
  assert.deepEqual(result.skipped, ["bad.heic: Unsupported photo format"]);
});

test("native preparation rejects malformed responses and precise output-size overruns", async () => {
  for (const result of [null, { ...normalized, fileName: "" }, { ...normalized, mimeType: "image/heic" },
    { ...normalized, contentBase64: "" }, { ...normalized, contentBase64: "%%%=" },
    { ...normalized, contentBase64: "abc" }, { ...normalized, contentBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") }]) {
    const h = harness({ prepare: () => result });
    const prepared = await h.prepareReadableUploads([photo()]);
    assert.equal(prepared.files.length, 0);
    assert.match(prepared.skipped[0], /照片转换未返回受支持的图片/);
  }
  const h = harness();
  const large = { name: "large.heic", type: "image/heic", size: 20 * 1024 * 1024 + 1,
    arrayBuffer: () => { throw new Error("Oversized photos must be rejected before reading"); } };
  assert.match((await h.prepareReadableUploads([large])).skipped[0], /20 MB/);
  assert.equal(h.calls.length, 0);
});

test("the upload hook merges normalized files and skip reasons, and releases busy state", async () => {
  const h = harness({ prepare: request => { if (request.fileName === "bad.heic") throw new Error("Decoder failed"); return normalized; } });
  await h.render().importReadableFiles([photo("bad.heic"), photo("good.heic")]);
  const state = h.render();
  assert.equal(state.isUploadingFiles, false);
  assert.equal(state.pendingUploadedFiles[0].fileName, "photo.jpg");
  assert.deepEqual(h.calls.at(-1).args.files, [normalized]);
  assert.equal(h.calls.at(-1).args.workdir, "/a");
  assert.match(h.notices.at(-1)[1], /bad.heic: Decoder failed/);
  assert.equal(h.focused, 1);
  assert.equal(h.invalidations.length, 1);
});

test("failed conversions skip backend import and leave the owning conversation in an error state", async () => {
  const h = harness({ prepare: () => { throw new Error("Unsupported HEIF"); } });
  await h.render().importReadableFiles([photo()]);
  assert.equal(h.render().pendingUploadedFiles.length, 0);
  assert.equal(h.render().isUploadingFiles, false);
  assert.equal(h.calls.length, 1);
  assert.match(h.errors.at(-1), /photo.heic: Unsupported HEIF/);
});

test("a workspace change during decoding does not attach stale paths to the new workspace", async () => {
  const wait = Promise.withResolvers();
  const h = harness({ prepare: () => wait.promise });
  const pending = h.render().importReadableFiles([photo()]);
  await new Promise(setImmediate);
  h.params.workdir = "/new-workspace"; h.render();
  wait.resolve(normalized); await pending;
  assert.equal(h.calls.at(-1).args.workdir, "/a");
  assert.equal(h.render().pendingUploadedFiles.length, 0);
  assert.match(h.notices.at(-1)[1], /上传目标已失效/);
  assert.equal(h.focused, 0);
});

test("decoding after a conversation switch retains attachments only for their owning conversation", async () => {
  const wait = Promise.withResolvers();
  const h = harness({ prepare: () => wait.promise });
  const pending = h.render().importReadableFiles([photo()]);
  await new Promise(setImmediate);
  h.params.conversationId = "b"; h.params.currentConversationIdRef.current = "b"; h.params.workdir = "/b"; h.render();
  wait.resolve(normalized); await pending;
  const state = h.render();
  assert.equal(state.pendingUploadedFiles.length, 0);
  assert.equal(state.getPendingUploadsForConversation("a")[0].fileName, "photo.jpg");
  assert.equal(h.calls.at(-1).args.workdir, "/a");
  assert.equal(h.focused, 0);
});

test("native decoding respects the remaining file slots and the upload single-flight guard", async () => {
  const wait = Promise.withResolvers();
  const h = harness({ prepare: () => wait.promise });
  const hook = h.render();
  hook.setPendingUploadsForConversation("a", Array.from({ length: 8 }, (_, index) => ({
    relativePath: `uploads/existing-${index}.txt`, fileName: `existing-${index}.txt`, kind: "text", sizeBytes: 1,
  })));
  h.render();
  const pending = h.render().importReadableFiles([photo(), photo("extra.heic")]);
  await new Promise(setImmediate);
  assert.equal(h.render().isUploadingFiles, true);
  await h.render().importReadableFiles([photo("duplicate.heic")]);
  assert.equal(h.calls.length, 1);
  wait.resolve(normalized); await pending;
  assert.equal(h.calls.at(-1).args.maxFiles, 1);
  assert.equal(h.render().pendingUploadedFiles.length, 9);
  assert.equal(h.render().isUploadingFiles, false);
  assert.ok(h.notices.some(([, message]) => message.includes("1 个额外文件")));
  assert.ok(h.notices.some(([, message]) => message.includes("当前正在上传")));
});
