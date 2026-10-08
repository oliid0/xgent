import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

test("terminal appearance updates keep the live session, output and input backpressure", async () => {
  const hooks = createReactHookHarness();
  const terminals = [], resizes = [], writes = [], timers = new Map();
  const listeners = new Map();
  let output, state, input, attaches = 0, disposed = 0, timerId = 0, fits = 0;
  const container = { getBoundingClientRect: () => ({ width: 640, height: 300 }),
    addEventListener() {}, removeEventListener() {}, clientHeight: 300 };
  let firstRef = true;
  const react = { ...hooks.react, useRef(value) {
    const ref = hooks.react.useRef(value);
    if (firstRef) { ref.current = container; firstRef = false; }
    return ref;
  } };
  class Terminal {
    constructor(options) {
      this.options = options; this.cols = options.cols; this.rows = options.rows;
      this.output = ""; terminals.push(this);
    }
    loadAddon() {} open() {} focus() {} blur() {}
    onData(callback) { input = callback; return { dispose() {} }; }
    resize(cols, rows) { this.cols = cols; this.rows = rows; }
    write(bytes, callback) { this.output += new TextDecoder().decode(bytes); callback?.(); }
    reset() { this.output = ""; }
    dispose() { this.disposed = true; }
  }
  const previousWindow = globalThis.window, previousObserver = globalThis.ResizeObserver;
  globalThis.window = {
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
  };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const flushTimers = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } };
  try {
    const session = { id: "one", projectPathKey: "/project", cols: 80, rows: 24, running: true };
    const handle = {
      snapshot: { session, bytes: new TextEncoder().encode("ready"), outputStartOffset: 0, outputEndOffset: 5 },
      subscribeOutput(callback) { output = callback; return () => {}; },
      subscribeInputState(callback) { state = callback; callback({ paused: false }); return () => {}; },
      write(bytes) { writes.push([...bytes]); return true; },
      resize(cols, rows) { resizes.push({ cols, rows }); },
      dispose() { disposed++; },
    };
    const client = { subscribe: () => () => {}, stream: { async attach() { attaches++; return handle; } } };
    const { XTermViewport } = createTsModuleLoader({ mocks: {
      react,
      "@xterm/xterm/css/xterm.css": {},
      "@xterm/xterm": { Terminal },
      "@xterm/addon-fit": { FitAddon: class { fit() { fits++; } } },
      "../../lib/shared/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
      "../../lib/system/fontFamily": { CODE_FONT_FAMILY_CHANGE_EVENT: "font", getCodeFontFamily: () => "monospace" },
    } }).loadModule("src/components/project-tools/XTermViewport.tsx");
    const props = { client, session, theme: "dark", isActive: true, fontScale: 1, onError() {} };
    const render = () => hooks.render(() => XTermViewport(props));
    render();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flushTimers(); flushTimers();
    assert.equal(terminals[0].options.fontSize, 14);
    assert.equal(terminals[0].options.theme.foreground, "#cbd5e1");
    assert.equal(terminals[0].output, "ready");
    const fitsBefore = fits;
    props.fontScale = 1.4; props.theme = "light";
    render(); flushTimers(); flushTimers();
    assert.equal(terminals.length, 1);
    assert.equal(attaches, 1);
    assert.equal(disposed, 0);
    assert.equal(terminals[0].options.fontSize, 14 * 1.4);
    assert.equal(terminals[0].options.theme.foreground, "#1f2933");
    assert.ok(fits > fitsBefore);
    assert.ok(resizes.length);
    state({ paused: true, reason: "slow" }); input("blocked");
    assert.equal(writes.length, 0);
    state({ paused: false }); input("ok");
    assert.deepEqual(writes, [[111, 107]]);
    output({ sessionId: "one", bytes: new TextEncoder().encode("!"), startOffset: 5, endOffset: 6 });
    assert.equal(terminals[0].output, "ready!");
    listeners.get("font")({ detail: "custom-monospace" }); flushTimers(); flushTimers();
    assert.equal(terminals[0].options.fontFamily, "custom-monospace");
    hooks.unmount(); flushTimers();
    assert.equal(disposed, 1);
    assert.equal(terminals[0].disposed, true);
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.window = previousWindow;
    globalThis.ResizeObserver = previousObserver;
  }
});
