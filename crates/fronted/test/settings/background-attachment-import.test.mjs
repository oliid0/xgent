import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const snapshot = bytes => ({ bytes: bytes.length, contentBase64: bytes.toString("base64"), contentHash: digest(bytes) });
const peerConfig = { enabled: true, baseUrl: "http://paired-pc:28367", localWorkdir: "/phone", remoteWorkdir: "C:\\project" };

function fixture(options = {}) {
  const calls = [], disk = new Map(), peerDisk = new Map();
  let counter = 0, host;
  async function nativeInvoke(command, args) {
    calls.push({ command, args });
    const override = await options.onInvoke?.(command, args, { host, disk, peerDisk });
    if (override !== undefined) return override;
    if (command.startsWith("system_")) {
      const inputs = args.texts?.map(text => ({ fileName: text.fileName, contentBase64: Buffer.from(text.content).toString("base64") })) ?? args.files ?? [];
      return { files: inputs.map(input => {
        const original = Buffer.from(input.contentBase64, "base64"), bytes = options.transcode?.(original) ?? original;
        const relativePath = `uploads/${++counter}/${input.fileName}`, absolutePath = `${args.workdir}/${relativePath}`;
        disk.set(absolutePath, bytes);
        return { fileName: input.fileName, kind: "text", sizeBytes: bytes.length, relativePath, absolutePath };
      }), skipped: options.skipped ?? [] };
    }
    if (command === "fs_snapshot_binary") {
      assert.ok(args.path.startsWith(`${args.workdir}/`), "Snapshot uses the original local workspace");
      assert.ok(disk.has(args.path), "Snapshot needs actual imported local bytes");
      return snapshot(disk.get(args.path));
    }
    if (command === "lan_pc_invoke") {
      assert.equal(args.command, "fs_create_binary");
      const bytes = Buffer.from(args.args.content_base64, "base64");
      assert.equal(digest(bytes), args.args.expected_content_hash);
      assert.equal(peerDisk.has(args.args.path), false, "Creates must not overwrite another input");
      peerDisk.set(args.args.path, bytes);
      return { path: args.args.path, bytesWritten: bytes.length, contentHash: digest(bytes) };
    }
    throw new Error(`Unexpected command ${command}`);
  }
  const loader = createTsModuleLoader({ mocks: {
    "@tauri-apps/api/core": { invoke: nativeInvoke },
    "@xgent/runtime": { isTauriRuntime: () => options.native !== false,
      getLanPcCommandHostConfig: () => host.getLanPcCommandHostConfig(),
      invoke: async (...args) => { calls.push({ adapter: "runtime" }); return nativeInvoke(...args); } },
  } });
  host = loader.loadModule("src/runtime/lanPcCommandHost.ts");
  host.configureLanPcCommandHost(options.paired === false ? undefined : peerConfig);
  const module = loader.loadModule("src/lib/chat/messages/attachmentImport.ts");
  const messages = loader.loadModule("src/lib/chat/messages/uploadedFiles.ts");
  const { snapshotBackgroundInputs } = loader.loadModule("src/lib/automation/backgroundInputs.ts");
  const target = () => module.captureAttachmentImportTarget(options.paired === false ? "/phone" : "/phone/subdir");
  const files = (texts = ["actual saved content"], names = texts.map(() => "same.txt")) => texts.map((text, index) => ({ fileName: names[index], contentBase64: Buffer.from(text).toString("base64") }));
  const upload = (input = files(), captured = target(), isCurrent) => module.importAttachments(captured, "system_import_uploaded_readable_files", { files: input, maxFiles: 9 }, isCurrent);
  return { ...module, ...messages, calls, disk, peerDisk, host, target, files, upload, snapshotBackgroundInputs };
}

test("paired import stays on the native phone, copies exact saved bytes to the selected PC and persists its local provenance", async () => {
  const f = fixture(); const result = await f.upload(); const file = result.files[0];
  assert.equal(f.calls[0].command, "system_import_uploaded_readable_files");
  assert.equal(f.calls[0].args.workdir, "/phone");
  const relay = f.calls.find(call => call.command === "lan_pc_invoke");
  assert.equal(relay.args.base_url, peerConfig.baseUrl);
  assert.equal(relay.args.args.workdir, "C:\\project\\subdir");
  assert.equal(file.absolutePath, `C:\\project\\subdir\\${file.relativePath.replaceAll("/", "\\")}`);
  assert.equal(f.peerDisk.get(file.relativePath).toString(), "actual saved content");
  assert.deepEqual(file.localSource, { version: 1, workdir: "/phone", path: "/phone/uploads/1/same.txt", bytes: 20, contentHash: digest(Buffer.from("actual saved content")) });
  const message = f.createUserMessageWithUploads("Analyze this", result.files);
  assert.deepEqual(f.getUserMessageAttachments(JSON.parse(JSON.stringify(message))), result.files);
});

test("duplicate source names remain associated with their own byte content instead of matching by name or size", async () => {
  const f = fixture(); const result = await f.upload(f.files(["alpha", "omega"]));
  assert.notEqual(result.files[0].relativePath, result.files[1].relativePath);
  assert.notEqual(result.files[0].localSource.path, result.files[1].localSource.path);
  for (const [index, file] of result.files.entries()) {
    assert.equal(f.peerDisk.get(file.relativePath).toString(), ["alpha", "omega"][index]);
    assert.equal(file.localSource.contentHash, digest(f.peerDisk.get(file.relativePath)));
  }
});

test("text provenance covers bytes after native encoding conversion", async () => {
  const f = fixture({ transcode: bytes => Buffer.from(bytes.toString("utf16le"), "utf8") });
  const result = await f.upload([{ fileName: "legacy.txt", contentBase64: Buffer.from("hello", "utf16le").toString("base64") }]);
  assert.equal(result.files[0].sizeBytes, 5);
  assert.equal(f.peerDisk.get(result.files[0].relativePath).toString(), "hello");
  assert.equal(result.files[0].localSource.contentHash, digest(Buffer.from("hello")));
});

test("large pasted texts use the same exact native import/peer-copy path and retain their display metadata", async () => {
  const f = fixture(); const result = await f.importAttachments(f.target(), "system_import_pasted_texts", { texts: [{ fileName: "paste.txt", content: "first\nsecond" }] });
  const file = f.withPastedTextDisplayMetadata(result.files[0], { label: "Pasted text 1", charCount: 12, lineCount: 2 });
  assert.equal(f.peerDisk.get(file.relativePath).toString(), "first\nsecond");
  const message = f.createUserMessageWithUploads(`[Pasted text 1: ${file.relativePath}]`, [file]);
  assert.deepEqual(f.getUserMessageAttachments(JSON.parse(JSON.stringify(message))), [file]);
  assert.equal(f.stripUploadedFilesMessageMetadata(message).xgentAttachments, undefined);
});

test("single-device native imports keep their existing read paths and record actual local byte evidence", async () => {
  const f = fixture({ paired: false }); const { files } = await f.upload();
  assert.equal(files[0].absolutePath, "/phone/uploads/1/same.txt");
  assert.equal(files[0].relativePath, "uploads/1/same.txt");
  assert.equal(f.calls.some(call => call.command === "lan_pc_invoke"), false);
  assert.equal(files[0].localSource.workdir, "/phone");
});

test("browser import uses its existing runtime port without native snapshots or peer credentials", async () => {
  const f = fixture({ native: false }); const result = await f.upload();
  assert.equal(f.calls[0].adapter, "runtime");
  assert.equal(f.calls.some(call => call.command === "fs_snapshot_binary" || call.command === "lan_pc_invoke"), false);
  assert.equal(result.files[0].localSource, undefined);
});

test("missing local workspace fails before any picker or filesystem import", () => {
  const f = fixture(); f.host.configureLanPcCommandHost({ ...peerConfig, localWorkdir: "" });
  assert.throws(f.target, /local workspace/); assert.equal(f.calls.length, 0);
});

test("a changed peer/workspace after target capture cannot start imports under the new host", async () => {
  for (const patch of [{ baseUrl: "http://other-pc:28367" }, { localWorkdir: "/other-phone" }, { remoteWorkdir: "D:\\other" }, { enabled: false }]) {
    const f = fixture(), captured = f.target(); f.host.configureLanPcCommandHost({ ...peerConfig, ...patch });
    await assert.rejects(f.upload(f.files(), captured), /target changed/);
    assert.equal(f.calls.length, 0);
  }
});

test("host changes during local import or snapshot fence all subsequent peer writes", async () => {
  for (const phase of ["system_import_uploaded_readable_files", "fs_snapshot_binary"]) {
    const f = fixture({ onInvoke(command, args, { host }) {
      if (command === phase) host.configureLanPcCommandHost({ ...peerConfig, baseUrl: "http://other-pc:28367" });
    } });
    await assert.rejects(f.upload(), /target changed/);
    assert.equal(f.calls.some(call => call.command === "lan_pc_invoke"), false);
  }
});

test("invalidated conversation ownership stops the relay after the local read", async () => {
  let current = true;
  const f = fixture({ onInvoke(command) { if (command === "fs_snapshot_binary") current = false; } });
  await assert.rejects(f.upload(f.files(), f.target(), () => current), /target changed/);
  assert.equal(f.peerDisk.size, 0);
});

test("unknown remote write, revoked permission and inconsistent write evidence return no successful attachment or automatic retry", async () => {
  for (const bad of [new Error("Transport result unknown"), new Error("File writes disabled"),
    { path: "wrong.txt", bytesWritten: 20, contentHash: digest(Buffer.from("actual saved content")) },
    { path: null, bytesWritten: 19, contentHash: "bad" }]) {
    const f = fixture({ onInvoke(command) { if (command === "lan_pc_invoke") { if (bad instanceof Error) throw bad; return bad; } } });
    await assert.rejects(f.upload(), /unknown|disabled|inconsistent evidence/);
    assert.equal(f.calls.filter(call => call.command === "lan_pc_invoke").length, 1);
    assert.equal(f.disk.size, 1, "Original source remains available after relay failure");
  }
});

test("a changed host after an actual remote write prevents publishing that old host's paths", async () => {
  const f = fixture({ onInvoke(command, args, { host }) {
    if (command === "lan_pc_invoke") host.configureLanPcCommandHost({ ...peerConfig, baseUrl: "http://other-pc:28367" });
  } });
  await assert.rejects(f.upload(), /target changed/);
  assert.equal(f.peerDisk.size, 1);
});

test("native import size mismatch or unreadable saved bytes prevents every remote write", async () => {
  for (const unreadable of [false, true]) {
    const f = fixture({ onInvoke(command, args) {
      if (command === "fs_snapshot_binary") {
        if (unreadable) throw new Error("Imported file missing");
        return snapshot(Buffer.from("different size"));
      }
    } });
    await assert.rejects(f.upload(), /different saved file size|missing/);
    assert.equal(f.peerDisk.size, 0);
  }
});

test("skipped inputs retain the backend's reason without inventing copies or losing healthy sources", async () => {
  const f = fixture({ skipped: ["Unsupported input was skipped"] }); const result = await f.upload();
  assert.deepEqual(result.skipped, ["Unsupported input was skipped"]); assert.equal(result.files.length, 1);
});

test("malformed claimed local provenance remains a failure sentinel through history parsing", () => {
  const f = fixture();
  for (const localSource of [null, {}, { version: 1, workdir: "/phone", path: "/phone/file", bytes: 1, contentHash: "fake" }]) {
    const file = { relativePath: "remote.txt", fileName: "remote.txt", kind: "text", sizeBytes: 1, localSource };
    assert.equal(f.getUserMessageAttachments({ role: "user", xgentAttachments: [file] })[0].localSource, null);
  }
});

test("background reads retain separate pinned local roots after the selected PC changes", async () => {
  const f = fixture(); const first = (await f.upload()).files[0];
  f.host.configureLanPcCommandHost({ ...peerConfig, localWorkdir: "/other", remoteWorkdir: "D:\\project" });
  const second = (await f.upload(f.files(["second input"]))).files[0];
  const sources = [first, second].map((file, index) => ({ path: file.localSource.path, workdir: file.localSource.workdir,
    expectedContentHash: file.localSource.contentHash, expectedBytes: file.localSource.bytes, name: `input-${index}.txt` }));
  const result = await f.snapshotBackgroundInputs(sources, "/irrelevant-current-root");
  assert.deepEqual(result.map(item => Buffer.from(item.contentBase64, "base64").toString()), ["actual saved content", "second input"]);
});

test("same-length source modification after import is rejected at background snapshot time", async () => {
  const f = fixture(); const file = (await f.upload()).files[0], source = file.localSource;
  f.disk.set(source.path, Buffer.alloc(source.bytes, 1));
  await assert.rejects(f.snapshotBackgroundInputs([{ path: source.path, workdir: source.workdir,
    expectedContentHash: source.contentHash, expectedBytes: source.bytes }], "/wrong"), /changed since attachment import/);
});

test("existing larger local uploads remain usable while bounded peer copies fail explicitly", async () => {
  for (const paired of [false, true]) {
    const f = fixture({ paired, onInvoke(command) {
      if (command.startsWith("system_")) return { files: [{ fileName: "large.pdf", kind: "pdf", sizeBytes: 8 * 1024 * 1024 + 1,
        relativePath: "large.pdf", absolutePath: "/phone/large.pdf" }], skipped: [] };
      if (command === "fs_snapshot_binary") return { contentBase64: "", contentHash: "invalid", bytes: 8 * 1024 * 1024 + 1 };
    } });
    if (paired) await assert.rejects(f.upload(), /8 MiB/);
    else {
      const result = await f.upload(); assert.equal(result.files[0].absolutePath, "/phone/large.pdf");
      assert.equal(result.files[0].localSource, undefined);
      assert.equal(f.calls.some(call => call.command === "fs_snapshot_binary"), false);
    }
    assert.equal(f.peerDisk.size, 0);
  }
});

test("malformed per-file root/hash/length provenance is rejected before native reads", async () => {
  for (const patch of [{ workdir: "" }, { expectedContentHash: "fake" }, { expectedBytes: -1 }, { expectedBytes: 8 * 1024 * 1024 + 1 }]) {
    const f = fixture(); await assert.rejects(f.snapshotBackgroundInputs([{ path: "/phone/input", ...patch }], "/phone"), /source provenance/);
    assert.equal(f.calls.length, 0);
  }
});

test("desktop native picker and path imports use local source paths before the authenticated relay", async () => {
  for (const command of ["system_pick_readable_files", "system_import_readable_file_paths"]) {
    const bytes = Buffer.from("picked input");
    const f = fixture({ onInvoke(actual, args, { disk }) {
      if (actual === command) {
        assert.equal(args.workdir, "/phone"); assert.equal(args.maxFiles, 1);
        const path = "/phone/uploads/picked.txt"; disk.set(path, bytes);
        return { files: [{ fileName: "picked.txt", kind: "text", relativePath: "uploads/picked.txt", absolutePath: path, sizeBytes: bytes.length }], skipped: [] };
      }
    } });
    const result = await f.importAttachments(f.target(), command, { paths: ["/device/picked.txt"], maxFiles: 1 });
    assert.equal(f.peerDisk.get(result.files[0].relativePath).toString(), "picked input");
    assert.equal(result.files[0].localSource.path, "/phone/uploads/picked.txt");
  }
});

test("a cancelled native picker returns no source snapshots or remote writes", async () => {
  const f = fixture(); const result = await f.importAttachments(f.target(), "system_pick_readable_files", { maxFiles: 1 });
  assert.deepEqual(result, { files: [], skipped: [] });
  assert.equal(f.calls.length, 1); assert.equal(f.peerDisk.size, 0);
});
