import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const loader = createTsModuleLoader();
const { NativeTerminalOutputBuffer, NATIVE_TERMINAL_OUTPUT_BYTES, parseNativeTerminalEvent } =
  loader.loadModule("src/presentation/nativeTerminalProtocol.ts");
const bytes = (text) => new TextEncoder().encode(text);
const snapshot = (id = "one", text = "ready", start = 0) => ({
  session: { id, running: true }, bytes: bytes(text), outputStartOffset: start, outputEndOffset: start + bytes(text).length,
});
const chunk = (text, start, sessionId = "one") => ({ sessionId, bytes: bytes(text), startOffset: start,
  endOffset: start + bytes(text).length });
const input = (sessionId = "one", data = [0, 27, 255]) => JSON.stringify({ sessionId, type: "input",
  bytes: Buffer.from(data).toString("base64") });
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test("native terminal replay retains arbitrary bytes and only appends unseen stream spans", () => {
  const buffer = new NativeTerminalOutputBuffer(snapshot("one", "ready", 10));
  assert.equal(buffer.append(chunk("ady!", 12)), true);
  assert.equal(buffer.append(chunk("ready", 10)), false);
  assert.equal(buffer.append(chunk("wrong", 16, "another-session")), false);
  const packet = JSON.parse(buffer.packet(true, 7));
  assert.equal(Buffer.from(packet.bytes, "base64").toString(), "ready!");
  assert.equal(packet.startOffset, 10);
  assert.equal(packet.endOffset, 16);
  assert.equal(packet.generation, 7);
  assert.equal(packet.enabled, true);
  assert.throws(() => buffer.append(chunk("gap", 20)), /interrupted/);
  assert.throws(() => buffer.append({ ...chunk("bad", 16), endOffset: 18 }), /offsets/);
});

test("native terminal output stays bounded without splitting transport offsets", () => {
  const buffer = new NativeTerminalOutputBuffer(snapshot("one", ""));
  buffer.append(chunk("x".repeat(NATIVE_TERMINAL_OUTPUT_BYTES + 3), 0));
  buffer.append(chunk("end", NATIVE_TERMINAL_OUTPUT_BYTES + 3));
  const packet = JSON.parse(buffer.packet(false, 1));
  const output = Buffer.from(packet.bytes, "base64");
  assert.equal(output.length, NATIVE_TERMINAL_OUTPUT_BYTES);
  assert.equal(output.subarray(-3).toString(), "end");
  assert.equal(packet.startOffset, 6);
  assert.equal(packet.endOffset, NATIVE_TERMINAL_OUTPUT_BYTES + 6);
  assert.throws(() => new NativeTerminalOutputBuffer({ ...snapshot(), outputStartOffset: -1 }), /offsets/);
});

test("native terminal rejects malformed, oversized and ambiguous input or resize events", () => {
  assert.deepEqual(Array.from(parseNativeTerminalEvent(input()).bytes), [0, 27, 255]);
  assert.equal(parseNativeTerminalEvent(JSON.stringify({ sessionId: "one", type: "resize", cols: 80, rows: 24 })).cols, 80);
  for (const value of [null, "broken", input(""), input("one", []), input("one", new Uint8Array(16385)),
    JSON.stringify({ sessionId: "one", type: "input", bytes: "YQ== ", command: "extra" }),
    JSON.stringify({ sessionId: "one", type: "resize", cols: 400.5, rows: 24 }),
    JSON.stringify({ sessionId: "one", type: "resize", cols: 401, rows: 24 }),
    JSON.stringify({ sessionId: "one", type: "resize", cols: 80, rows: 0 }),
    JSON.stringify({ sessionId: "one", type: "resize", cols: 80, rows: 24, extra: true }),
  ]) assert.equal(parseNativeTerminalEvent(value), null);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function streamHandle(id) {
  let output, state;
  const writes = [], resizes = [];
  const handle = {
    snapshot: snapshot(id), disposed: false,
    write(value) { writes.push(Array.from(value)); return true; },
    resize(cols, rows) { resizes.push({ cols, rows }); },
    dispose() { handle.disposed = true; },
    subscribeOutput(listener) { output = listener; return () => {}; },
    subscribeInputState(listener) { state = listener; listener({ paused: false }); return () => {}; },
  };
  return { handle, writes, resizes, output: (value) => output?.(value), state: (value) => state?.(value) };
}
function harness(attach) {
  const hooks = createReactHookHarness();
  const loader = createTsModuleLoader({ mocks: { react: hooks.react } });
  const { useNativeTerminalStream } = loader.loadModule("src/presentation/useNativeTerminalStream.ts");
  const props = { session: { id: "one", running: true }, open: true };
  const client = { stream: { attach } };
  const render = () => hooks.render(() => useNativeTerminalStream(client, props.session, props.open));
  return { props, render, unmount: () => hooks.unmount() };
}

test("native terminal stream forwards raw input/resize and respects backend backpressure", async () => {
  const transport = streamHandle("one");
  const h = harness(async () => transport.handle);
  h.render(); await settle();
  h.render().dispatch(input());
  h.render().dispatch(JSON.stringify({ sessionId: "one", type: "resize", cols: 90, rows: 30 }));
  assert.deepEqual(transport.writes, [[0, 27, 255]]);
  assert.deepEqual(transport.resizes, [{ cols: 90, rows: 30 }]);
  transport.state({ paused: true, reason: "slow" });
  assert.equal(JSON.parse(h.render().packet).enabled, false);
  assert.throws(() => h.render().dispatch(input()), /paused/);
  transport.state({ paused: false });
  assert.equal(JSON.parse(h.render().packet).enabled, true);
  transport.output(chunk("!", 5));
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(Buffer.from(JSON.parse(h.render().packet).bytes, "base64").toString(), "ready!");
  h.unmount();
  assert.equal(transport.handle.disposed, true);
});

test("terminal closing or switching sessions retires pending attach and rejects obsolete inputs", async () => {
  const pending = deferred(), old = streamHandle("one"), current = streamHandle("two");
  const h = harness((session) => session.id === "one" ? pending.promise : Promise.resolve(current.handle));
  h.render();
  h.props.session = { id: "two", running: true };
  h.render(); await settle();
  pending.resolve(old.handle); await settle();
  assert.equal(old.handle.disposed, true);
  assert.equal(h.render().accepts(input("one")), false);
  assert.throws(() => h.render().dispatch(input("one")), /no longer/);
  h.render().dispatch(input("two"));
  h.render().retire();
  assert.equal(current.handle.disposed, true);
  assert.throws(() => h.render().dispatch(input("two")), /no longer/);
  assert.equal(current.writes.length, 1);
  h.unmount();
});

test("a missing output span disables native input until the user reconnects", async () => {
  const transports = [streamHandle("one"), streamHandle("one")];
  let index = 0;
  const h = harness(async () => transports[index++].handle);
  h.render(); await settle();
  transports[0].output(chunk("!", 5));
  transports[0].output(chunk("lost", 99));
  await new Promise((resolve) => setTimeout(resolve, 25));
  transports[0].state({ paused: false });
  const failed = h.render();
  assert.match(failed.error, /interrupted/);
  assert.equal(JSON.parse(failed.packet).enabled, false);
  assert.throws(() => failed.dispatch(input()), /no longer/);
  failed.reconnect(); h.render(); await settle();
  assert.equal(JSON.parse(h.render().packet).enabled, true);
  h.unmount();
});
