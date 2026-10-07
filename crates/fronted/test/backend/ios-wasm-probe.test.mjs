import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the iOS installation WASI probe runs _start and writes its marker through fd_write", async () => {
  const source = readFileSync(new URL("../../../mobile-execution/ios/Sources/AShellWasmProbe.swift", import.meta.url), "utf8");
  const encoded = source.match(/Data\(base64Encoded:\s*"([A-Za-z0-9+/=]+)"\)/)?.[1];
  assert.ok(encoded, "The installation must use an actual WASI module");
  let memory;
  let output = "";
  const { instance } = await WebAssembly.instantiate(Buffer.from(encoded, "base64"), {
    wasi_snapshot_preview1: {
      fd_write(fd, iovecs, count, written) {
        assert.equal(fd, 1);
        const view = new DataView(memory.buffer);
        let total = 0;
        for (let index = 0; index < count; index++) {
          const offset = view.getUint32(iovecs + index * 8, true);
          const length = view.getUint32(iovecs + index * 8 + 4, true);
          output += Buffer.from(memory.buffer, offset, length).toString("utf8");
          total += length;
        }
        view.setUint32(written, total, true);
        return 0;
      },
    },
  });
  memory = instance.exports.memory;
  instance.exports._start();
  assert.equal(output, "xgent-wasm3-ok");
});
